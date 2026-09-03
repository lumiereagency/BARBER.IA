// Testes de integração do motor de agendamento, contra Postgres real.
//
// O que estes testes existem para provar (Parte 3 §10 e §11):
//  - dois clientes disputando o mesmo horário: só um vence;
//  - hold bloqueia confirmação alheia e expira sozinho;
//  - cancelar devolve o horário;
//  - remarcar é atômico, preserva histórico e não vira cancelamento;
//  - o cliente não duplica ao agendar de novo;
//  - buffers são respeitados mesmo sob corrida.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.TOKEN_HMAC_SECRET ??= "test-only-secret";

const { prisma } = await import("@barber/db");
const { generateToken, hashToken, normalizePhoneBR } = await import("@barber/domain");
const booking = await import("../lib/booking.ts");

const SHOP = randomUUID();
const PRO_A = randomUUID();
const PRO_B = randomUUID();
const SERVICE = randomUUID();
const OTHER_SHOP = randomUUID();

const base = new Date("2026-10-15T13:00:00Z");
const minutes = (n) => new Date(base.getTime() + n * 60000);

before(async () => {
  await prisma.barbershop.create({
    data: {
      id: SHOP,
      name: "Barbearia Teste",
      slug: `teste-${SHOP.slice(0, 8)}`,
      timezone: "America/Sao_Paulo",
      cancellationNoticeMinutes: 0,
    },
  });
  await prisma.barbershop.create({
    data: {
      id: OTHER_SHOP,
      name: "Outra Barbearia",
      slug: `outra-${OTHER_SHOP.slice(0, 8)}`,
    },
  });
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
      name: "Corte + Barba",
      priceMinor: 8000,
      durationMinutes: 45,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 10,
    },
  });
});

