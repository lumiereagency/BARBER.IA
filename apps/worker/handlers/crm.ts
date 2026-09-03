// Recalcula os indicadores de CRM de uma relação cliente–barbearia.
//
// O cálculo em si vive no domínio (função pura, testada sem banco); aqui só
// carregamos o histórico e gravamos o resultado.
//
// Idempotente por construção: o resultado depende apenas do histórico, então
// reprocessar o mesmo evento produz exatamente o mesmo estado. Isso é o que
// permite ao outbox reentregar sem medo.

import { prisma } from "@barber/db";
import { computeCrmSummary, type CrmAppointment } from "@barber/domain";

export interface RecomputeCrmPayload {
  barbershopCustomerId: string;
}

export async function recomputeCustomerCrm(payload: RecomputeCrmPayload): Promise<void> {
  const relation = await prisma.barbershopCustomer.findUnique({
    where: { id: payload.barbershopCustomerId },
  });

  // Relação apagada entre o enfileiramento e o processamento não é erro:
  // o efeito simplesmente não tem mais alvo.
  if (!relation) return;

  const appointments = await prisma.appointment.findMany({
    where: { barbershopCustomerId: relation.id },
    select: {
      status: true,
      startsAt: true,
      priceSnapshotMinor: true,
      professionalId: true,
      serviceId: true,
    },
  });

  const historico: CrmAppointment[] = appointments.map((item) => ({
    status: item.status,
    startsAt: item.startsAt,
    // O snapshot é o que vale: o preço do serviço pode ter mudado desde então
    priceMinor: item.priceSnapshotMinor,
    professionalId: item.professionalId,
    serviceId: item.serviceId,
  }));

  const resumo = computeCrmSummary(historico);

  await prisma.barbershopCustomer.update({
    where: { id: relation.id },
    data: {
      firstVisitAt: resumo.firstVisitAt,
      lastVisitAt: resumo.lastVisitAt,
      completedVisitsCount: resumo.completedVisitsCount,
      cancelledCount: resumo.cancelledCount,
      noShowCount: resumo.noShowCount,
      totalSpentMinor: resumo.totalSpentMinor,
      averageTicketMinor: resumo.averageTicketMinor,
      averageReturnDays: resumo.averageReturnDays,
      preferredProfessionalId: resumo.preferredProfessionalId,
      preferredServiceId: resumo.preferredServiceId,
    },
  });
}
