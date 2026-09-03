// Sessão do consumidor: a camada que fala com cookies.
//
// Separada de customer-account.ts de propósito — aquela é lógica de banco e
// roda em qualquer lugar; esta depende do runtime do Next.

import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@barber/db";
import { generateToken, hashToken } from "@barber/domain";

const COOKIE_NAME = "barber_customer_session";
const SESSION_DAYS = 90;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET não configurado");
  return value;
}

export async function createCustomerSession(customerId: string): Promise<void> {
  const token = generateToken();

  await prisma.customerSession.create({
    data: {
      customerId,
      tokenHash: hashToken(token, secret()),
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

export async function destroyCustomerSession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (token) {
    // Revogar no banco, não só apagar o cookie: cópia feita antes do logout
    // continuaria valendo se a sessão vivesse só no navegador.
    await prisma.customerSession
      .updateMany({
        where: { tokenHash: hashToken(token, secret()), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => {});
  }
  cookies().delete(COOKIE_NAME);
}

export interface CustomerSessionData {
  customerId: string;
  displayName: string;
  normalizedPhone: string | null;
}

export const getCustomerSession = cache(async (): Promise<CustomerSessionData | null> => {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.customerSession.findUnique({
    where: { tokenHash: hashToken(token, secret()) },
    include: { customer: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.customer.accountStatus === "ANONYMIZED") return null;

  return {
    customerId: session.customerId,
    displayName: session.customer.displayName,
    normalizedPhone: session.customer.normalizedPhone,
  };
});

export async function requireCustomerSession(): Promise<CustomerSessionData> {
  const session = await getCustomerSession();
  if (!session) throw new Error("UNAUTHENTICATED_CUSTOMER");
  return session;
}
