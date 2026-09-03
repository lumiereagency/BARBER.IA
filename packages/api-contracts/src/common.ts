import { z } from "zod";

/// Telefone sempre trafega em E.164; a normalização acontece no servidor antes
/// de qualquer gravação, porque é a chave de deduplicação da relação com a
/// barbearia (docs/tech-review-part2.md §2.1).
export const e164Phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Telefone deve estar em formato internacional (E.164)");

export const uuid = z.string().uuid();

/// Data civil (sem fuso) usada para consultar disponibilidade — a conversão
/// para instante acontece no servidor, no fuso da barbearia (Parte 2 §7).
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser YYYY-MM-DD");

export const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora deve ser HH:MM");

/// Instante absoluto em UTC.
export const instant = z.string().datetime({ offset: true });

/// Token opaco entregue em link (gestão, vaga, hold). O servidor guarda apenas
/// o HMAC; este é o valor cru que só existe na URL.
export const opaqueToken = z.string().min(32).max(128);

/// Chave de idempotência exigida em toda operação que cria ou muda reserva
/// (Parte 2 §9). Repetir a requisição não pode produzir segundo efeito.
export const idempotencyKey = z.string().min(16).max(128);

export const paginationQuery = z.object({
  /// Paginação por cursor, não offset (Parte 2 §16)
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const errorResponse = z.object({
  error: z.object({
    code: z.enum([
      "VALIDATION_ERROR",
      "NOT_FOUND",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "RATE_LIMITED",
      /// Slot tomado durante o fluxo — a resposta traz alternativas (Parte 1 §8)
      "SLOT_UNAVAILABLE",
      "HOLD_EXPIRED",
      "IDEMPOTENCY_CONFLICT",
      "PLAN_LIMIT_REACHED",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponse>;
