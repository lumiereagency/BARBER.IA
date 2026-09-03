// Camada transacional do agendamento (Marco 2).
//
// Aqui mora a regra que a Parte 3 §16 proíbe resolver só em memória: a
// concorrência é decidida no banco. Cada operação que ocupa agenda roda dentro
// de uma transação que:
//   1. toma advisory lock por profissional — necessário porque constraint de
//      exclusão não cruza a fronteira entre appointment_holds e appointments;
//   2. revalida a ocupação nas DUAS tabelas;
//   3. escreve, tendo a constraint de exclusão como garantia final.
//
// Se a aplicação errar, o banco recusa. Essa é a ordem de confiança.

import { Prisma, prisma } from "@barber/db";
import {
  addMinutes,
  generateToken,
  hashToken,
  normalizePhoneBR,
} from "@barber/domain";

export class SlotUnavailableError extends Error {
  constructor() {
    super("Horário indisponível");
    this.name = "SlotUnavailableError";
  }
}

export class HoldExpiredError extends Error {
  constructor() {
    super("A reserva temporária expirou");
    this.name = "HoldExpiredError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Não encontrado") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

type Tx = Prisma.TransactionClient;

function tokenSecret(): string {
  const secret = process.env.TOKEN_HMAC_SECRET;
  if (!secret) throw new Error("TOKEN_HMAC_SECRET não configurado");
  return secret;
}

/// Serializa por profissional. Duas confirmações no mesmo barbeiro esperam uma
/// pela outra; barbeiros diferentes seguem em paralelo.
async function lockProfessional(tx: Tx, professionalId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${professionalId}))`;
}

/// O horário está livre considerando agendamentos que ocupam E holds ativos.
/// Precisa das duas tabelas: nenhuma constraint cobre as duas ao mesmo tempo.
async function slotIsFree(
  tx: Tx,
  professionalId: string,
  occupiesFrom: Date,
  occupiesTo: Date,
  options: { ignoreHoldId?: string; ignoreAppointmentId?: string } = {}
): Promise<boolean> {
  const conflictingAppointments = await tx.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM appointments
     WHERE professional_id = ${professionalId}::uuid
       AND status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
       AND id <> COALESCE(${options.ignoreAppointmentId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       AND tstzrange(occupies_from, occupies_to) && tstzrange(${occupiesFrom}, ${occupiesTo})
  `;
  if (Number(conflictingAppointments[0]?.count ?? 0) > 0) return false;

  const conflictingHolds = await tx.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM appointment_holds
     WHERE professional_id = ${professionalId}::uuid
       AND expires_at > now()
       AND id <> COALESCE(${options.ignoreHoldId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       AND tstzrange(occupies_from, occupies_to) && tstzrange(${occupiesFrom}, ${occupiesTo})
  `;
  return Number(conflictingHolds[0]?.count ?? 0) === 0;
}

/// Holds vencidos deixam de valer na consulta, mas continuam ocupando a
/// constraint de exclusão da própria tabela — por isso são removidos antes de
/// tentar criar um novo no mesmo intervalo.
async function purgeExpiredHolds(tx: Tx, professionalId: string): Promise<void> {
  await tx.appointmentHold.deleteMany({
    where: { professionalId, expiresAt: { lte: new Date() } },
  });
}

export interface CreateHoldInput {
  barbershopId: string;
  professionalId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  occupiesFrom: Date;
  occupiesTo: Date;
  holdDurationMinutes: number;
}

export interface CreateHoldResult {
  holdToken: string;
  expiresAt: Date;
}

export async function createHold(input: CreateHoldInput): Promise<CreateHoldResult> {
  const token = generateToken();
  const expiresAt = addMinutes(new Date(), input.holdDurationMinutes);

  await prisma.$transaction(async (tx) => {
    await lockProfessional(tx, input.professionalId);
    await purgeExpiredHolds(tx, input.professionalId);

    const free = await slotIsFree(tx, input.professionalId, input.occupiesFrom, input.occupiesTo);
    if (!free) throw new SlotUnavailableError();

    await tx.appointmentHold.create({
      data: {
        barbershopId: input.barbershopId,
        professionalId: input.professionalId,
        serviceId: input.serviceId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        occupiesFrom: input.occupiesFrom,
        occupiesTo: input.occupiesTo,
        expiresAt,
        sessionTokenHash: hashToken(token, tokenSecret()),
      },
    });
  });

  return { holdToken: token, expiresAt };
}

export interface ConfirmAppointmentInput {
  barbershopId: string;
  holdToken: string;
  customerName: string;
  customerPhone: string;
  acceptedTermsVersion: string;
  marketingConsent?: { channels: Array<"WHATSAPP" | "SMS" | "EMAIL">; textVersion: string };
  source?: "ONLINE" | "MANUAL" | "WAITLIST" | "SMART_OPPORTUNITY";
}

export interface ConfirmAppointmentResult {
  appointmentId: string;
  managementToken: string;
}

/// Confirma a reserva a partir de um hold. Idempotente por natureza: o hold é
/// consumido na transação, então repetir a chamada com o mesmo token encontra
/// o hold já gone e devolve HoldExpiredError em vez de criar uma segunda
/// reserva — a chave de idempotência da rota cobre o retry legítimo.
export async function confirmAppointment(
  input: ConfirmAppointmentInput
): Promise<ConfirmAppointmentResult> {
  const normalizedPhone = normalizePhoneBR(input.customerPhone);
  const holdHash = hashToken(input.holdToken, tokenSecret());
  const managementToken = generateToken();

  return prisma.$transaction(async (tx) => {
    const hold = await tx.appointmentHold.findUnique({
      where: { sessionTokenHash: holdHash },
    });

    if (!hold || hold.barbershopId !== input.barbershopId) throw new NotFoundError("Reserva temporária não encontrada");
    if (hold.expiresAt <= new Date()) throw new HoldExpiredError();

    await lockProfessional(tx, hold.professionalId);

    const free = await slotIsFree(tx, hold.professionalId, hold.occupiesFrom, hold.occupiesTo, {
      ignoreHoldId: hold.id,
    });
    if (!free) throw new SlotUnavailableError();

    const [service, professional, barbershop] = await Promise.all([
      tx.service.findUniqueOrThrow({ where: { id: hold.serviceId } }),
      tx.professional.findUniqueOrThrow({ where: { id: hold.professionalId } }),
      tx.barbershop.findUniqueOrThrow({ where: { id: hold.barbershopId } }),
    ]);

    const override = await tx.professionalService.findUnique({
      where: {
        professionalId_serviceId: {
          professionalId: hold.professionalId,
          serviceId: hold.serviceId,
        },
      },
    });

    // A relação com a barbearia é encontrada ou criada pelo telefone
    // normalizado — é o que impede o cliente duplicar a cada agendamento.
    const relation = await tx.barbershopCustomer.upsert({
      where: {
        barbershopId_normalizedPhone: {
          barbershopId: hold.barbershopId,
          normalizedPhone,
        },
      },
      update: { currentName: input.customerName },
      create: {
        barbershopId: hold.barbershopId,
        normalizedPhone,
        currentName: input.customerName,
      },
    });

    const priceMinor = override?.customPriceMinor ?? service.priceMinor;

    const appointment = await tx.appointment.create({
      data: {
        barbershopId: hold.barbershopId,
        barbershopCustomerId: relation.id,
        professionalId: hold.professionalId,
        serviceId: hold.serviceId,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        occupiesFrom: hold.occupiesFrom,
        occupiesTo: hold.occupiesTo,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        bufferAfterMinutes: service.bufferAfterMinutes,
        status: "CONFIRMED",
        priceSnapshotMinor: priceMinor,
        serviceNameSnapshot: service.name,
        professionalNameSnapshot: professional.displayName,
        customerNameSnapshot: input.customerName,
        customerPhoneSnapshot: normalizedPhone,
        source: input.source ?? "ONLINE",
        managementTokenHash: hashToken(managementToken, tokenSecret()),
        // Decisão #14: leitura expira bem depois do atendimento; escrita só
        // enquanto CONFIRMED.
        managementTokenExpiresAt: addMinutes(hold.endsAt, 90 * 24 * 60),
        createdByType: "CUSTOMER",
      },
    });

    // Consentimento operacional é a base para confirmar e avisar sobre ESTA
    // reserva. Marketing é registro separado e só existe se foi pedido.
    await tx.consent.create({
      data: {
        barbershopId: hold.barbershopId,
        barbershopCustomerId: relation.id,
        channel: "WHATSAPP",
        purpose: "OPERATIONAL",
        status: "GRANTED",
        textVersion: input.acceptedTermsVersion,
        source: "public_booking",
      },
    });

    if (input.marketingConsent) {
      await tx.consent.createMany({
        data: input.marketingConsent.channels.map((channel) => ({
          barbershopId: hold.barbershopId,
          barbershopCustomerId: relation.id,
          channel,
          purpose: "MARKETING" as const,
          status: "GRANTED" as const,
          textVersion: input.marketingConsent!.textVersion,
          source: "public_booking",
        })),
      });
    }

    await tx.appointmentEvent.create({
      data: {
        barbershopId: hold.barbershopId,
        appointmentId: appointment.id,
        type: "CREATED",
        actorType: "CUSTOMER",
        metadata: { source: input.source ?? "ONLINE" },
      },
    });

    // O hold cumpriu o papel e sai junto, na mesma transação
    await tx.appointmentHold.delete({ where: { id: hold.id } });

    // Efeitos externos ficam no outbox: a reserva já está válida sem eles
    await tx.outboxEvent.create({
      data: {
        barbershopId: hold.barbershopId,
        type: "APPOINTMENT_CONFIRMED",
        payload: { appointmentId: appointment.id },
      },
    });

    void barbershop;
    return { appointmentId: appointment.id, managementToken };
  });
}

export interface CancelInput {
  appointmentId: string;
  actorType: "CUSTOMER" | "STAFF" | "SYSTEM";
  actorId?: string;
  reason?: string;
}

export async function cancelAppointment(input: CancelInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { id: input.appointmentId },
      include: { barbershop: true },
    });
    if (!appointment) throw new NotFoundError("Agendamento não encontrado");

    if (appointment.status !== "CONFIRMED") {
      throw new PolicyError("Este agendamento não está mais ativo");
    }

    if (input.actorType === "CUSTOMER") {
      const limit = addMinutes(new Date(), appointment.barbershop.cancellationNoticeMinutes);
      if (appointment.startsAt <= limit) {
        throw new PolicyError("Fora do prazo para cancelar pelo link");
      }
    }

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: input.actorType === "CUSTOMER" ? "CANCELLED_BY_CUSTOMER" : "CANCELLED_BY_SHOP",
        cancelledAt: new Date(),
        cancellationReason: input.reason ?? null,
        version: { increment: 1 },
      },
    });

    await tx.appointmentEvent.create({
      data: {
        barbershopId: appointment.barbershopId,
        appointmentId: appointment.id,
        type: "CANCELLED",
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        metadata: input.reason ? { reason: input.reason } : undefined,
      },
    });

    await tx.outboxEvent.create({
      data: {
        barbershopId: appointment.barbershopId,
        type: "APPOINTMENT_CANCELLED",
        payload: { appointmentId: appointment.id },
      },
    });
  });
}

export interface RescheduleInput {
  appointmentId: string;
  holdToken: string;
  actorType: "CUSTOMER" | "STAFF";
  actorId?: string;
}

export interface RescheduleResult {
  appointmentId: string;
  managementToken: string;
}

/// Reservar o novo horário e liberar o anterior é uma operação só (Parte 1 §9).
/// O agendamento antigo vira RESCHEDULED — não CANCELLED — para que remarcação
/// não apareça como cancelamento nos relatórios do dono.
export async function rescheduleAppointment(
  input: RescheduleInput
): Promise<RescheduleResult> {
  const holdHash = hashToken(input.holdToken, tokenSecret());
  const managementToken = generateToken();

  return prisma.$transaction(async (tx) => {
    const previous = await tx.appointment.findUnique({
      where: { id: input.appointmentId },
      include: { barbershop: true },
    });
    if (!previous) throw new NotFoundError("Agendamento não encontrado");
    if (previous.status !== "CONFIRMED") {
      throw new PolicyError("Este agendamento não está mais ativo");
    }

    if (input.actorType === "CUSTOMER") {
      const limit = addMinutes(new Date(), previous.barbershop.cancellationNoticeMinutes);
      if (previous.startsAt <= limit) {
        throw new PolicyError("Fora do prazo para remarcar pelo link");
      }
    }

    const hold = await tx.appointmentHold.findUnique({ where: { sessionTokenHash: holdHash } });
    if (!hold || hold.barbershopId !== previous.barbershopId) {
      throw new NotFoundError("Reserva temporária não encontrada");
    }
    if (hold.expiresAt <= new Date()) throw new HoldExpiredError();

    await lockProfessional(tx, hold.professionalId);
    if (hold.professionalId !== previous.professionalId) {
      await lockProfessional(tx, previous.professionalId);
    }

    // O horário antigo é liberado antes da revalidação: remarcar para um
    // encaixe que encosta no próprio horário atual precisa funcionar.
    await tx.appointment.update({
      where: { id: previous.id },
      data: { status: "RESCHEDULED", version: { increment: 1 } },
    });

    const free = await slotIsFree(tx, hold.professionalId, hold.occupiesFrom, hold.occupiesTo, {
      ignoreHoldId: hold.id,
    });
    if (!free) throw new SlotUnavailableError();

    const [service, professional] = await Promise.all([
      tx.service.findUniqueOrThrow({ where: { id: hold.serviceId } }),
      tx.professional.findUniqueOrThrow({ where: { id: hold.professionalId } }),
    ]);

    const override = await tx.professionalService.findUnique({
      where: {
        professionalId_serviceId: {
          professionalId: hold.professionalId,
          serviceId: hold.serviceId,
        },
      },
    });

    const created = await tx.appointment.create({
      data: {
        barbershopId: previous.barbershopId,
        barbershopCustomerId: previous.barbershopCustomerId,
        professionalId: hold.professionalId,
        serviceId: hold.serviceId,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        occupiesFrom: hold.occupiesFrom,
        occupiesTo: hold.occupiesTo,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        bufferAfterMinutes: service.bufferAfterMinutes,
        status: "CONFIRMED",
        priceSnapshotMinor: override?.customPriceMinor ?? service.priceMinor,
        serviceNameSnapshot: service.name,
        professionalNameSnapshot: professional.displayName,
        customerNameSnapshot: previous.customerNameSnapshot,
        customerPhoneSnapshot: previous.customerPhoneSnapshot,
        source: previous.source,
        managementTokenHash: hashToken(managementToken, tokenSecret()),
        managementTokenExpiresAt: addMinutes(hold.endsAt, 90 * 24 * 60),
        previousAppointmentId: previous.id,
        createdByType: input.actorType,
        createdById: input.actorId ?? null,
      },
    });

    await tx.appointmentHold.delete({ where: { id: hold.id } });

    await tx.appointmentEvent.createMany({
      data: [
        {
          barbershopId: previous.barbershopId,
          appointmentId: previous.id,
          type: "RESCHEDULED_AWAY",
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          metadata: { toAppointmentId: created.id },
        },
        {
          barbershopId: previous.barbershopId,
          appointmentId: created.id,
          type: "RESCHEDULED_INTO",
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          metadata: { fromAppointmentId: previous.id },
        },
      ],
    });

    await tx.outboxEvent.create({
      data: {
        barbershopId: previous.barbershopId,
        type: "APPOINTMENT_RESCHEDULED",
        payload: { appointmentId: created.id, previousAppointmentId: previous.id },
      },
    });

    return { appointmentId: created.id, managementToken };
  });
}

/// Resolve o agendamento a partir do token cru do link, sem nunca comparar
/// token em claro contra o banco.
export async function findByManagementToken(token: string) {
  const hash = hashToken(token, tokenSecret());
  return prisma.appointment.findUnique({
    where: { managementTokenHash: hash },
    include: { barbershop: true },
  });
}

// ---------------------------------------------------------------------------
// Operação do dia (Marco 3)
// ---------------------------------------------------------------------------

export interface StatusChangeInput {
  barbershopId: string;
  appointmentId: string;
  actorId: string;
  /// Nulo quando quem age tem escopo amplo; preenchido quando é o barbeiro
  /// agindo, e aí só a própria agenda é permitida.
  restrictToProfessionalId?: string | null;
}

/// Transições permitidas na operação do balcão.
///
/// CONFIRMED é o único ponto de partida para concluir ou marcar falta; sair de
/// COMPLETED/NO_SHOW só é possível voltando para CONFIRMED (correção de erro de
/// clique), nunca pulando direto de um terminal para o outro.
const TRANSICOES: Record<string, readonly string[]> = {
  COMPLETED: ["CONFIRMED"],
  NO_SHOW: ["CONFIRMED"],
  CANCELLED_BY_SHOP: ["CONFIRMED"],
  CONFIRMED: ["COMPLETED", "NO_SHOW"],
};

async function changeStatus(
  input: StatusChangeInput,
  target: "COMPLETED" | "NO_SHOW" | "CANCELLED_BY_SHOP" | "CONFIRMED",
  eventType: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      // O tenant entra na busca, não numa checagem posterior: id de outra
      // barbearia simplesmente não é encontrado.
      where: { id: input.appointmentId, barbershopId: input.barbershopId },
    });
    if (!appointment) throw new NotFoundError("Agendamento não encontrado");

    if (
      input.restrictToProfessionalId &&
      appointment.professionalId !== input.restrictToProfessionalId
    ) {
      throw new PolicyError("Este agendamento é de outro profissional");
    }

    const permitidas = TRANSICOES[target] ?? [];
    if (!permitidas.includes(appointment.status)) {
      throw new PolicyError(
        `Não é possível mudar de ${appointment.status} para ${target}`
      );
    }

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: target,
        completedAt: target === "COMPLETED" ? new Date() : null,
        cancelledAt: target === "CANCELLED_BY_SHOP" ? new Date() : null,
        version: { increment: 1 },
      },
    });

    await tx.appointmentEvent.create({
      data: {
        barbershopId: appointment.barbershopId,
        appointmentId: appointment.id,
        type: eventType,
        actorType: "STAFF",
        actorId: input.actorId,
        metadata: { from: appointment.status, to: target },
      },
    });

    // O CRM é recalculado por job: concluir atendimento muda frequência,
    // ticket médio e próximo retorno estimado do cliente.
    await tx.outboxEvent.create({
      data: {
        barbershopId: appointment.barbershopId,
        type: "RECOMPUTE_CUSTOMER_CRM",
        payload: { barbershopCustomerId: appointment.barbershopCustomerId },
      },
    });

    // Cancelar pela barbearia precisa tirar o evento do calendário externo;
    // desfazer um "concluído" por engano precisa colocá-lo de volta.
    if (target === "CANCELLED_BY_SHOP" || target === "CONFIRMED") {
      await tx.outboxEvent.create({
        data: {
          barbershopId: appointment.barbershopId,
          type: target === "CANCELLED_BY_SHOP" ? "APPOINTMENT_CANCELLED" : "APPOINTMENT_CONFIRMED",
          payload: { appointmentId: appointment.id },
        },
      });
    }
  });
}

export const completeAppointment = (input: StatusChangeInput) =>
  changeStatus(input, "COMPLETED", "COMPLETED");

export const markNoShow = (input: StatusChangeInput) =>
  changeStatus(input, "NO_SHOW", "NO_SHOW");

export const cancelByShop = (input: StatusChangeInput) =>
  changeStatus(input, "CANCELLED_BY_SHOP", "CANCELLED_BY_SHOP");

/// Desfaz um "concluído" ou "não compareceu" marcado por engano.
export const revertToConfirmed = (input: StatusChangeInput) =>
  changeStatus(input, "CONFIRMED", "STATUS_REVERTED");

export interface ManualAppointmentInput {
  barbershopId: string;
  professionalId: string;
  serviceId: string;
  startsAt: Date;
  customerName: string;
  customerPhone: string;
  actorId: string;
  /// Nulo para quem tem escopo amplo; o barbeiro só cria na própria agenda.
  restrictToProfessionalId?: string | null;
}

export interface ManualAppointmentResult {
  appointmentId: string;
  managementToken: string;
}

/// Reserva criada pela equipe no balcão.
///
/// Diferente do fluxo público em dois pontos deliberados: não exige hold (quem
/// está no balcão já tem o cliente na frente) e não exige que o horário esteja
/// na grade nem dentro da jornada — atendimento encaixado às 10h07 é rotina de
/// barbearia. O que continua valendo é o conflito real: o advisory lock e a
/// constraint de exclusão recusam sobreposição do mesmo profissional.
export async function createManualAppointment(
  input: ManualAppointmentInput
): Promise<ManualAppointmentResult> {
  if (input.restrictToProfessionalId && input.professionalId !== input.restrictToProfessionalId) {
    throw new PolicyError("Você só pode criar reserva na sua própria agenda");
  }

  const normalizedPhone = normalizePhoneBR(input.customerPhone);
  const managementToken = generateToken();

  return prisma.$transaction(async (tx) => {
    const service = await tx.service.findFirst({
      where: { id: input.serviceId, barbershopId: input.barbershopId },
    });
    if (!service) throw new NotFoundError("Serviço não encontrado");

    const professional = await tx.professional.findFirst({
      where: { id: input.professionalId, barbershopId: input.barbershopId },
    });
    if (!professional) throw new NotFoundError("Profissional não encontrado");

    const link = await tx.professionalService.findUnique({
      where: {
        professionalId_serviceId: {
          professionalId: input.professionalId,
          serviceId: input.serviceId,
        },
      },
    });

    const duration = link?.customDurationMinutes ?? service.durationMinutes;
    const endsAt = addMinutes(input.startsAt, duration);
    const occupiesFrom = addMinutes(input.startsAt, -service.bufferBeforeMinutes);
    const occupiesTo = addMinutes(endsAt, service.bufferAfterMinutes);

    await lockProfessional(tx, input.professionalId);
    await purgeExpiredHolds(tx, input.professionalId);

    const free = await slotIsFree(tx, input.professionalId, occupiesFrom, occupiesTo);
    if (!free) throw new SlotUnavailableError();

    const relation = await tx.barbershopCustomer.upsert({
      where: {
        barbershopId_normalizedPhone: {
          barbershopId: input.barbershopId,
          normalizedPhone,
        },
      },
      update: { currentName: input.customerName },
      create: {
        barbershopId: input.barbershopId,
        normalizedPhone,
        currentName: input.customerName,
      },
    });

    const appointment = await tx.appointment.create({
      data: {
        barbershopId: input.barbershopId,
        barbershopCustomerId: relation.id,
        professionalId: input.professionalId,
        serviceId: input.serviceId,
        startsAt: input.startsAt,
        endsAt,
        occupiesFrom,
        occupiesTo,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        bufferAfterMinutes: service.bufferAfterMinutes,
        status: "CONFIRMED",
        priceSnapshotMinor: link?.customPriceMinor ?? service.priceMinor,
        serviceNameSnapshot: service.name,
        professionalNameSnapshot: professional.displayName,
        customerNameSnapshot: input.customerName,
        customerPhoneSnapshot: normalizedPhone,
        source: "MANUAL",
        managementTokenHash: hashToken(managementToken, tokenSecret()),
        managementTokenExpiresAt: addMinutes(endsAt, 90 * 24 * 60),
        createdByType: "STAFF",
        createdById: input.actorId,
      },
    });

    await tx.appointmentEvent.create({
      data: {
        barbershopId: input.barbershopId,
        appointmentId: appointment.id,
        type: "CREATED",
        actorType: "STAFF",
        actorId: input.actorId,
        metadata: { source: "MANUAL" },
      },
    });

    // Consentimento operacional: a equipe registrou o contato para tratar
    // desta reserva. Marketing continua exigindo aceite próprio do cliente.
    await tx.consent.create({
      data: {
        barbershopId: input.barbershopId,
        barbershopCustomerId: relation.id,
        channel: "WHATSAPP",
        purpose: "OPERATIONAL",
        status: "GRANTED",
        textVersion: process.env.TERMS_VERSION ?? "dev-0",
        source: "staff_manual",
      },
    });

    // O encaixe no balcão ocupa a agenda como qualquer outro: sem isto, o
    // calendário do profissional mostraria o horário livre.
    await tx.outboxEvent.create({
      data: {
        barbershopId: input.barbershopId,
        type: "APPOINTMENT_CONFIRMED",
        payload: { appointmentId: appointment.id },
      },
    });

    return { appointmentId: appointment.id, managementToken };
  });
}

export interface BlockTimeInput {
  barbershopId: string;
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string;
  actorId: string;
  restrictToProfessionalId?: string | null;
}

/// Bloqueio de período na agenda (almoço, dentista, imprevisto).
///
/// Não usa a constraint de exclusão — bloqueio é do profissional, e recusar por
/// causa de reserva já confirmada seria pior: o dono precisa poder marcar que
/// vai sair e resolver as reservas afetadas depois. Mas ele é avisado.
export async function blockTime(input: BlockTimeInput): Promise<{ conflitos: number }> {
  if (input.restrictToProfessionalId && input.professionalId !== input.restrictToProfessionalId) {
    throw new PolicyError("Você só pode bloquear a sua própria agenda");
  }
  if (input.endsAt <= input.startsAt) {
    throw new PolicyError("O fim do bloqueio precisa ser depois do início");
  }

  return prisma.$transaction(async (tx) => {
    const professional = await tx.professional.findFirst({
      where: { id: input.professionalId, barbershopId: input.barbershopId },
    });
    if (!professional) throw new NotFoundError("Profissional não encontrado");

    await tx.scheduleBlock.create({
      data: {
        barbershopId: input.barbershopId,
        professionalId: input.professionalId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason ?? null,
        createdByUserId: input.actorId,
      },
    });

    const conflitos = await tx.appointment.count({
      where: {
        professionalId: input.professionalId,
        status: "CONFIRMED",
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
      },
    });

    return { conflitos };
  });
}
