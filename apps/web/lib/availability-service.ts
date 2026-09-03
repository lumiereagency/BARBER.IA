// Carrega o estado da agenda e delega o cálculo ao motor puro do domínio.
// Nenhuma regra de disponibilidade vive aqui — o front nunca recalcula agenda
// (Parte 3 §16), e esta camada só busca dados e traduz formatos.

import { prisma } from "@barber/db";
import {
  computeAvailability,
  resolveAnyProfessional,
  type AvailabilityDay,
  type ProfessionalAvailabilityInput,
} from "@barber/domain";

export interface LoadAvailabilityInput {
  barbershopId: string;
  serviceId: string;
  professionalId?: string;
  from: string;
  to: string;
  now?: Date;
}

export async function loadAvailability(
  input: LoadAvailabilityInput
): Promise<{ timeZone: string; days: AvailabilityDay[] }> {
  const barbershop = await prisma.barbershop.findUniqueOrThrow({
    where: { id: input.barbershopId },
  });
  const service = await prisma.service.findUniqueOrThrow({ where: { id: input.serviceId } });

  const links = await prisma.professionalService.findMany({
    where: {
      barbershopId: input.barbershopId,
      serviceId: input.serviceId,
      active: true,
      professionalId: input.professionalId,
      professional: { active: true },
    },
    include: { professional: true },
  });

  // Janela de carga com folga de um dia em cada ponta: um compromisso que
  // começa no dia anterior pode invadir o começo do dia consultado.
  const rangeStart = new Date(`${input.from}T00:00:00Z`);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 1);
  const rangeEnd = new Date(`${input.to}T00:00:00Z`);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 2);

  const professionalIds = links.map((link) => link.professionalId);

  const [workingHours, exceptions, appointments, holds, blocks] = await Promise.all([
    prisma.workingHours.findMany({ where: { professionalId: { in: professionalIds } } }),
    prisma.scheduleException.findMany({ where: { professionalId: { in: professionalIds } } }),
    prisma.appointment.findMany({
      where: {
        professionalId: { in: professionalIds },
        status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] },
        occupiesTo: { gt: rangeStart },
        occupiesFrom: { lt: rangeEnd },
      },
      select: { professionalId: true, occupiesFrom: true, occupiesTo: true },
    }),
    prisma.appointmentHold.findMany({
      where: {
        professionalId: { in: professionalIds },
        expiresAt: { gt: new Date() },
        occupiesTo: { gt: rangeStart },
        occupiesFrom: { lt: rangeEnd },
      },
      select: { professionalId: true, occupiesFrom: true, occupiesTo: true },
    }),
    prisma.scheduleBlock.findMany({
      where: {
        professionalId: { in: professionalIds },
        endsAt: { gt: rangeStart },
        startsAt: { lt: rangeEnd },
      },
      select: { professionalId: true, startsAt: true, endsAt: true },
    }),
  ]);

  const professionals: ProfessionalAvailabilityInput[] = links.map((link) => ({
    professionalId: link.professionalId,
    displayName: link.professional.displayName,
    bookingPriority: link.professional.bookingPriority,
    priceMinor: link.customPriceMinor ?? service.priceMinor,
    durationMinutes: link.customDurationMinutes ?? service.durationMinutes,
    workingHours: workingHours
      .filter((row) => row.professionalId === link.professionalId)
      .map((row) => ({
        weekday: row.weekday,
        startLocalTime: row.startLocalTime,
        endLocalTime: row.endLocalTime,
        effectiveFrom: row.effectiveFrom?.toISOString().slice(0, 10) ?? null,
        effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
      })),
    exceptions: exceptions
      .filter((row) => row.professionalId === link.professionalId)
      .map((row) => ({
        startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate.toISOString().slice(0, 10),
        type: row.type,
        startLocalTime: row.startLocalTime,
        endLocalTime: row.endLocalTime,
      })),
    busy: [
      ...appointments
        .filter((row) => row.professionalId === link.professionalId)
        .map((row) => ({ start: row.occupiesFrom, end: row.occupiesTo })),
      ...holds
        .filter((row) => row.professionalId === link.professionalId)
        .map((row) => ({ start: row.occupiesFrom, end: row.occupiesTo })),
      ...blocks
        .filter((row) => row.professionalId === link.professionalId)
        .map((row) => ({ start: row.startsAt, end: row.endsAt })),
    ],
  }));

  const days = computeAvailability({
    timeZone: barbershop.timezone,
    from: input.from,
    to: input.to,
    now: input.now ?? new Date(),
    slotGranularityMinutes: barbershop.slotGranularityMinutes,
    minimumNoticeMinutes: barbershop.minimumNoticeMinutes,
    bookingWindowDays: barbershop.bookingWindowDays,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    professionals,
  });

  // Sem profissional escolhido, o servidor decide qual mostrar — de forma
  // determinística, para a página não trocar o barbeiro a cada recarga.
  const resolved = input.professionalId
    ? days
    : resolveAnyProfessional(
        days,
        new Map(professionals.map((p) => [p.professionalId, p.bookingPriority]))
      );

  return { timeZone: barbershop.timezone, days: resolved };
}
