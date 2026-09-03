// Apoio do painel de integrações: estado legível e o `state` do OAuth.
//
// A tradução de erro técnico para frase acionável vive aqui, e não na tela,
// porque a Parte 1 §21 proíbe jargão na interface: o dono precisa saber o que
// fazer, não qual código HTTP o Google devolveu.

import { hashToken, tokensMatch } from "@barber/domain";

/// Nome do cookie que guarda o nonce do OAuth. Vive aqui, e não no arquivo de
/// ações, porque um módulo "use server" só pode exportar função assíncrona.
export const OAUTH_NONCE_COOKIE = "barber_gcal_nonce";

export type IntegrationStatusValue = "CONNECTED" | "UNSTABLE" | "DISCONNECTED" | "ERROR";

export interface IntegrationDisplay {
  /// Uma palavra, para o selo
  label: string;
  tone: "ok" | "warn" | "bad" | "off";
  /// O que está acontecendo e, quando há erro, o que fazer a respeito
  detail: string;
  /// Reconectar resolve? Decide qual botão a tela oferece.
  needsReconnect: boolean;
}

const ERRO_LEGIVEL: Record<string, string> = {
  REVOKED:
    "O acesso ao Google foi retirado. Reconecte a conta para os horários voltarem a aparecer na agenda dele.",
  TRANSIENT:
    "O Google não respondeu na última tentativa. Estamos tentando de novo sozinhos — não é preciso fazer nada.",
  NOT_FOUND:
    "O calendário conectado não foi encontrado. Reconecte a conta para escolher outro.",
  PERMANENT:
    "O Google recusou o envio. Reconecte a conta; se continuar, avise o suporte.",
};

export function describeIntegration(connection: {
  status: IntegrationStatusValue;
  lastErrorCode: string | null;
  lastSyncAt: Date | null;
} | null): IntegrationDisplay {
  if (!connection || connection.status === "DISCONNECTED") {
    return {
      label: "Não conectado",
      tone: "off",
      detail: "Os horários dele não aparecem no Google Agenda.",
      needsReconnect: false,
    };
  }

  if (connection.status === "ERROR") {
    return {
      label: "Precisa reconectar",
      tone: "bad",
      detail: ERRO_LEGIVEL[connection.lastErrorCode ?? ""] ?? ERRO_LEGIVEL.PERMANENT!,
      needsReconnect: true,
    };
  }

  if (connection.status === "UNSTABLE") {
    return {
      label: "Instável",
      tone: "warn",
      detail: ERRO_LEGIVEL.TRANSIENT!,
      needsReconnect: false,
    };
  }

  return {
    label: "Conectado",
    tone: "ok",
    detail: connection.lastSyncAt
      ? "Os horários estão indo para o Google Agenda."
      : "Conectado. O primeiro horário aparece na agenda assim que houver um agendamento.",
    needsReconnect: false,
  };
}

// --- `state` do OAuth --------------------------------------------------------
//
// O `state` volta do Google pela URL, então precisa ser inforjável: sem
// assinatura, alguém poderia induzir o dono a conectar a própria conta do
// Google ao profissional de outra barbearia.

export interface OAuthState {
  barbershopId: string;
  professionalId: string;
  nonce: string;
}

function stateSecret(): string {
  const secret = process.env.TOKEN_HMAC_SECRET;
  if (!secret) throw new Error("TOKEN_HMAC_SECRET não configurado");
  return secret;
}

export function signOAuthState(state: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${hashToken(payload, stateSecret())}`;
}

/// Devolve null para qualquer `state` que não tenha saído daqui.
export function verifyOAuthState(raw: string): OAuthState | null {
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  if (!tokensMatch(hashToken(payload, stateSecret()), signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (!parsed.barbershopId || !parsed.professionalId || !parsed.nonce) return null;
    return parsed;
  } catch {
    return null;
  }
}
