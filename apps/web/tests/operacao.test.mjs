// Operação do dia (Marco 3), contra Postgres real.
//
// O que estes testes existem para provar:
//  - concluir e marcar falta só saem de CONFIRMED, e dá para desfazer engano;
//  - encaixe no balcão passa pelas mesmas garantias de conflito do fluxo público;
//  - o barbeiro não age na agenda de outro, nem por id trocado no formulário;
//  - agendamento de outra barbearia não é alcançável;
//  - bloqueio avisa quando há reserva confirmada no período, sem apagá-la.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.TOKEN_HMAC_SECRET ??= "test-only-secret";

const { prisma } = await import("@barber/db");
const booking = await import("../lib/booking.ts");

const SHOP = randomUUID();
const OUTRA_SHOP = randomUUID();
const PRO_A = randomUUID();
const PRO_B = randomUUID();
const SERVICE = randomUUID();
const ATOR = randomUUID();

const base = new Date("2027-05-12T13:00:00Z");
const minutos = (n) => new Date(base.getTime() + n * 60000);

before(async () => {
  for (const [id, nome] of [
    [SHOP, "Barbearia Operação"],
    [OUTRA_SHOP, "Outra Barbearia"],
  ]) {
    await prisma.barbershop.create({
      data: { id, name: nome, slug: `op-${id.slice(0, 8)}`, timezone: "America/Sao_Paulo" },
    });
  }

  await prisma.professional.createMany({
    data: [
      { id: PRO_A, barbershopId: SHOP, displayName: "Matheus" },
      { id: PRO_B, barbershopId: SHOP, displayName: "Rafael" },
    ],
  });

  await prisma.service.create({
    data: {
      id: SERVICE,
      barbershopId: SHOP,
      name: "Corte",
      priceMinor: 5000,
      durationMinutes: 30,
      bufferAfterMinutes: 10,
    },
  });

  await prisma.professionalService.createMany({
    data: [
      { barbershopId: SHOP, professionalId: PRO_A, serviceId: SERVICE },
      { barbershopId: SHOP, professionalId: PRO_B, serviceId: SERVICE },
    ],
  });
});

