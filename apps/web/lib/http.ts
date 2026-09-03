// Utilidades das rotas públicas: resolução de tenant, erros tipados e
// idempotência.

import { prisma } from "@barber/db";
import type { ZodSchema } from "zod";
import {
  HoldExpiredError,
  NotFoundError,
  PolicyError,
  SlotUnavailableError,
} from "./booking";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SLOT_UNAVAILABLE"
  | "HOLD_EXPIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "FORBIDDEN"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SLOT_UNAVAILABLE: 409,
  HOLD_EXPIRED: 410,
  IDEMPOTENCY_CONFLICT: 409,
  FORBIDDEN: 403,
  INTERNAL_ERROR: 500,
};

export function fail(code: ErrorCode, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, details } }, { status: STATUS_BY_CODE[code] });
}

/// Traduz erro de domínio em resposta. Erro inesperado nunca vaza detalhe
/// interno para o cliente, mas sempre aparece no log do servidor.
export function failFrom(error: unknown): Response {
  if (error instanceof SlotUnavailableError) {
    return fail("SLOT_UNAVAILABLE", "Este horário acabou de ser preenchido.");
  }
  if (error instanceof HoldExpiredError) {
    return fail("HOLD_EXPIRED", "Sua reserva temporária expirou. Escolha o horário de novo.");
  }
  if (error instanceof NotFoundError) {
    return fail("NOT_FOUND", error.message);
  }
  if (error instanceof PolicyError) {
    return fail("FORBIDDEN", error.message);
  }
  console.error("[api] erro não tratado", error);
  return fail("INTERNAL_ERROR", "Não foi possível concluir. Tente de novo.");
}

/// O tenant vem sempre do slug da rota pública, nunca de campo enviado pelo
/// cliente (Parte 2 §3). Barbearia suspensa não recebe reserva (Parte 3 §11).
export async function resolveShopBySlug(slug: string) {
  const shop = await prisma.barbershop.findUnique({ where: { slug } });
  if (!shop || shop.status === "SUSPENDED") return null;
  return shop;
}

export async function parseBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail("VALIDATION_ERROR", "Corpo inválido") };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail("VALIDATION_ERROR", "Dados inválidos", parsed.error.flatten()),
    };
  }
  return { ok: true, data: parsed.data };
}

/// Idempotência de requisição (Parte 2 §9). Repetir a chamada com a mesma
/// chave devolve a resposta original em vez de criar segunda reserva.
///
/// A unicidade de (scope, key) no banco é o que decide a corrida: dois envios
/// simultâneos, um cria a chave e executa, o outro esbarra na constraint.
export async function withIdempotency<T>(
  scope: string,
  key: string | null,
  requestHash: string,
  handler: () => Promise<{ status: number; body: T }>
): Promise<Response> {
  if (!key) {
    const result = await handler();
    return Response.json(result.body, { status: result.status });
  }

  const existing = await prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return fail("IDEMPOTENCY_CONFLICT", "Esta chave já foi usada com outros dados.");
    }
    if (existing.status === "COMPLETED" && existing.responseSnapshot) {
      const snapshot = existing.responseSnapshot as { status: number; body: unknown };
      return Response.json(snapshot.body, { status: snapshot.status });
    }
    // Ainda em andamento: o cliente repetiu antes da primeira terminar
    return fail("IDEMPOTENCY_CONFLICT", "Requisição em andamento. Aguarde.");
  }

  try {
    await prisma.idempotencyKey.create({
      data: {
        scope,
        key,
        requestHash,
        status: "IN_PROGRESS",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  } catch {
    return fail("IDEMPOTENCY_CONFLICT", "Requisição em andamento. Aguarde.");
  }

  try {
    const result = await handler();
    await prisma.idempotencyKey.update({
      where: { scope_key: { scope, key } },
      data: {
        status: "COMPLETED",
        responseSnapshot: { status: result.status, body: result.body } as never,
      },
    });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    // Falha não pode deixar a chave travada: sem isto, um erro transitório
    // impediria o cliente de tentar de novo com a mesma chave.
    await prisma.idempotencyKey.delete({ where: { scope_key: { scope, key } } }).catch(() => {});
    throw error;
  }
}

export async function hashRequest(body: unknown): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}
