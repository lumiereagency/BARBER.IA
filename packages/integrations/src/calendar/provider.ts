// Adapter de calendário externo (Parte 2 §11).
//
// A plataforma é a fonte de verdade; o evento no calendário é uma projeção.
// Nada aqui pode alterar reserva — a direção é sempre única, do banco para fora.
//
// A interface existe para que trocar o Google por outro provedor não toque no
// domínio, e para que os testes exercitem o caminho de falha sem rede.

export interface CalendarEventInput {
  /// Identificador do evento no provedor, quando já existe
  externalEventId?: string | null;
  summary: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
}

export interface CalendarCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}

/// Distingue o que adianta tentar de novo do que não adianta.
///
/// Rede instável é transitório: a retentativa resolve. Autorização revogada é
/// permanente: insistir só gasta tentativa e atrasa o aviso ao dono.
export type CalendarErrorCode = "TRANSIENT" | "REVOKED" | "NOT_FOUND" | "PERMANENT";

export class CalendarError extends Error {
  // Campo declarado à mão, e não como propriedade de parâmetro: o modo de
  // remoção de tipos do Node (usado nos testes) não entende essa açúcar.
  readonly code: CalendarErrorCode;

  constructor(message: string, code: CalendarErrorCode) {
    super(message);
    this.name = "CalendarError";
    this.code = code;
  }

  get isRetryable(): boolean {
    return this.code === "TRANSIENT";
  }
}

export interface CalendarProvider {
  readonly name: string;
  /// Devolve o id do evento criado ou atualizado
  upsertEvent(credentials: CalendarCredentials, input: CalendarEventInput): Promise<string>;
  deleteEvent(credentials: CalendarCredentials, externalEventId: string): Promise<void>;
  /// Renova o access token; devolve null quando não foi preciso renovar
  refreshCredentials(credentials: CalendarCredentials): Promise<CalendarCredentials | null>;
}

const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = "google";

  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(
    clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? ""
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private classify(status: number, body: string): CalendarError {
    if (status === 401 || status === 403) {
      // O profissional revogou o acesso, ou a conta foi desativada
      return new CalendarError(`Autorização recusada pelo Google (${status})`, "REVOKED");
    }
    if (status === 404) {
      return new CalendarError("Evento não existe mais no Google", "NOT_FOUND");
    }
    if (status === 429 || status >= 500) {
      return new CalendarError(`Google indisponível (${status})`, "TRANSIENT");
    }
    // 400 e afins: mandamos algo errado; repetir não vai consertar
    return new CalendarError(`Google recusou a requisição (${status}): ${body.slice(0, 200)}`, "PERMANENT");
  }

  async refreshCredentials(credentials: CalendarCredentials): Promise<CalendarCredentials | null> {
    const expiraEmBreve =
      !credentials.expiresAt || credentials.expiresAt.getTime() - Date.now() < 5 * 60_000;
    if (!expiraEmBreve) return null;

    const response = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    }).catch(() => {
      throw new CalendarError("Não foi possível falar com o Google", "TRANSIENT");
    });

    if (!response.ok) {
      const body = await response.text();
      // invalid_grant significa refresh token revogado ou expirado
      if (body.includes("invalid_grant")) {
        throw new CalendarError("Acesso ao Google foi revogado", "REVOKED");
      }
      throw this.classify(response.status, body);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };

    return {
      accessToken: data.access_token,
      refreshToken: credentials.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async upsertEvent(
    credentials: CalendarCredentials,
    input: CalendarEventInput
  ): Promise<string> {
    const corpo = {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startsAt.toISOString(), timeZone: input.timeZone },
      end: { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone },
    };

    if (input.externalEventId) {
      const atualizado = await this.request(
        credentials,
        "PATCH",
        `${GOOGLE_API}/calendars/primary/events/${encodeURIComponent(input.externalEventId)}`,
        corpo
      );

      // Evento sumiu do lado de lá: o profissional apagou na mão, ou a conexão
      // voltou apontando para outra conta do Google. Recriar é o certo — e é
      // também o que impede a reconexão de deixar a agenda vazia.
      if (atualizado !== null) return atualizado;
    }

    const criado = await this.request(
      credentials,
      "POST",
      `${GOOGLE_API}/calendars/primary/events`,
      corpo
    );

    // Um 404 ao CRIAR não é "evento inexistente": é o calendário que sumiu
    if (criado === null) throw new CalendarError("Calendário não encontrado", "PERMANENT");
    return criado;
  }

  /// Devolve o id do evento, ou null quando o alvo não existe mais (404/410).
  private async request(
    credentials: CalendarCredentials,
    method: "POST" | "PATCH",
    url: string,
    body: unknown
  ): Promise<string | null> {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }).catch(() => {
      throw new CalendarError("Não foi possível falar com o Google", "TRANSIENT");
    });

    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw this.classify(response.status, await response.text());

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async deleteEvent(credentials: CalendarCredentials, externalEventId: string): Promise<void> {
    const response = await fetch(
      `${GOOGLE_API}/calendars/primary/events/${encodeURIComponent(externalEventId)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${credentials.accessToken}` },
      }
    ).catch(() => {
      throw new CalendarError("Não foi possível falar com o Google", "TRANSIENT");
    });

    // 404 e 410 significam que já não está lá: o objetivo foi atingido
    if (response.status === 404 || response.status === 410) return;
    if (!response.ok) throw this.classify(response.status, await response.text());
  }
}

let provider: CalendarProvider | null = null;

export function calendarProvider(): CalendarProvider {
  if (!provider) provider = new GoogleCalendarProvider();
  return provider;
}

/// Usado pelos testes para exercitar falha e revogação sem rede.
export function setCalendarProvider(custom: CalendarProvider | null): void {
  provider = custom;
}