after(async () => {
  await prisma.barbershop.deleteMany({ where: { id: { in: [SHOP, OUTRA_SHOP] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.appointmentEvent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointment.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.scheduleBlock.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.outboxEvent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.consent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.barbershopCustomer.deleteMany({ where: { barbershopId: SHOP } });
});

async function encaixar(overrides = {}) {
  return booking.createManualAppointment({
    barbershopId: SHOP,
    professionalId: PRO_A,
    serviceId: SERVICE,
    startsAt: minutos(0),
    customerName: "Cliente Balcão",
    customerPhone: "11999990000",
    actorId: ATOR,
    ...overrides,
  });
}

describe("encaixe no balcão", () => {
  test("cria a reserva com snapshots e origem MANUAL", async () => {
    const { appointmentId, managementToken } = await encaixar();
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });

    assert.equal(appointment.status, "CONFIRMED");
    assert.equal(appointment.source, "MANUAL");
    assert.equal(appointment.createdByType, "STAFF");
    assert.equal(appointment.createdById, ATOR);
    assert.equal(appointment.priceSnapshotMinor, 5000);
    assert.equal(appointment.customerPhoneSnapshot, "+5511999990000");
    // O cliente do balcão também recebe link de gestão
    assert.ok(managementToken.length >= 40);
  });

  test("aceita horário fora da grade: encaixe às 10h07 é rotina", async () => {
    const foraDaGrade = new Date("2027-05-12T13:07:00Z");
    const { appointmentId } = await encaixar({ startsAt: foraDaGrade });
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    assert.equal(appointment.startsAt.toISOString(), foraDaGrade.toISOString());
  });

  test("mas recusa conflito real com outro atendimento", async () => {
    await encaixar();
    await assert.rejects(() => encaixar({ startsAt: minutos(15) }), booking.SlotUnavailableError);
  });

  test("respeita o buffer do atendimento anterior", async () => {
    await encaixar(); // 13:00–13:30 + 10min de buffer = ocupa até 13:40
    await assert.rejects(() => encaixar({ startsAt: minutos(35) }), booking.SlotUnavailableError);
    const depois = await encaixar({ startsAt: minutos(40) });
    assert.ok(depois.appointmentId);
  });

  test("outro profissional no mesmo horário é permitido", async () => {
    await encaixar();
    const outro = await encaixar({ professionalId: PRO_B });
    assert.ok(outro.appointmentId);
  });

  test("não duplica o cliente que já existe pelo telefone", async () => {
    await encaixar();
    await encaixar({ startsAt: minutos(60), customerPhone: "(11) 99999-0000" });

    const relacoes = await prisma.barbershopCustomer.findMany({ where: { barbershopId: SHOP } });
    assert.equal(relacoes.length, 1);
  });

  test("barbeiro não encaixa na agenda de outro", async () => {
    await assert.rejects(
      () => encaixar({ professionalId: PRO_B, restrictToProfessionalId: PRO_A }),
      booking.PolicyError
    );
  });

  test("barbeiro encaixa na própria agenda", async () => {
    const resultado = await encaixar({ restrictToProfessionalId: PRO_A });
    assert.ok(resultado.appointmentId);
  });

  test("serviço de outra barbearia não é alcançável", async () => {
    const servicoDaOutra = await prisma.service.create({
      data: {
        barbershopId: OUTRA_SHOP,
        name: "Corte da outra",
        priceMinor: 9999,
        durationMinutes: 30,
      },
    });

    await assert.rejects(
      () => encaixar({ serviceId: servicoDaOutra.id }),
      booking.NotFoundError
    );

    await prisma.service.delete({ where: { id: servicoDaOutra.id } });
  });
});

describe("status do atendimento", () => {
  let appointmentId;

  beforeEach(async () => {
    ({ appointmentId } = await encaixar());
  });

  const acao = (extra = {}) => ({
    barbershopId: SHOP,
    appointmentId,
    actorId: ATOR,
    ...extra,
  });

  test("concluir registra data e evento", async () => {
    await booking.completeAppointment(acao());
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });

    assert.equal(appointment.status, "COMPLETED");
    assert.ok(appointment.completedAt);

    const eventos = await prisma.appointmentEvent.findMany({ where: { appointmentId } });
    assert.ok(eventos.some((e) => e.type === "COMPLETED"));
  });

  test("concluir enfileira o recálculo do CRM", async () => {
    await booking.completeAppointment(acao());
    const eventos = await prisma.outboxEvent.findMany({
      where: { barbershopId: SHOP, type: "RECOMPUTE_CUSTOMER_CRM" },
    });
    assert.equal(eventos.length, 1);
  });

  test("marcar falta muda para NO_SHOW", async () => {
    await booking.markNoShow(acao());
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    assert.equal(appointment.status, "NO_SHOW");
    // Falta não é receita: completedAt continua vazio
    assert.equal(appointment.completedAt, null);
  });

  test("dá para desfazer um clique errado", async () => {
    await booking.completeAppointment(acao());
    await booking.revertToConfirmed(acao());

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    assert.equal(appointment.status, "CONFIRMED");
    assert.equal(appointment.completedAt, null);
  });

  test("não pula de concluído direto para falta", async () => {
    await booking.completeAppointment(acao());
    await assert.rejects(() => booking.markNoShow(acao()), booking.PolicyError);
  });

  test("concluir duas vezes não passa", async () => {
    await booking.completeAppointment(acao());
    await assert.rejects(() => booking.completeAppointment(acao()), booking.PolicyError);
  });

  test("cancelar pela barbearia libera o horário", async () => {
    await booking.cancelByShop(acao());
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    assert.equal(appointment.status, "CANCELLED_BY_SHOP");
    assert.ok(appointment.cancelledAt);

    // O horário volta a ser encaixável
    const novo = await encaixar();
    assert.ok(novo.appointmentId);
  });

  test("barbeiro não muda status de atendimento alheio", async () => {
    await assert.rejects(
      () => booking.completeAppointment(acao({ restrictToProfessionalId: PRO_B })),
      booking.PolicyError
    );
  });

  test("agendamento de outra barbearia não é encontrado", async () => {
    await assert.rejects(
      () => booking.completeAppointment(acao({ barbershopId: OUTRA_SHOP })),
      booking.NotFoundError
    );
  });
});

