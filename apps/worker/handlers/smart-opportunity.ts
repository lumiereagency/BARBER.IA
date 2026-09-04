// Detecção de vaga por cancelamento (Marco 6.3, Agenda Inteligente).
//
// Convergente, como a sincronização de calendário: recebe só o id do
// agendamento cancelado e relê o estado atual do banco, em vez de confiar no
// payload do evento — o horário pode ter sido reocupado entre o cancelamento
// e o processamento.
//
// Reaproveita exatamente o horário liberado (mesmo starts_at/ends_at do
// agendamento cancelado): a vaga anunciada é a que o cliente perdeu, não uma
// janela recalculada — é isso que torna a estimativa de receita uma
// consulta, não uma invenção (docs/tech-review-part2.md §3.5).

import { prisma } from "@barber/db";
import { barbershopFeatures } from "@barber/entitlements";
import { generateToken, hashToken } from "@barber/domain";

/// Vaga só vale a pena anunciar perto o bastante: reagendar um cancelamento
/// de daqui a três meses não tem candidato disponível para decidir agora.
const JANELA_HORAS = 72;

function tokenSecret(): string {
  const secret = process.env.TOKEN_HMAC_SECRET;
  if (!secret) throw new Error("TOKEN_HMAC_SECRET não configurado");
  return secret;
}

export interface DetectSmartOpportunityPayload {
  appointmentId: string;
}

export async function detectSmartOpportunity(
  payload: DetectSmartOpportunityPayload
): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: payload.appointmentId },
  });
  // Apagado entre enfileirar e processar: sem alvo, sem vaga.
  if (!appointment) return;
  if (appointment.status !== "CANCELLED_BY_CUSTOMER" && appointment.status !== "CANCELLED_BY_SHOP") {
    return;
  }
  if (appointment.startsAt <= new Date()) return;

  const janelaLimite = new Date(Date.now() + JANELA_HORAS * 60 * 60 * 1000);
  if (appointment.startsAt > janelaLimite) return;

  const features = await barbershopFeatures(appointment.barbershopId);
  if (!features.smartAgenda) return;

  // Idempotência: reentrega do outbox não pode duplicar a mesma vaga.
  const existente = await prisma.smartOpportunity.findFirst({
    where: {
      barbershopId: appointment.barbershopId,
      professionalId: appointment.professionalId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: "OPEN",
    },
  });
  if (existente) return;

  // Revalida que o horário segue de fato livre: outro cliente pode ter
  // reservado o mesmo horário entre o cancelamento e este processamento.
  const [conflitoAgendamento, conflitoHold] = await Promise.all([
    prisma.appointment.findFirst({
      where: {
        professionalId: appointment.professionalId,
        status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] },
        occupiesFrom: { lt: appointment.occupiesTo },
        occupiesTo: { gt: appointment.occupiesFrom },
      },
    }),
    prisma.appointmentHold.findFirst({
      where: {
        professionalId: appointment.professionalId,
        expiresAt: { gt: new Date() },
        occupiesFrom: { lt: appointment.occupiesTo },
        occupiesTo: { gt: appointment.occupiesFrom },
      },
    }),
  ]);
  if (conflitoAgendamento || conflitoHold) return;

  const compatibleServiceIds = await compatibleServicesFor(appointment);
  // O serviço cancelado sempre coube ali — é sempre compatível com a própria
  // vaga que ele deixou.
  if (!compatibleServiceIds.includes(appointment.serviceId)) {
    compatibleServiceIds.push(appointment.serviceId);
  }

  const token = generateToken();

  await prisma.smartOpportunity.create({
    data: {
      barbershopId: appointment.barbershopId,
      professionalId: appointment.professionalId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      compatibleServiceIds,
      // Valor de UMA vaga preenchida: o preço do próprio serviço que a
      // liberou, não uma soma ou uma média (docs/tech-review-part2.md §3.5).
      estimatedRevenueMinor: appointment.priceSnapshotMinor,
      status: "OPEN",
      expiresAt: appointment.startsAt,
      shareTokenHash: hashToken(token, tokenSecret()),
    },
  });
}

/// Serviços que este profissional atende e cujo footprint (buffers + duração)
/// cabe no espaço exato que o cancelamento liberou — a vaga é anunciada no
/// mesmo horário de início, nunca recalculada para outro horário.
async function compatibleServicesFor(appointment: {
  barbershopId: string;
  professionalId: string;
  occupiesFrom: Date;
  occupiesTo: Date;
}): Promise<string[]> {
  const footprintMinutes =
    (appointment.occupiesTo.getTime() - appointment.occupiesFrom.getTime()) / 60_000;

  const links = await prisma.professionalService.findMany({
    where: {
      barbershopId: appointment.barbershopId,
      professionalId: appointment.professionalId,
      active: true,
      service: { active: true },
    },
    include: { service: true },
  });

  return links
    .filter((link) => {
      const duracao = link.customDurationMinutes ?? link.service.durationMinutes;
      const candidato =
        duracao + link.service.bufferBeforeMinutes + link.service.bufferAfterMinutes;
      return candidato <= footprintMinutes;
    })
    .map((link) => link.serviceId);
}