after(async () => {
  await prisma.barbershop.deleteMany({ where: { id: { in: [SHOP, OTHER_SHOP] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.appointmentHold.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointmentEvent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointment.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.consent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.outboxEvent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.barbershopCustomer.deleteMany({ where: { barbershopId: SHOP } });
});

function holdInput(overrides = {}) {
  return {
    barbershopId: SHOP,
    professionalId: PRO_A,
    serviceId: SERVICE,
    startsAt: minutes(0),
    endsAt: minutes(45),
    occupiesFrom: minutes(-10),
    occupiesTo: minutes(55),
    holdDurationMinutes: 5,
    ...overrides,
  };
}

async function confirm(holdToken, overrides = {}) {
  return booking.confirmAppointment({
    barbershopId: SHOP,
    holdToken,
    customerName: "João",
    customerPhone: "11999990000",
    acceptedTermsVersion: "dev-0",
    ...overrides,
  });
}

describe("hold", () => {
  test("cria e reserva o horário", async () => {
    const { holdToken, expiresAt } = await booking.createHold(holdInput());
    assert.ok(holdToken.length >= 40);
    assert.ok(expiresAt > new Date());
  });

  test("segundo hold no mesmo horário é recusado", async () => {
    await booking.createHold(holdInput());
    await assert.rejects(() => booking.createHold(holdInput()), booking.SlotUnavailableError);
  });

  test("hold em profissional diferente no mesmo horário é permitido", async () => {
    await booking.createHold(holdInput());
    const outro = await booking.createHold(holdInput({ professionalId: PRO_B }));
    assert.ok(outro.holdToken);
  });

  test("hold expirado libera o horário", async () => {
    await booking.createHold(holdInput({ holdDurationMinutes: -1 }));
    const novo = await booking.createHold(holdInput());
    assert.ok(novo.holdToken);
  });

  test("hold respeita o buffer do compromisso vizinho", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    await confirm(holdToken);

    // Começaria às :55, exatamente quando o buffer do anterior termina — ok
    const colado = await booking.createHold(
      holdInput({
        startsAt: minutes(65),
        endsAt: minutes(110),
        occupiesFrom: minutes(55),
        occupiesTo: minutes(120),
      })
    );
    assert.ok(colado.holdToken);

    // Já este invade o buffer de 10 minutos do primeiro
    await assert.rejects(
      () =>
        booking.createHold(
          holdInput({
            professionalId: PRO_B,
            startsAt: minutes(50),
            endsAt: minutes(95),
            occupiesFrom: minutes(40),
            occupiesTo: minutes(105),
          })
        ).then(() =>
          booking.createHold(
            holdInput({
              startsAt: minutes(50),
              endsAt: minutes(95),
              occupiesFrom: minutes(40),
              occupiesTo: minutes(105),
            })
          )
        ),
      booking.SlotUnavailableError
    );
  });
});

describe("confirmação", () => {
  test("confirma, grava snapshots e emite token de gestão", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    const { appointmentId, managementToken } = await confirm(holdToken);

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });

    assert.equal(appointment.status, "CONFIRMED");
    assert.equal(appointment.priceSnapshotMinor, 8000);
    assert.equal(appointment.serviceNameSnapshot, "Corte + Barba");
    assert.equal(appointment.professionalNameSnapshot, "Matheus");
    assert.equal(appointment.customerPhoneSnapshot, "+5511999990000");
    assert.equal(appointment.bufferBeforeMinutes, 10);

    // O token cru nunca é persistido
    assert.notEqual(appointment.managementTokenHash, managementToken);
    assert.equal(
      appointment.managementTokenHash,
      hashToken(managementToken, process.env.TOKEN_HMAC_SECRET)
    );

    // O hold foi consumido
    assert.equal(await prisma.appointmentHold.count({ where: { barbershopId: SHOP } }), 0);
  });

  test("snapshot congela o preço: reajuste não reescreve o histórico", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    const { appointmentId } = await confirm(holdToken);

    await prisma.service.update({ where: { id: SERVICE }, data: { priceMinor: 12000 } });
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    assert.equal(appointment.priceSnapshotMinor, 8000);

    await prisma.service.update({ where: { id: SERVICE }, data: { priceMinor: 8000 } });
  });

  test("registra consentimento operacional, e marketing só se pedido", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    await confirm(holdToken);

    const consents = await prisma.consent.findMany({ where: { barbershopId: SHOP } });
    assert.equal(consents.length, 1);
    assert.equal(consents[0].purpose, "OPERATIONAL");

    const segundo = await booking.createHold(
      holdInput({ startsAt: minutes(120), endsAt: minutes(165), occupiesFrom: minutes(110), occupiesTo: minutes(175) })
    );
    await confirm(segundo.holdToken, {
      customerPhone: "11988887777",
      marketingConsent: { channels: ["WHATSAPP", "EMAIL"], textVersion: "promo-1" },
    });

    const marketing = await prisma.consent.findMany({
      where: { barbershopId: SHOP, purpose: "MARKETING" },
    });
    assert.equal(marketing.length, 2);
  });

  test("agendar de novo com o mesmo telefone não duplica o cliente", async () => {
    const primeiro = await booking.createHold(holdInput());
    await confirm(primeiro.holdToken);

    const segundo = await booking.createHold(
      holdInput({ startsAt: minutes(120), endsAt: minutes(165), occupiesFrom: minutes(110), occupiesTo: minutes(175) })
    );
    await confirm(segundo.holdToken, { customerPhone: "(11) 99999-0000" });

    const relations = await prisma.barbershopCustomer.findMany({ where: { barbershopId: SHOP } });
    assert.equal(relations.length, 1, "telefone formatado diferente deveria ser o mesmo cliente");
    assert.equal(relations[0].normalizedPhone, "+5511999990000");
  });

  test("hold expirado não confirma", async () => {
    const { holdToken } = await booking.createHold(holdInput({ holdDurationMinutes: -1 }));
    await assert.rejects(() => confirm(holdToken), booking.HoldExpiredError);
  });

  test("token de hold de outra barbearia não confirma", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    await assert.rejects(
      () => booking.confirmAppointment({
        barbershopId: OTHER_SHOP,
        holdToken,
        customerName: "Invasor",
        customerPhone: "11900000000",
        acceptedTermsVersion: "dev-0",
      }),
      booking.NotFoundError
    );
  });

  test("token inventado não confirma", async () => {
    await assert.rejects(() => confirm(generateToken()), booking.NotFoundError);
  });
});