describe("bloqueio de período", () => {
  test("cria o bloqueio sem conflito", async () => {
    const { conflitos } = await booking.blockTime({
      barbershopId: SHOP,
      professionalId: PRO_A,
      startsAt: minutos(180),
      endsAt: minutos(240),
      reason: "Almoço",
      actorId: ATOR,
    });

    assert.equal(conflitos, 0);
    const bloqueios = await prisma.scheduleBlock.findMany({ where: { barbershopId: SHOP } });
    assert.equal(bloqueios.length, 1);
    assert.equal(bloqueios[0].reason, "Almoço");
  });

  test("avisa quando há atendimento confirmado no período, mas não o apaga", async () => {
    const { appointmentId } = await encaixar();

    const { conflitos } = await booking.blockTime({
      barbershopId: SHOP,
      professionalId: PRO_A,
      startsAt: minutos(-30),
      endsAt: minutos(60),
      actorId: ATOR,
    });

    assert.equal(conflitos, 1, "o dono precisa ser avisado do atendimento afetado");

    // A reserva do cliente continua de pé: quem decide cancelar é a barbearia
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    assert.equal(appointment.status, "CONFIRMED");
  });

  test("intervalo invertido é recusado", async () => {
    await assert.rejects(
      () =>
        booking.blockTime({
          barbershopId: SHOP,
          professionalId: PRO_A,
          startsAt: minutos(60),
          endsAt: minutos(30),
          actorId: ATOR,
        }),
      booking.PolicyError
    );
  });

  test("barbeiro não bloqueia agenda de outro", async () => {
    await assert.rejects(
      () =>
        booking.blockTime({
          barbershopId: SHOP,
          professionalId: PRO_B,
          startsAt: minutos(180),
          endsAt: minutos(240),
          actorId: ATOR,
          restrictToProfessionalId: PRO_A,
        }),
      booking.PolicyError
    );
  });
});

describe("bloqueio some da agenda pública", () => {
  test("o horário bloqueado deixa de ser oferecido", async () => {
    const { loadAvailability } = await import("../lib/availability-service.ts");

    await prisma.workingHours.deleteMany({ where: { professionalId: PRO_A } });
    await prisma.workingHours.create({
      data: {
        barbershopId: SHOP,
        professionalId: PRO_A,
        weekday: 3, // 2027-05-12 é uma quarta-feira
        startLocalTime: "09:00",
        endLocalTime: "12:00",
      },
    });

    const antes = await loadAvailability({
      barbershopId: SHOP,
      serviceId: SERVICE,
      professionalId: PRO_A,
      from: "2027-05-12",
      to: "2027-05-12",
      now: new Date("2027-05-01T12:00:00Z"),
    });
    const totalAntes = antes.days[0].slots.length;
    assert.ok(totalAntes > 0);

    await booking.blockTime({
      barbershopId: SHOP,
      professionalId: PRO_A,
      startsAt: new Date("2027-05-12T13:00:00Z"), // 10:00 local
      endsAt: new Date("2027-05-12T14:00:00Z"), // 11:00 local
      actorId: ATOR,
    });

    const depois = await loadAvailability({
      barbershopId: SHOP,
      serviceId: SERVICE,
      professionalId: PRO_A,
      from: "2027-05-12",
      to: "2027-05-12",
      now: new Date("2027-05-01T12:00:00Z"),
    });

    assert.ok(
      depois.days[0].slots.length < totalAntes,
      "o período bloqueado deveria sumir da agenda pública"
    );
  });
});
