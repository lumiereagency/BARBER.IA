// Marco 6.3 — detecção de vaga por cancelamento, contra Postgres real.
//
// O que estes testes existem para provar:
//  - só barbearia com Agenda Inteligente no plano (e assinatura válida) gera vaga;
//  - vaga preserva o horário exato liberado, nunca recalcula outro;
//  - valor estimado é o do serviço que liberou a vaga, não uma soma ou invenção;
//  - serviços cujo footprint não cabe no espaço liberado não entram como compatíveis;
//  - cancelamento longe demais (fora da janela de 72h) não gera vaga;
//  - horário reocupado entre o cancelamento e o processamento não gera vaga;
//  - reprocessar o mesmo evento não duplica a vaga (idempotência do outbox);
//  - vaga aberta expira sozinha quando o horário chega e ninguém confirmou.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.TOKEN_HMAC_SECRET ??= "test-only-secret";

const { prisma } = await import("@barber/db");
const booking = await import("../../web/lib/booking.ts");
const worker = await import("../index.ts");
const { detectSmartOpportunity } = await import("../handlers/smart-opportunity.ts");

const SHOP = randomUUID();
const PRO = randomUUID();
// Cabe no espaço liberado por SERVICE (30min, sem buffer): 20min, sem buffer.
const SERVICE = randomUUID();
const SERVICE_CURTO = randomUUID();
// Não cabe: 60min, maior que os 30min liberados.
const SERVICE_LONGO = randomUUID();
const ATOR = randomUUID();
const PLAN_PRO = randomUUID();
const PLAN_SEM_AGENDA = randomUUID();

const horas = (n) => new Date(Date.now() + n * 60 * 60 * 1000);

before(async () => {
  await prisma.barbershop.create({
    data: {
      id: SHOP,
      name: "Barbearia Agenda Inteligente",
      slug: `vaga-${SHOP.slice(0, 8)}`,
      timezone: "America/Sao_Paulo",
      cancellationNoticeMinutes: 0,
    },
  });
  await prisma.professional.create({
    data: { id: PRO, barbershopId: SHOP, displayName: "Matheus" },
  });
  await prisma.service.createMany({
    data: [
      { id: SERVICE, barbershopId: SHOP, name: "Corte", priceMinor: 5000, durationMinutes: 30 },
      {
        id: SERVICE_CURTO,
        barbershopId: SHOP,
        name: "Barba",
        priceMinor: 3000,
        durationMinutes: 20,
      },
      {
        id: SERVICE_LONGO,
        barbershopId: SHOP,
        name: "Combo completo",
        priceMinor: 9000,
        durationMinutes: 60,
      },
    ],
  });
  await prisma.professionalService.createMany({
    data: [
      { barbershopId: SHOP, professionalId: PRO, serviceId: SERVICE },
      { barbershopId: SHOP, professionalId: PRO, serviceId: SERVICE_CURTO },
      { barbershopId: SHOP, professionalId: PRO, serviceId: SERVICE_LONGO },
    ],
  });
  await prisma.plan.createMany({
    data: [
      {
        id: PLAN_PRO,
        code: `pro-teste-${SHOP.slice(0, 8)}`,
        name: "Pro (teste)",
        priceMinor: 9990,
        features: { smartAgenda: true, waitlist: true, advancedReports: true, baileys: true },
      },
      {
        id: PLAN_SEM_AGENDA,
        code: `essencial-teste-${SHOP.slice(0, 8)}`,
        name: "Essencial (teste)",
        priceMinor: 4990,
        features: { smartAgenda: false, waitlist: false, advancedReports: false, baileys: false },
      },
    ],
  });
});

