// Entrada na lista de espera (Marco 6.5).
//
// A pontuação gravada na entrada é a propensão geral de retorno do cliente
// (a mesma que popula customer_return_scores, recomputada junto do CRM) — não
// o casamento com uma vaga específica, que é sempre recalculado na hora
// (Decisão #10 da Parte 1: ordena pela pontuação explicável, não por ordem
// de chegada).

import { Prisma, prisma } from "@barber/db";
import { normalizePhoneBR } from "@barber/domain";
import { NotFoundError, PolicyError } from "./booking.ts";

export interface JoinWaitlistInput {
  barbershopId: string;
  customerName: string;
  customerPhone: string;
  serviceId?: string;
  professionalId?: string;
  dateFrom?: string;
  dateTo?: string;
  timeRangeStart?: string;
  timeRangeEnd?: string;
  acceptedTermsVersion: string;
  /// Entrar na fila implica ser contatado sobre ESTA fila — consentimento
  /// operacional separado do aceite geral dos termos (Parte 2 §5.3).
  contactConsentTextVersion: string;
}

export interface JoinWaitlistResult {
  id: string;
  status: "WAITING";
}

export async function joinWaitlist(input: JoinWaitlistInput): Promise<JoinWaitlistResult> {
  const normalizedPhone = normalizePhoneBR(input.customerPhone);

  return prisma.$transaction(async (tx) => {
    if (input.serviceId) {
      const service = await tx.service.findFirst({
        where: { id: input.serviceId, barbershopId: input.barbershopId, active: true },
      });
      if (!service) throw new NotFoundError("Serviço não encontrado");
    }
    if (input.professionalId) {
      const professional = await tx.professional.findFirst({
        where: { id: input.professionalId, barbershopId: input.barbershopId, active: true },
      });
      if (!professional) throw new NotFoundError("Profissional não encontrado");
    }
    if (input.serviceId && input.professionalId) {
      const link = await tx.professionalService.findFirst({
        where: {
          barbershopId: input.barbershopId,
          serviceId: input.serviceId,
          professionalId: input.professionalId,
          active: true,
        },
      });
      if (!link) throw new PolicyError("Este profissional não realiza esse serviço");
    }

    const relation = await tx.barbershopCustomer.upsert({
      where: {
        barbershopId_normalizedPhone: { barbershopId: input.barbershopId, normalizedPhone },
      },
      update: { currentName: input.customerName },
      create: {
        barbershopId: input.barbershopId,
        normalizedPhone,
        currentName: input.customerName,
      },
    });

    // Snapshot da propensão geral, se já existir — nunca inventa uma
    // pontuação para quem ainda não foi calculado pelo job do CRM.
    const returnScore = await tx.customerReturnScore.findUnique({
      where: { barbershopCustomerId: relation.id },
    });

    const entry = await tx.waitlistEntry.create({
      data: {
        barbershopId: input.barbershopId,
        barbershopCustomerId: relation.id,
        serviceId: input.serviceId ?? null,
        professionalId: input.professionalId ?? null,
        dateFrom: input.dateFrom ? new Date(`${input.dateFrom}T00:00:00Z`) : null,
        dateTo: input.dateTo ? new Date(`${input.dateTo}T00:00:00Z`) : null,
        timeRangeStart: input.timeRangeStart ?? null,
        timeRangeEnd: input.timeRangeEnd ?? null,
        status: "WAITING",
        rankScore: returnScore?.score ?? null,
        rankReasons: (returnScore?.reasons as unknown as Prisma.InputJsonValue) ?? undefined,
      },
    });

    await tx.consent.create({
      data: {
        barbershopId: input.barbershopId,
        barbershopCustomerId: relation.id,
        channel: "WHATSAPP",
        purpose: "OPERATIONAL",
        status: "GRANTED",
        textVersion: input.acceptedTermsVersion,
        source: "public_waitlist",
      },
    });
    await tx.consent.create({
      data: {
        barbershopId: input.barbershopId,
        barbershopCustomerId: relation.id,
        channel: "WHATSAPP",
        purpose: "OPERATIONAL",
        status: "GRANTED",
        textVersion: input.contactConsentTextVersion,
        source: "public_waitlist",
      },
    });

    return { id: entry.id, status: "WAITING" as const };
  });
}
