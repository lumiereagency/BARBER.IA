"use server";

import { redirect } from "next/navigation";
import { prisma } from "@barber/db";
import { verifyPassword } from "@barber/domain";
import { createSession, destroySession } from "@/lib/auth";
import {
  EmailAlreadyUsedError,
  InvalidSlugError,
  WeakPasswordError,
  signUpOwner,
} from "@/lib/onboarding";

export interface FormState {
  error?: string;
}

/// Tempo constante o suficiente: e-mail inexistente e senha errada devolvem a
/// mesma mensagem e passam pelo mesmo custo de verificação, para a tela não
/// virar um oráculo de quais e-mails têm conta (Parte 3 §10, enumeração).
const DUMMY_HASH =
  "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export async function signIn(_state: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Informe e-mail e senha." };

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { where: { status: "ACTIVE" }, take: 1 } },
  });

  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid || !user.active) {
    return { error: "E-mail ou senha incorretos." };
  }

  const membership = user.memberships[0];
  if (!membership) {
    return { error: "Sua conta não está vinculada a nenhuma barbearia ativa." };
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id, membership.barbershopId);

  redirect("/hoje");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/entrar");
}

export async function signUp(_state: FormState, formData: FormData): Promise<FormState> {
  const input = {
    ownerName: String(formData.get("ownerName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    barbershopName: String(formData.get("barbershopName") ?? "").trim(),
    timezone: String(formData.get("timezone") ?? "America/Sao_Paulo"),
  };

  if (!input.ownerName || !input.email || !input.barbershopName) {
    return { error: "Preencha todos os campos." };
  }

  try {
    const result = await signUpOwner(input);
    await createSession(result.userId, result.barbershopId);
  } catch (error) {
    if (error instanceof EmailAlreadyUsedError) {
      return { error: "Já existe uma conta com este e-mail. Tente entrar." };
    }
    if (error instanceof WeakPasswordError || error instanceof InvalidSlugError) {
      return { error: error.message };
    }
    console.error("[signup] falhou", error);
    return { error: "Não foi possível criar a conta. Tente de novo." };
  }

  redirect("/hoje");
}