describe("disputa pelo mesmo horário", () => {
  test("duplo envio do mesmo hold gera uma reserva só", async () => {
    // Cliente que clica duas vezes em "confirmar", ou cuja requisição é
    // repetida pela rede. Não é a disputa entre dois clientes (essa é impedida
    // antes, na criação do hold) — é o retry, que não pode duplicar reserva.
    const primeiro = await booking.createHold(holdInput());
    const resultados = await Promise.allSettled([
      confirm(primeiro.holdToken, { customerPhone: "11911111111" }),
      confirm(primeiro.holdToken, { customerPhone: "11922222222" }),
    ]);

    const vencedores = resultados.filter((r) => r.status === "fulfilled");
    assert.equal(vencedores.length, 1, "o mesmo hold não pode virar duas reservas");

    const total = await prisma.appointment.count({
      where: { barbershopId: SHOP, status: "CONFIRMED" },
    });
    assert.equal(total, 1);
  });

  test("holds concorrentes no mesmo horário: só um é criado", async () => {
    const resultados = await Promise.allSettled([
      booking.createHold(holdInput()),
      booking.createHold(holdInput()),
      booking.createHold(holdInput()),
    ]);

    const criados = resultados.filter((r) => r.status === "fulfilled");
    assert.equal(criados.length, 1, `criados ${criados.length} holds para o mesmo slot`);
  });
});

describe("cancelamento", () => {
  test("cancelar devolve o horário", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    const { appointmentId } = await confirm(holdToken);

    await booking.cancelAppointment({ appointmentId, actorType: "CUSTOMER" });

    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    assert.equal(appointment.status, "CANCELLED_BY_CUSTOMER");
    assert.ok(appointment.cancelledAt);

    // O horário volta a ser reservável
    const novo = await booking.createHold(holdInput());
    assert.ok(novo.holdToken);
  });

  test("cancelar duas vezes não passa", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    const { appointmentId } = await confirm(holdToken);
    await booking.cancelAppointment({ appointmentId, actorType: "CUSTOMER" });
    await assert.rejects(
      () => booking.cancelAppointment({ appointmentId, actorType: "CUSTOMER" }),
      booking.PolicyError
    );
  });

  test("antecedência mínima bloqueia o cancelamento pelo cliente", async () => {
    await prisma.barbershop.update({
      where: { id: SHOP },
      data: { cancellationNoticeMinutes: 120 },
    });

    const daquiAPouco = new Date(Date.now() + 30 * 60000);
    const { holdToken } = await booking.createHold(
      holdInput({
        startsAt: daquiAPouco,
        endsAt: new Date(daquiAPouco.getTime() + 45 * 60000),
        occupiesFrom: daquiAPouco,
        occupiesTo: new Date(daquiAPouco.getTime() + 45 * 60000),
      })
    );
    const { appointmentId } = await confirm(holdToken);

    await assert.rejects(
      () => booking.cancelAppointment({ appointmentId, actorType: "CUSTOMER" }),
      booking.PolicyError
    );

    // A barbearia continua podendo cancelar
    await booking.cancelAppointment({ appointmentId, actorType: "STAFF" });

    await prisma.barbershop.update({
      where: { id: SHOP },
      data: { cancellationNoticeMinutes: 0 },
    });
  });

  test("registra evento na trilha", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    const { appointmentId } = await confirm(holdToken);
    await booking.cancelAppointment({ appointmentId, actorType: "CUSTOMER", reason: "imprevisto" });

    const eventos = await prisma.appointmentEvent.findMany({
      where: { appointmentId },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(eventos.map((e) => e.type), ["CREATED", "CANCELLED"]);
  });
});

