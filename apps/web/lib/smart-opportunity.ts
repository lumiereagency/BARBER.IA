// Leitura e reivindicação da vaga pública (Marco 6.4, /vaga/{token}).
//
// Abrir o link nunca reserva nada — o hold só nasce quando a pessoa avança
// para confirmar, reaproveitando createHold/confirmAppointment tal como o
// fluxo normal de agendamento: a mesma constraint de exclusão que decide
// "primeiro a confirmar leva" ali decide aqui também, sem lock novo
// (docs/tech-review-part2.md §3.5).

import { prisma } from "@barber/db";
import { addMinutes, generateToken, hashToken } from "@barber/domain";
import { NotFoundError, PolicyError, SlotUnavailableError, confirmAppointment, createHold } from "./booking.ts";

function tokenSecret(): string {
  const secret = process.env.TOKEN_HMAC_SECRET;
  if (!secret) throw new Error("TOKEN_HMAC_SECRET não configurado");
  return secret;
}

function baseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export interface GenerateShareLinkResult {
  shareUrl: string;
}

/// Gera o link compartilhável de uma vaga — só a equipe pode pedir isto, e só
/// uma vez: o token cru nunca é gravado, então perder o que foi copiado
/// significa não ter como reexibi-lo (mesma garantia dos tokens de gestão de
/// agendamento, Parte 2 §5.4).
export async function generateShareLink(
  barbershopId: string,
  opportunityId: string
): Promise<GenerateShareLinkResult> {
  const opportunity = await prisma.smartOpportunity.findFirst({
    where: { id: opportunityId, barbershopId },
  });
  if (!opportunity) throw new NotFoundError("Vaga não encontrada");
  if (opportunity.status !== "OPEN") throw new PolicyError("Esta vaga não está mais aberta");
  if (opportunity.shareTokenHash) throw new PolicyError("O link desta vaga já foi gerado");

  const token = generateToken();
  await prisma.smartOpportunity.update({
    where: { id: opportunity.id },
    data: { shareTokenHash: hashToken(token, tokenSecret()) },
  });

  return { shareUrl: `${baseUrl()}/vaga/${token}` };
}

export async function findOpenOpportunityByToken(token: string) {
  const hash = hashToken(token, tokenSecret());
  return prisma.smartOpportunity.findUnique({
    where: { shareTokenHash: hash },
    include: { barbershop: true, professional: true },
  });
}

export interface ClaimSmartOpportunityInput {
  token: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  acceptedTermsVersion: string;
}

export interface ClaimSmartOpportunityResult {
  appointmentId: string;
  managementToken: string;
}

/// Reivindica a vaga: valida que ela segue aberta e o serviço é compatível,
/// então cria o hold e confirma no mesmo instante — a pessoa nunca vê um
/// passo de "reservando", só o resultado.
export async function claimSmartOpportunity(
  input: ClaimSmartOpportunityInput
): Promise<ClaimSmartOpportunityResult> {
  const hash = hashToken(input.token, tokenSecret());
  const opportunity = await prisma.smartOpportunity.findUnique({ where: { shareTokenHash: hash } });
  if (!opportunity) throw new NotFoundError("Vaga não encontrada");
  if (opportunity.status !== "OPEN" || opportunity.expiresAt <= new Date()) {
    throw new SlotUnavailableError();
  }
  if (!opportunity.compatibleServiceIds.includes(input.serviceId)) {
    throw new PolicyError("Este serviço não está disponível para esta vaga");
  }

  const [service, link, shop] = await Promise.all([
    prisma.service.findFirst({
      where: { id: input.serviceId, barbershopId: opportunity.barbershopId, active: true },
    }),
    prisma.professionalService.findUnique({
      where: {
        professionalId_serviceId: {
          professionalId: opportunity.professionalId,
          serviceId: input.serviceId,
        },
      },
    }),
    prisma.barbershop.findUniqueOrThrow({ where: { id: opportunity.barbershopId } }),
  ]);
  if (!service) throw new NotFoundError("Serviço não encontrado");
  if (!link || !link.active) throw new PolicyError("Este profissional não realiza esse serviço");

  // O horário de início nunca muda: a vaga é exatamente a que o cancelamento
  // liberou. slotIsFree (dentro de createHold) revalida o espaço de verdade
  // contra o banco — o filtro de compatibilidade da detecção é só uma
  // pré-seleção, quem decide é sempre a constraint de exclusão.
  const startsAt = opportunity.startsAt;
  const duration = link.customDurationMinutes ?? service.durationMinutes;
  const endsAt = addMinutes(startsAt, duration);
  const occupiesFrom = addMinutes(startsAt, -service.bufferBeforeMinutes);
  const occupiesTo = addMinutes(endsAt, service.bufferAfterMinutes);

  const { holdToken } = await createHold({
    barbershopId: opportunity.barbershopId,
    professionalId: opportunity.professionalId,
    serviceId: input.serviceId,
    startsAt,
    endsAt,
    occupiesFrom,
    occupiesTo,
    holdDurationMinutes: shop.holdDurationMinutes,
  });

  const { appointmentId, managementToken } = await confirmAppointment({
    barbershopId: opportunity.barbershopId,
    holdToken,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    acceptedTermsVersion: input.acceptedTermsVersion,
    source: "SMART_OPPORTUNITY",
  });

  // Só marca preenchida DEPOIS da confirmação valer: se o passo acima falhar
  // (horário perdido para outra pessoa), a vaga continua OPEN para a próxima.
  await prisma.smartOpportunity.updateMany({
    where: { id: opportunity.id, status: "OPEN" },
    data: { status: "FILLED", claimedAppointmentId: appointmentId },
  });

  return { appointmentId, managementToken };
}
