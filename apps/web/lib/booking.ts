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
