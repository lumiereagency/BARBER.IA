"use server";

// Ações de configuração (Marco 1).
//
// Toda ação: revalida a permissão no servidor, confirma que o registro é da
// barbearia da sessão antes de tocar nele, e nunca aceita `barbershopId` vindo
// do formulário. Sem a checagem de posse, trocar o id no HTML editaria dado de
// outra barbearia — o IDOR que a Parte 3 §10 manda testar.

import { revalidatePath } from "next/cache";
import { prisma } from "@barber/db";
import { isValidSlug, slugify } from "@barber/domain";
import { assertBelongsToTenant, requirePermission } from "@/lib/auth";

export interface ActionState {
  error?: string;
  ok?: boolean;
}

function parseMoneyToMinor(raw: string): number {
  // Aceita "50", "50,00" e "50.00" — o dono digita como quiser
  const normalized = raw.trim().replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) throw new Error("Preço inválido");
  return Math.round(value * 100);
}

function parsePositiveInt(raw: string, field: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} inválido`);
  return value;
}

// --- Serviços ---------------------------------------------------------------

export async function saveService(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("services.write");
  const id = String(formData.get("id") ?? "");

  try {
    const data = {
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || null,
      priceMinor: parseMoneyToMinor(String(formData.get("price") ?? "")),
      durationMinutes: parsePositiveInt(String(formData.get("duration") ?? ""), "Duração"),
      bufferBeforeMinutes: Number(formData.get("bufferBefore") ?? 0) || 0,
      bufferAfterMinutes: Number(formData.get("bufferAfter") ?? 0) || 0,
      active: formData.get("active") === "on",
    };

    if (data.name.length < 2) return { error: "Dê um nome ao serviço." };

    if (id) {
      await assertBelongsToTenant(session, "service", id);
      await prisma.service.update({ where: { id }, data });
    } else {
      await prisma.service.create({ data: { ...data, barbershopId: session.barbershopId } });
    }
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath("/gestao/servicos");
  return { ok: true };
}

export async function deleteService(formData: FormData): Promise<void> {
  const session = await requirePermission("services.write");
  const id = String(formData.get("id") ?? "");
  await assertBelongsToTenant(session, "service", id);

  // Serviço com histórico não é apagado: desativar preserva o snapshot dos
  // agendamentos passados e some da página pública do mesmo jeito.
  const used = await prisma.appointment.count({ where: { serviceId: id } });
  if (used > 0) {
    await prisma.service.update({ where: { id }, data: { active: false } });
  } else {
    await prisma.professionalService.deleteMany({ where: { serviceId: id } });
    await prisma.service.delete({ where: { id } });
  }

  revalidatePath("/gestao/servicos");
}

// --- Profissionais ----------------------------------------------------------

export async function saveProfessional(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requirePermission("professionals.write");
  const id = String(formData.get("id") ?? "");

  const displayName = String(formData.get("displayName") ?? "").trim();
  if (displayName.length < 2) return { error: "Dê um nome ao profissional." };

  const data = {
    displayName,
    bio: String(formData.get("bio") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    bookingPriority: Number(formData.get("bookingPriority") ?? 0) || 0,
    active: formData.get("active") === "on",
  };

  if (id) {
    await assertBelongsToTenant(session, "professional", id);
    await prisma.professional.update({ where: { id }, data });
  } else {
    await prisma.professional.create({ data: { ...data, barbershopId: session.barbershopId } });
  }

  revalidatePath("/equipe");
  return { ok: true };
}

/// Quais serviços o profissional realiza. Sem pelo menos um vínculo, ele nunca
/// aparece na agenda pública — a tela avisa isso.
export async function setProfessionalServices(formData: FormData): Promise<void> {
  const session = await requirePermission("professionals.write");
  const professionalId = String(formData.get("professionalId") ?? "");
  await assertBelongsToTenant(session, "professional", professionalId);

  const selected = formData.getAll("serviceIds").map(String);

  // Só serviços da própria barbearia entram, mesmo que o formulário venha
  // adulterado com id de outra.
  const valid = await prisma.service.findMany({
    where: { id: { in: selected }, barbershopId: session.barbershopId },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.professionalService.deleteMany({ where: { professionalId } }),
    prisma.professionalService.createMany({
      data: valid.map((service) => ({
        barbershopId: session.barbershopId,
        professionalId,
        serviceId: service.id,
      })),
    }),
  ]);

  revalidatePath("/equipe");
}

// --- Jornada de trabalho ----------------------------------------------------

export async function saveWorkingHours(formData: FormData): Promise<void> {
  const session = await requirePermission("professionals.write");
  const professionalId = String(formData.get("professionalId") ?? "");
  await assertBelongsToTenant(session, "professional", professionalId);

  const rows: Array<{ weekday: number; startLocalTime: string; endLocalTime: string }> = [];

  for (let weekday = 0; weekday <= 6; weekday++) {
    if (formData.get(`day-${weekday}`) !== "on") continue;
    const start = String(formData.get(`start-${weekday}`) ?? "");
    const end = String(formData.get(`end-${weekday}`) ?? "");
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue;
    if (end <= start) continue; // ignora faixa invertida em vez de gravar agenda impossível
    rows.push({ weekday, startLocalTime: start, endLocalTime: end });
  }

  await prisma.$transaction([
    prisma.workingHours.deleteMany({ where: { professionalId } }),
    prisma.workingHours.createMany({
      data: rows.map((row) => ({ ...row, barbershopId: session.barbershopId, professionalId })),
    }),
  ]);

  revalidatePath("/equipe");
}

export async function addScheduleException(formData: FormData): Promise<void> {
  const session = await requirePermission("professionals.write");
  const professionalId = String(formData.get("professionalId") ?? "");
  await assertBelongsToTenant(session, "professional", professionalId);

  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "") || startDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return;

  await prisma.scheduleException.create({
    data: {
      barbershopId: session.barbershopId,
      professionalId,
      startDate: new Date(`${startDate}T00:00:00Z`),
      endDate: new Date(`${endDate}T00:00:00Z`),
      type: String(formData.get("type") ?? "UNAVAILABLE") === "VACATION" ? "VACATION" : "UNAVAILABLE",
      reason: String(formData.get("reason") ?? "").trim() || null,
    },
  });

  revalidatePath("/equipe");
}

export async function deleteScheduleException(formData: FormData): Promise<void> {
  const session = await requirePermission("professionals.write");
  const id = String(formData.get("id") ?? "");
  await assertBelongsToTenant(session, "scheduleException", id);
  await prisma.scheduleException.delete({ where: { id } });
  revalidatePath("/equipe");
}

// --- Dados da barbearia -----------------------------------------------------

export async function saveBarbershop(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requirePermission("barbershop.settings.write");

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Dê um nome à barbearia." };

  const desiredSlug = slugify(String(formData.get("slug") ?? ""));
  if (!desiredSlug || !isValidSlug(desiredSlug)) {
    return { error: "Endereço da página inválido. Use letras, números e hífen." };
  }

  const timezone = String(formData.get("timezone") ?? "");
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone });
  } catch {
    return { error: "Fuso horário inválido." };
  }

  try {
    await prisma.barbershop.update({
      where: { id: session.barbershopId },
      data: {
        name,
        slug: desiredSlug,
        timezone,
        phone: String(formData.get("phone") ?? "").trim() || null,
        cancellationPolicy: String(formData.get("cancellationPolicy") ?? "").trim() || null,
        holdDurationMinutes: Number(formData.get("holdDurationMinutes") ?? 5) || 5,
        slotGranularityMinutes: Number(formData.get("slotGranularityMinutes") ?? 15) || 15,
        minimumNoticeMinutes: Number(formData.get("minimumNoticeMinutes") ?? 0) || 0,
        cancellationNoticeMinutes: Number(formData.get("cancellationNoticeMinutes") ?? 0) || 0,
        bookingWindowDays: Number(formData.get("bookingWindowDays") ?? 60) || 60,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return { error: "Este endereço de página já está em uso por outra barbearia." };
    }
    throw error;
  }

  revalidatePath("/gestao/configuracoes");
  return { ok: true };
}
