"use server";

// Ações do painel de integrações.
//
// Regra de escopo: o dono e o admin conectam o calendário de qualquer
// profissional; o barbeiro conecta apenas o dele. Quem decide é
// `canActOnProfessional`, no servidor — o formulário manda o id, e ele é
// sempre confrontado com a sessão antes de qualquer escrita.

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@barber/db";
import { ForbiddenError, canActOnProfessional } from "@barber/domain";
import { googleAuthorizationUrl, googleOAuthConfig } from "@barber/integrations";
import { requirePermission } from "@/lib/auth";
import { OAUTH_NONCE_COOKIE, signOAuthState } from "@/lib/integrations";

async function professionalDoTenant(professionalId: string) {
  const session = await requirePermission("integrations.write");

  if (!canActOnProfessional(session.membership, "integrations.write", professionalId)) {
    throw new ForbiddenError("integrations.write");
  }

  // O id vem do formulário: sem esta busca com o tenant junto, trocá-lo no HTML
  // conectaria o calendário a um profissional de outra barbearia.
  const professional = await prisma.professional.findFirst({
    where: { id: professionalId, barbershopId: session.barbershopId },
    select: { id: true },
  });
  if (!professional) throw new ForbiddenError(`professional:${professionalId}`);

  return session;
}

export async function connectGoogleCalendar(formData: FormData): Promise<void> {
  const professionalId = String(formData.get("professionalId") ?? "");
  const session = await professionalDoTenant(professionalId);

  const config = googleOAuthConfig();
  if (!config) redirect("/gestao/integracoes?erro=indisponivel");

  // O nonce fecha o `state`: o retorno só vale no mesmo navegador que começou.
  const nonce = randomUUID();
  cookies().set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  redirect(
    googleAuthorizationUrl(
      config,
      signOAuthState({ barbershopId: session.barbershopId, professionalId, nonce })
    )
  );
}

/// Desconectar apaga a credencial, e só. Os compromissos já criados continuam
/// no Google: são da agenda do profissional, e apagá-los sem ele pedir seria
/// mexer no que é dele. Guardar o `external_event_id` é também o que faz uma
/// reconexão atualizar o mesmo evento em vez de criar um segundo.
export async function disconnectGoogleCalendar(formData: FormData): Promise<void> {
  const professionalId = String(formData.get("professionalId") ?? "");
  const session = await professionalDoTenant(professionalId);

  await prisma.integrationConnection.updateMany({
    where: {
      barbershopId: session.barbershopId,
      professionalId,
      provider: "GOOGLE_CALENDAR",
    },
    data: {
      status: "DISCONNECTED",
      credentialsEncrypted: null,
      tokenExpiresAt: null,
      disconnectedAt: new Date(),
      lastErrorCode: null,
      lastErrorAt: null,
    },
  });

  revalidatePath("/gestao/integracoes");
}