describe("remarcação", () => {
  test("move o horário, preserva histórico e não conta como cancelamento", async () => {
    const primeiro = await booking.createHold(holdInput());
    const { appointmentId: original } = await confirm(primeiro.holdToken);

    const novoHold = await booking.createHold(
      holdInput({ startsAt: minutes(180), endsAt: minutes(225), occupiesFrom: minutes(170), occupiesTo: minutes(235) })
    );
    const { appointmentId: novo } = await booking.rescheduleAppointment({
      appointmentId: original,
      holdToken: novoHold.holdToken,
      actorType: "CUSTOMER",
    });

    const anterior = await prisma.appointment.findUniqueOrThrow({ where: { id: original } });
    const atual = await prisma.appointment.findUniqueOrThrow({ where: { id: novo } });

    // O ponto da decisão #15: remarcação tem estado próprio
    assert.equal(anterior.status, "RESCHEDULED");
    assert.notEqual(anterior.status, "CANCELLED_BY_CUSTOMER");
    assert.equal(atual.status, "CONFIRMED");
    assert.equal(atual.previousAppointmentId, original);

    // Mesmo cliente, sem duplicar relação
    assert.equal(atual.barbershopCustomerId, anterior.barbershopCustomerId);

    // Nada foi apagado
    assert.equal(await prisma.appointment.count({ where: { barbershopId: SHOP } }), 2);
  });

  test("o horário antigo volta a ficar livre", async () => {
    const primeiro = await booking.createHold(holdInput());
    const { appointmentId } = await confirm(primeiro.holdToken);

    const novoHold = await booking.createHold(
      holdInput({ startsAt: minutes(180), endsAt: minutes(225), occupiesFrom: minutes(170), occupiesTo: minutes(235) })
    );
    await booking.rescheduleAppointment({
      appointmentId,
      holdToken: novoHold.holdToken,
      actorType: "CUSTOMER",
    });

    const reaproveitado = await booking.createHold(holdInput());
    assert.ok(reaproveitado.holdToken, "o horário liberado deveria estar reservável");
  });

  test("remarcar emite token novo", async () => {
    const primeiro = await booking.createHold(holdInput());
    const confirmado = await confirm(primeiro.holdToken);

    const novoHold = await booking.createHold(
      holdInput({ startsAt: minutes(180), endsAt: minutes(225), occupiesFrom: minutes(170), occupiesTo: minutes(235) })
    );
    const remarcado = await booking.rescheduleAppointment({
      appointmentId: confirmado.appointmentId,
      holdToken: novoHold.holdToken,
      actorType: "CUSTOMER",
    });

    assert.notEqual(remarcado.managementToken, confirmado.managementToken);

    // O token antigo deixa de dar acesso de escrita: aponta para um
    // agendamento que não está mais ativo
    const antigo = await booking.findByManagementToken(confirmado.managementToken);
    assert.equal(antigo.status, "RESCHEDULED");
  });

  test("trilha registra os dois lados da remarcação", async () => {
    const primeiro = await booking.createHold(holdInput());
    const { appointmentId: original } = await confirm(primeiro.holdToken);
    const novoHold = await booking.createHold(
      holdInput({ startsAt: minutes(180), endsAt: minutes(225), occupiesFrom: minutes(170), occupiesTo: minutes(235) })
    );
    const { appointmentId: novo } = await booking.rescheduleAppointment({
      appointmentId: original,
      holdToken: novoHold.holdToken,
      actorType: "CUSTOMER",
    });

    const saida = await prisma.appointmentEvent.findMany({ where: { appointmentId: original } });
    const entrada = await prisma.appointmentEvent.findMany({ where: { appointmentId: novo } });

    assert.ok(saida.some((e) => e.type === "RESCHEDULED_AWAY"));
    assert.ok(entrada.some((e) => e.type === "RESCHEDULED_INTO"));
  });
});

describe("token de gestão", () => {
  test("resolve o agendamento a partir do token cru", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    const { appointmentId, managementToken } = await confirm(holdToken);

    const encontrado = await booking.findByManagementToken(managementToken);
    assert.equal(encontrado.id, appointmentId);
  });

  test("token errado não encontra nada", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    await confirm(holdToken);
    assert.equal(await booking.findByManagementToken(generateToken()), null);
  });
});

describe("efeitos assíncronos", () => {
  test("confirmação enfileira o efeito sem depender dele", async () => {
    const { holdToken } = await booking.createHold(holdInput());
    const { appointmentId } = await confirm(holdToken);

    const eventos = await prisma.outboxEvent.findMany({ where: { barbershopId: SHOP } });
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].type, "APPOINTMENT_CONFIRMED");
    assert.equal(eventos[0].status, "PENDING");
    assert.equal(eventos[0].payload.appointmentId, appointmentId);
  });
});
