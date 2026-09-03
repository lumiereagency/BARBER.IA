"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@barber/db";
import { InvalidPhoneError } from "@barber/domain";
import {
  InvalidCodeError,
  TooManyRequestsError,
  closeCustomerAccount,
  requestAccessCode,
  verifyAccessCode,
} from "@/lib/customer-account";
import {
  createCustomerSession,
  destroyCustomerSession,
  requireCustomerSession,
} from "@/lib/customer-session";

export interface CustomerFormState {
  error?: string;
  /// Passa para a etapa do código quando o envio foi aceito
  codeSent?: boolean;
  phone?: string;
  info?: string;
}

export async function sendCode(
  _state: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const phone = String(formData.get("phone") ?? "").trim();

  try {
    await requestAccessCode(phone);
  } catch (error) {
    if (error instanceof InvalidPhoneError) {
      return { error: "Telefone inválido. Confira o número." };
    }
    if (error instanceof TooManyRequestsError) {
      return { error: error.message };
    }
    console.error("[cliente] envio de código falhou", error);
    return { error: "Não foi possível enviar o código agora. Tente de novo." };
  }

  // A mensagem é a mesma exista ou não cadastro para este telefone
  return { codeSent: true, phone };
}

export async function confirmCode(
  _state: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const phone = String(formData.get("phone") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();

  try {
    const { customerId } = await verifyAccessCode(phone, code);
    await createCustomerSession(customerId);
  } catch (error) {
    if (error instanceof InvalidCodeError) {
      return { codeSent: true, phone, error: "Código inválido ou expirado." };
    }
    if (error instanceof TooManyRequestsError) {
      return { error: error.message };
    }
    console.error("[cliente] verificação falhou", error);
    return { codeSent: true, phone, error: "Não foi possível confirmar. Tente de novo." };
  }

  redirect("/minha-conta");
}

export async function signOutCustomer(): Promise<void> {
  await destroyCustomerSession();
  redirect("/entrar-cliente");
}

export async function updateCommunicationPreferences(formData: FormData): Promise<void> {
  const session = await requireCustomerSession();
  const relationId = String(formData.get("relationId") ?? "");

  // A relação precisa ser deste cliente: id trocado no formulário não altera
  // preferência de terceiro.
  const relation = await prisma.barbershopCustomer.findFirst({
    where: { id: relationId, customerId: session.customerId },
  });
  if (!relation) return;

  const canais = ["WHATSAPP", "SMS", "EMAIL"] as const;
  const escolhidos = new Set(formData.getAll("channels").map(String));
  const textVersion = process.env.TERMS_VERSION ?? "dev-0";

  await prisma.$transaction(async (tx) => {
    for (const canal of canais) {
      const quer = escolhidos.has(canal);

      const vigente = await tx.consent.findFirst({
        where: {
          barbershopCustomerId: relation.id,
          channel: canal,
          purpose: "MARKETING",
          status: "GRANTED",
        },
        orderBy: { capturedAt: "desc" },
      });

      if (quer && !vigente) {
        await tx.consent.create({
          data: {
            barbershopId: relation.barbershopId,
            barbershopCustomerId: relation.id,
            customerId: session.customerId,
            channel: canal,
            purpose: "MARKETING",
            status: "GRANTED",
            textVersion,
            source: "customer_area",
          },
        });
      }

      // Revogar não apaga o consentimento anterior: a revogação em si precisa
      // ficar registrada, com data (Parte 2 §13).
      if (!quer && vigente) {
        await tx.consent.update({
          where: { id: vigente.id },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
      }
    }
  });

  revalidatePath("/minha-conta/preferencias");
}

export async function closeAccount(): Promise<void> {
  const session = await requireCustomerSession();
  await closeCustomerAccount(session.customerId);
  // A sessão é derrubada aqui, na camada que conhece o cookie
  await destroyCustomerSession();
  redirect("/");
}
