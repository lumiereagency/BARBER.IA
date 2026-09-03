"use server";

// Ações da operação do dia (Marco 3).
//
// Cada ação resolve o escopo antes de agir: quem tem `appointments.write.all`
// mexe em qualquer agenda; o barbeiro sem essa permissão só na própria. O
// escopo é calculado aqui e passado ao serviço, que o aplica dentro da mesma
// transação — a tela nunca é a barreira.

import { revalidatePath } from "next/cache";
import { localDateTimeToInstant } from "@barber/domain";
import { prisma } from "@barber/db";
import {
  blockTime,
  cancelByShop,
  completeAppointment,
  createManualAppointment,
  markNoShow,
  revertToConfirmed,
} from "@/lib/booking";
import { requirePermission, type ActiveSession } from "@/lib/auth";
import { can } from "@barber/domain";

export interface ActionState {
  error?: string;
  ok?: boolean;
  aviso?: string;
}

/// Nulo = pode agir em qualquer profissional. Preenchido = restrito ao próprio.
function scopeFor(session: ActiveSession): string | null {
  if (can(session.membership, "appointments.write.all")) return null;
  return session.membership.professionalId ?? "sem-vinculo";
}

function refresh() {
  revalidatePath("/agenda");
  revalidatePath("/hoje");
}

async function runStatusAction(
  formData: FormData,
  action: (input: {
    barbershopId: string;
    appointmentId: string;
    actorId: string;
    restrictToProfessionalId?: string | null;
  }) => Promise<void>
): Promise<void> {
  const session = await requirePermission("appointments.write.own");
  await action({
    barbershopId: session.barbershopId,
    appointmentId: String(formData.get("appointmentId") ?? ""),
    actorId: session.userId,
    restrictToProfessionalId: scopeFor(session),
  });
  refresh();
}

export async function markCompleted(formData: FormData): Promise<void> {
  await runStatusAction(formData, completeAppointment);
}

export async function markAbsent(formData: FormData): Promise<void> {
  await runStatusAction(formData, markNoShow);
}

export async function undoStatus(formData: FormData): Promise<void> {
  await runStatusAction(formData, revertToConfirmed);
}

export async function cancelAsShop(formData: FormData): Promise<void> {
  await runStatusAction(formData, cancelByShop);
}

export async function bookManually(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requirePermission("appointments.write.own");

  const professionalId = String(formData.get("professionalId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerPhone = String(formData.get("customerPhone") ?? "").trim();

  if (!professionalId || !serviceId || !date || !time) {
    return { error: "Escolha profissional, serviço, data e hora." };
  }
  if (customerName.length < 2) return { error: "Informe o nome do cliente." };

  const shop = await prisma.barbershop.findUniqueOrThrow({
    where: { id: session.barbershopId },
    select: { timezone: true },
  });

  try {
    // A hora digitada é hora local da barbearia; a conversão para instante
    // acontece aqui, no servidor, com o fuso dela.
    const startsAt = localDateTimeToInstant(date, time, shop.timezone);

    await createManualAppointment({
      barbershopId: session.barbershopId,
      professionalId,
      serviceId,
      startsAt,
      customerName,
      customerPhone,
      actorId: session.userId,
      restrictToProfessionalId: scopeFor(session),
    });
  } catch (error) {
    const name = (error as Error).name;
    if (name === "SlotUnavailableError") {
      return { error: "Este profissional já tem atendimento nesse horário." };
    }
    if (name === "InvalidPhoneError") {
      return { error: "Telefone inválido." };
    }
    if (name === "PolicyError" || name === "NotFoundError") {
      return { error: (error as Error).message };
    }
    console.error("[agenda] reserva manual falhou", error);
    return { error: "Não foi possível criar a reserva." };
  }

  refresh();
  return { ok: true };
}

export async function blockPeriod(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requirePermission("schedule.write.own");

  const professionalId = String(formData.get("professionalId") ?? "");
  const date = String(formData.get("date") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");

  if (!professionalId || !date || !from || !to) {
    return { error: "Escolha profissional, data e o intervalo." };
  }

  const shop = await prisma.barbershop.findUniqueOrThrow({
    where: { id: session.barbershopId },
    select: { timezone: true },
  });

  try {
    const { conflitos } = await blockTime({
      barbershopId: session.barbershopId,
      professionalId,
      startsAt: localDateTimeToInstant(date, from, shop.timezone),
      endsAt: localDateTimeToInstant(date, to, shop.timezone),
      reason: String(formData.get("reason") ?? "").trim() || undefined,
      actorId: session.userId,
      restrictToProfessionalId: scopeFor(session),
    });

    refresh();

    // O bloqueio não cancela reserva já confirmada por conta própria — quem
    // decide o que fazer com ela é a barbearia. Mas ela precisa saber.
    if (conflitos > 0) {
      return {
        ok: true,
        aviso: `Bloqueio criado, mas há ${conflitos} atendimento(s) já confirmado(s) nesse período. Eles continuam na agenda — cancele ou remarque se precisar.`,
      };
    }
    return { ok: true };
  } catch (error) {
    const name = (error as Error).name;
    if (name === "PolicyError" || name === "NotFoundError") {
      return { error: (error as Error).message };
    }
    console.error("[agenda] bloqueio falhou", error);
    return { error: "Não foi possível criar o bloqueio." };
  }
}

export async function removeBlock(formData: FormData): Promise<void> {
  const session = await requirePermission("schedule.write.own");
  const id = String(formData.get("id") ?? "");

  const block = await prisma.scheduleBlock.findFirst({
    where: { id, barbershopId: session.barbershopId },
  });
  if (!block) return;

  const scope = scopeFor(session);
  if (scope && block.professionalId !== scope) return;

  await prisma.scheduleBlock.delete({ where: { id } });
  refresh();
}
