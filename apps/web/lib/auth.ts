// Sessão da equipe, resolução de tenant e autorização.
//
// Três regras que não podem ser afrouxadas:
//  1. o tenant vem da SESSÃO, nunca de parâmetro enviado pelo cliente
//     (Parte 2 §3) — quem manda `barbershopId` no corpo não ganha acesso;
//  2. toda leitura e escrita operacional é filtrada por esse tenant;
//  3. a permissão é decidida pela matriz do domínio, no servidor.

import { cache } from "react";
import { cookies } from "next/headers";
import { prisma, type Prisma } from "@barber/db";
import {
  ForbiddenError,
  can,
  generateToken,
  hashToken,
  type Membership,
  type Permission,
} from "@barber/domain";

const COOKIE_NAME = "barber_session";
const SESSION_DAYS = 30;

export class UnauthenticatedError extends Error {
  constructor() {
    super("Sessão ausente ou expirada");
    this.name = "UnauthenticatedError";
  }
}

export { ForbiddenError };

function sessionSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET não configurado");
  return secret;
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  userName: string;
  barbershopId: string;
  barbershopName: string;
  barbershopSlug: string;
  membership: Membership;
}

export async function createSession(userId: string, barbershopId: string | null): Promise<void> {
  const token = generateToken();

  await prisma.userSession.create({
    data: {
      userId,
      tokenHash: hashToken(token, sessionSecret()),
      activeBarbershopId: barbershopId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5),
    },
  });

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (token) {
    // Revogar no banco, não só apagar o cookie: um cookie copiado antes do
    // logout continuaria valendo se a sessão vivesse só no navegador.
    await prisma.userSession
      .updateMany({
        where: { tokenHash: hashToken(token, sessionSecret()), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => {});
  }
  cookies().delete(COOKIE_NAME);
}

/// Resolve a sessão uma vez por requisição.
export const getSession = cache(async (): Promise<ActiveSession | null> => {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token, sessionSecret()) },
    include: {
      user: {
        include: {
          memberships: {
            where: { status: "ACTIVE" },
            include: { barbershop: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.active) return null;

  const memberships = session.user.memberships;
  if (memberships.length === 0) return null;

  const membership =
    memberships.find((item) => item.barbershopId === session.activeBarbershopId) ?? memberships[0];
  if (!membership) return null;

  return {
    sessionId: session.id,
    userId: session.userId,
    userName: session.user.name,
    barbershopId: membership.barbershopId,
    barbershopName: membership.barbershop.name,
    barbershopSlug: membership.barbershop.slug,
    membership: {
      role: membership.role,
      status: membership.status,
      professionalId: membership.professionalId,
      extraPermissions: Array.isArray(membership.permissions)
        ? (membership.permissions as string[])
        : null,
    },
  };
});

export async function requireSession(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

/// Ponto único de autorização das telas e ações do painel.
export async function requirePermission(permission: Permission): Promise<ActiveSession> {
  const session = await requireSession();
  if (!can(session.membership, permission)) throw new ForbiddenError(permission);
  return session;
}

/// Escopo de tenant para toda query operacional. Usar isto em vez de escrever
/// `barbershopId` à mão é o que impede esquecer o filtro em alguma consulta.
export function tenantScope(session: ActiveSession): { barbershopId: string } {
  return { barbershopId: session.barbershopId };
}

/// Confirma que um registro pertence à barbearia da sessão antes de alterá-lo.
/// Sem esta checagem, trocar o id no formulário editaria dado de outra
/// barbearia — é o IDOR que a Parte 3 §10 manda testar.
export async function assertBelongsToTenant(
  session: ActiveSession,
  model: "service" | "professional" | "workingHours" | "scheduleException" | "scheduleBlock",
  id: string
): Promise<void> {
  const delegates: Record<typeof model, { findFirst: (args: never) => Promise<unknown> }> = {
    service: prisma.service,
    professional: prisma.professional,
    workingHours: prisma.workingHours,
    scheduleException: prisma.scheduleException,
    scheduleBlock: prisma.scheduleBlock,
  } as never;

  const found = await delegates[model].findFirst({
    where: { id, barbershopId: session.barbershopId },
    select: { id: true },
  } as never);

  if (!found) throw new ForbiddenError(`${model}:${id}`);
}

export type TransactionClient = Prisma.TransactionClient;
