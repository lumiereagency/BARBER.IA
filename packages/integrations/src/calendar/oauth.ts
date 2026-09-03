// Autorização OAuth do Google Calendar.
//
// Escopo mínimo por decisão: `calendar.events` escreve compromissos e nada
// mais — não lê a agenda pessoal do profissional, não cria calendários, não
// toca em contatos. `email` existe só para a tela poder dizer qual conta está
// conectada; sem isso o dono não teria como saber se conectou a errada.
//
// `access_type=offline` com `prompt=consent` é o que garante o refresh token:
// sem ele a integração pararia de funcionar sozinha em uma hora.

import { CalendarError, type CalendarCredentials } from "./provider.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "email"];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/// Devolve a configuração, ou null quando a integração ainda não foi provisionada.
/// Null é um estado legítimo: a tela precisa dizer "indisponível" em vez de
/// oferecer um botão que levaria a um erro do Google.
export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "";

  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function googleAuthorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Sem isto o Google devolve refresh token só na primeira autorização, e
    // uma reconexão deixaria a integração sem como se renovar.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleAuthorizationResult {
  credentials: CalendarCredentials;
  /// E-mail da conta conectada, quando o Google o informa
  account: string | null;
}

export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string
): Promise<GoogleAuthorizationResult> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code,
    }),
  }).catch(() => {
    throw new CalendarError("Não foi possível falar com o Google", "TRANSIENT");
  });

  if (!response.ok) {
    throw new CalendarError(
      `O Google recusou a autorização (${response.status})`,
      response.status >= 500 ? "TRANSIENT" : "PERMANENT"
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Sem refresh token a conexão morreria em uma hora sem aviso. Preferimos
  // recusar agora, com mensagem, a guardar algo que vai falhar depois.
  if (!data.refresh_token) {
    throw new CalendarError(
      "O Google não devolveu permissão de acesso contínuo. Refaça a conexão autorizando o acesso permanente.",
      "PERMANENT"
    );
  }

  const credentials: CalendarCredentials = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };

  return { credentials, account: await fetchGoogleAccount(credentials.accessToken) };
}

/// Só para mostrar na tela; falhar aqui não invalida a conexão.
async function fetchGoogleAccount(accessToken: string): Promise<string | null> {
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as { email?: string } | null;
  return data?.email ?? null;
}