after(async () => {
  await prisma.barbershop.delete({ where: { id: SHOP } });
  await prisma.plan.deleteMany({ where: { id: { in: [PLAN_PRO, PLAN_SEM_AGENDA] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.outboxEvent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.smartOpportunity.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointmentEvent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointmentHold.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointment.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.subscription.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.barbershopCustomer.deleteMany({ where: { barbershopId: SHOP } });
});

async function assinarPro() {
  await prisma.subscription.create({
    data: {
      barbershopId: SHOP,
      planId: PLAN_PRO,
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: horas(24 * 30),
    },
  });
}

async function agendar(offsetHoras, serviceId = SERVICE) {
  const { appointmentId } = await booking.createManualAppointment({
    barbershopId: SHOP,
    professionalId: PRO,
    serviceId,
    startsAt: horas(offsetHoras),
    customerName: "Cliente Balcão",
    customerPhone: `1199999${String(1000 + Math.floor(Math.random() * 8999))}`,
    actorId: ATOR,
  });
  return prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
}

/// Processa o outbox pendente da barbearia até esvaziar.
async function drenarFila(rodadas = 5) {
  let total = { processados: 0, falhas: 0 };
  for (let i = 0; i < rodadas; i++) {
    const pendentes = await prisma.outboxEvent.count({
      where: { barbershopId: SHOP, status: "PENDING" },
    });
    if (pendentes === 0) break;
    const { processados, falhas } = await worker.processBatch();
    total = { processados: total.processados + processados, falhas: total.falhas + falhas };
  }
  return total;
}

describe("gating por plano", () => {
  test("sem assinatura, cancelamento não gera vaga", async () => {
    const appointment = await agendar(24);
    await booking.cancelByShop({ barbershopId: SHOP, appointmentId: appointment.id, actorId: ATOR });

    await detectSmartOpportunity({ appointmentId: appointment.id });

    const vagas = await prisma.smartOpportunity.findMany({ where: { barbershopId: SHOP } });
    assert.equal(vagas.length, 0);
  });

  test("plano sem Agenda Inteligente não gera vaga", async () => {
    await prisma.subscription.create({
      data: {
        barbershopId: SHOP,
        planId: PLAN_SEM_AGENDA,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: horas(24 * 30),
      },
    });
    const appointment = await agendar(24);
    await booking.cancelByShop({ barbershopId: SHOP, appointmentId: appointment.id, actorId: ATOR });

    await detectSmartOpportunity({ appointmentId: appointment.id });

    const vagas = await prisma.smartOpportunity.findMany({ where: { barbershopId: SHOP } });
    assert.equal(vagas.length, 0);
  });
});

describe("geração da vaga", () => {
  test("cancelamento dentro da janela com Pro gera vaga no mesmo horário, com valor da vaga e serviços compatíveis", async () => {
    await assinarPro();
    const appointment = await agendar(24, SERVICE);

    await booking.cancelByShop({ barbershopId: SHOP, appointmentId: appointment.id, actorId: ATOR });
    const { falhas } = await drenarFila();
    assert.equal(falhas, 0);

    const vaga = await prisma.smartOpportunity.findFirstOrThrow({
      where: { barbershopId: SHOP, professionalId: PRO },
    });
    assert.equal(vaga.status, "OPEN");
    assert.equal(vaga.startsAt.getTime(), appointment.startsAt.getTime());
    assert.equal(vaga.endsAt.getTime(), appointment.endsAt.getTime());
    assert.equal(vaga.estimatedRevenueMinor, appointment.priceSnapshotMinor);
    assert.ok(vaga.compatibleServiceIds.includes(SERVICE), "o próprio serviço cancelado cabe na vaga que deixou");
    assert.ok(vaga.compatibleServiceIds.includes(SERVICE_CURTO), "serviço mais curto cabe no espaço liberado");
    assert.equal(
      vaga.compatibleServiceIds.includes(SERVICE_LONGO),
      false,
      "serviço mais longo que o espaço liberado não é compatível"
    );
    assert.equal(
      vaga.shareTokenHash,
      null,
      "o link só é gerado quando a equipe pede, no painel (Marco 6.6)"
    );
    assert.equal(vaga.expiresAt.getTime(), appointment.startsAt.getTime());
  });

  test("cancelamento fora da janela de 72h não gera vaga", async () => {
    await assinarPro();
    const appointment = await agendar(24 * 10);

    await booking.cancelByShop({ barbershopId: SHOP, appointmentId: appointment.id, actorId: ATOR });
    await detectSmartOpportunity({ appointmentId: appointment.id });

    const vagas = await prisma.smartOpportunity.findMany({ where: { barbershopId: SHOP } });
    assert.equal(vagas.length, 0);
  });

  test("horário reocupado antes do processamento não gera vaga", async () => {
    await assinarPro();
    const appointment = await agendar(24);
    await booking.cancelByShop({ barbershopId: SHOP, appointmentId: appointment.id, actorId: ATOR });

    // Alguém reserva o mesmo horário pelo balcão antes do worker processar.
    await booking.createManualAppointment({
      barbershopId: SHOP,
      professionalId: PRO,
      serviceId: SERVICE,
      startsAt: appointment.startsAt,
      customerName: "Outro Cliente",
      customerPhone: "11988887777",
      actorId: ATOR,
    });

    await detectSmartOpportunity({ appointmentId: appointment.id });

    const vagas = await prisma.smartOpportunity.findMany({ where: { barbershopId: SHOP } });
    assert.equal(vagas.length, 0);
  });

  test("reprocessar o mesmo evento não duplica a vaga", async () => {
    await assinarPro();
    const appointment = await agendar(24);
    await booking.cancelByShop({ barbershopId: SHOP, appointmentId: appointment.id, actorId: ATOR });

    await detectSmartOpportunity({ appointmentId: appointment.id });
    await detectSmartOpportunity({ appointmentId: appointment.id });

    const vagas = await prisma.smartOpportunity.findMany({
      where: { barbershopId: SHOP, status: "OPEN" },
    });
    assert.equal(vagas.length, 1);
  });

  test("cancelamento pelo cliente também gera vaga", async () => {
    await assinarPro();
    const appointment = await agendar(24);

    await booking.cancelAppointment({ appointmentId: appointment.id, actorType: "CUSTOMER" });
    const { falhas } = await drenarFila();
    assert.equal(falhas, 0);

    const vaga = await prisma.smartOpportunity.findFirstOrThrow({
      where: { barbershopId: SHOP, professionalId: PRO },
    });
    assert.equal(vaga.status, "OPEN");
  });
});

describe("expiração", () => {
  test("vaga aberta expira quando o horário chega e ninguém confirmou", async () => {
    await assinarPro();
    await prisma.smartOpportunity.create({
      data: {
        barbershopId: SHOP,
        professionalId: PRO,
        startsAt: horas(-1),
        endsAt: horas(-0.5),
        compatibleServiceIds: [SERVICE],
        estimatedRevenueMinor: 5000,
        status: "OPEN",
        expiresAt: horas(-1),
      },
    });

    const expiradas = await worker.expireSmartOpportunities();
    assert.ok(expiradas >= 1);

    const vaga = await prisma.smartOpportunity.findFirstOrThrow({
      where: { barbershopId: SHOP, professionalId: PRO },
    });
    assert.equal(vaga.status, "EXPIRED");
  });
});
