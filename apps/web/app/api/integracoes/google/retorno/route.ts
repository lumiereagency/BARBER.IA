// Retorno do consentimento do Google.
//
// Três checagens antes de gravar qualquer credencial, porque esta rota é
// alcançável por qualquer URL que o usuário abra:
//  1. o `state` tem que estar assinado por nós;
//  2. o nonce tem que bater com o cookie desta sessão de navegador;
//  3. a barbearia do `state` tem que ser a da sessão, e a permissão sobre
//     aquele profissional é revalidada aqui, não herdada do passo anterior.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@barber/db";
import { canActOnProfessional } from "@barber/domain";
import {
  exchangeGoogleCode,
  googleOAuthConfig,
  reconcileCalendar,
  writeCredentials,
} from "@barber/integrations";
import { getSession } from "@/lib/auth";
import { OAUTH_NONCE_COOKIE, verifyOAuthState } from "@/lib/integrations";

const PAINEL = "/gestao/integracoes";

function voltar(request: NextRequest, erro?: string): NextResponse {
  const url = new URL(erro ? `${PAINEL}?erro=${erro}` : `${PAINEL}?ok=1`, request.nextUrl.origin);
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_NONCE_COOKIE);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/entrar", request.nextUrl.origin));

  const params = request.nextUrl.searchParams;

  // O profissional clicou em "cancelar" na tela do Google: não é erro nosso
  if (params.get("error")) return voltar(request, "cancelado");

  const state = verifyOAuthState(params.get("state") ?? "");
  const nonce = request.cookies.get(OAUTH_NONCE_COOKIE)?.value;
  const code = params.get("code");

  if (!state || !code || !nonce || state.nonce !== nonce) return voltar(request, "invalido");
  if (state.barbershopId !== session.barbershopId) return voltar(request, "invalido");
  if (!canActOnProfessional(session.membership, "integrations.write", state.professionalId)) {
    return voltar(request, "sem_permissao");
  }

  const professional = await prisma.professional.findFirst({
    where: { id: state.professionalId, barbershopId: session.barbershopId },
    select: { id: true },
  });
  if (!professional) return voltar(request, "invalido");

  const config = googleOAuthConfig();
  if (!config) return voltar(request, "indisponivel");

  let resultado;
  try {
    resultado = await exchangeGoogleCode(config, code);
  } catch (error) {
    console.error("[calendar] troca de código falhou:", error);
    return voltar(request, "falha_google");
  }

  const dados = {
    status: "CONNECTED" as const,
    credentialsEncrypted: writeCredentials(resultado.credentials),
    tokenExpiresAt: resultado.credentials.expiresAt,
    externalAccount: resultado.account,
    disconnectedAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
  };

  // Upsert e não create: reconectar reaproveita a conexão existente, e com ela
  // os `external_event_id` já gravados — é isso que impede a reconexão de
  // duplicar os compromissos que já estão no calendário.
  await prisma.integrationConnection.upsert({
    where: {
      barbershopId_professionalId_provider: {
        barbershopId: session.barbershopId,
        professionalId: state.professionalId,
        provider: "GOOGLE_CALENDAR",
      },
    },
    update: dados,
    create: {
      barbershopId: session.barbershopId,
      professionalId: state.professionalId,
      provider: "GOOGLE_CALENDAR",
      ...dados,
    },
  });

  // Traz para o calendário o que foi agendado enquanto ele estava desconectado.
  // Falhar aqui não desfaz a conexão: o worker reconcilia de novo em minutos.
  await reconcileCalendar().catch((error: unknown) =>
    console.error("[calendar] reconciliação pós-conexão falhou:", error)
  );

  return voltar(request);
}
