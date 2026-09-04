// Marco 6.4 — reivindicação da vaga pública (/vaga/{token}), contra Postgres real.
//
// O que estes testes existem para provar:
//  - token inválido, vaga expirada ou já preenchida nunca reivindicam nada;
//  - serviço fora da lista de compatíveis é recusado;
//  - reivindicar cria o agendamento com a origem SMART_OPPORTUNITY e marca a
//    vaga como preenchida, sem mudar o horário oferecido;
//  - duas pessoas disputando a mesma vaga: só uma leva (a mesma constraint de
//    exclusão do fluxo normal decide, sem lock novo).

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.TOKEN_HMAC_SECRET ??= "test-only-secret";

const { prisma } = await import("@barber/db");
const { generateToken, hashToken } = await import("@barber/domain");
const { claimSmartOpportunity, generateShareLink } = await import("../lib/smart-opportunity.ts");
const { NotFoundError, PolicyError, SlotUnavailableError } = await import("../lib/booking.ts");

const SHOP = randomUUID();
const PRO = randomUUID();
const SERVICE = randomUUID();
const SERVICE_INCOMPATIVEL = randomUUID();

const base = new Date("2027-11-08T13:00:00Z");
const minutes = (n) => new Date(base.getTime() + n * 60000);

function tokenSecret() {
  return process.env.TOKEN_HMAC_SECRET;
}

before(async () => {
  await prisma.barbershop.create({
    data: {
      id: SHOP,
      name: "Barbearia Vaga",
      slug: `vaga-pub-${SHOP.slice(0, 8)}`,
      timezone: "America/Sao_Paulo",
      cancellationNoticeMinutes: 0,
      holdDurationMinutes: 5,
    },
  });
  await prisma.professional.create({
    data: { id: PRO, barbershopId: SHOP, displayName: "Matheus" },
  });
  await prisma.service.createMany({
    data: [
      { id: SERVICE, barbershopId: SHOP, name: "Corte", priceMinor: 5000, durationMinutes: 30 },
      {
        id: SERVICE_INCOMPATIVEL,
        barbershopId: SHOP,
        name: "Coloração",
        priceMinor: 12000,
        durationMinutes: 90,
      },
    ],
  });
  await prisma.professionalService.createMany({
    data: [
      { barbershopId: SHOP, professionalId: PRO, serviceId: SERVICE },
      { barbershopId: SHOP, professionalId: PRO, serviceId: SERVICE_INCOMPATIVEL },
    ],
  });
});

after(async () => {
  await prisma.barbershop.delete({ where: { id: SHOP } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.appointmentEvent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointmentHold.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointment.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.smartOpportunity.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.consent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.barbershopCustomer.deleteMany({ where: { barbershopId: SHOP } });
});

/// Cria a vaga como o worker criaria — só o hash do token vive no banco.
async function criarVaga(overrides = {}) {
  const token = generateToken();
  const startsAt = minutes(0);
  const endsAt = minutes(30);

  await prisma.smartOpportunity.create({
    data: {
      barbershopId: SHOP,
      professionalId: PRO,
      startsAt,
      endsAt,
      compatibleServiceIds: [SERVICE],
      estimatedRevenueMinor: 5000,
      status: "OPEN",
      expiresAt: startsAt,
      shareTokenHash: hashToken(token, tokenSecret()),
      ...overrides,
    },
  });

  return { token, startsAt, endsAt };
}

function reivindicar(token, overrides = {}) {
  return claimSmartOpportunity({
    token,
    serviceId: SERVICE,
    customerName: "Cliente da Vaga",
    customerPhone: "11999990000",
    acceptedTermsVersion: "dev-0",
    ...overrides,
  });
}

describe("token e estado da vaga", () => {
  test("token inventado não reivindica nada", async () => {
    await assert.rejects(() => reivindicar(generateToken()), NotFoundError);
  });

  test("vaga expirada não pode ser reivindicada", async () => {
    const { token } = await criarVaga({ expiresAt: new Date(Date.now() - 60_000) });
    await assert.rejects(() => reivindicar(token), SlotUnavailableError);
  });

  test("vaga já preenchida não pode ser reivindicada de novo", async () => {
    const { token } = await criarVaga({ status: "FILLED" });
    await assert.rejects(() => reivindicar(token), SlotUnavailableError);
  });

  test("serviço fora da lista de compatíveis é recusado", async () => {
    const { token } = await criarVaga();
    await assert.rejects(
      () => reivindicar(token, { serviceId: SERVICE_INCOMPATIVEL }),
      PolicyError
    );
  });
});

describe("reivindicação", () => {
  test("cria o agendamento com origem SMART_OPPORTUNITY, no horário exato da vaga, e marca a vaga como preenchida", async () => {
    const { token, startsAt, endsAt } = await criarVaga();

    const { appointmentId, managementToken } = await reivindicar(token);
    assert.ok(appointmentId);
    assert.ok(managementToken);

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    assert.equal(appointment.source, "SMART_OPPORTUNITY");
    assert.equal(appointment.status, "CONFIRMED");
    assert.equal(appointment.startsAt.getTime(), startsAt.getTime());
    assert.equal(appointment.endsAt.getTime(), endsAt.getTime());
    assert.equal(appointment.serviceId, SERVICE);

    const opportunity = await prisma.smartOpportunity.findFirstOrThrow({
      where: { barbershopId: SHOP },
    });
    assert.equal(opportunity.status, "FILLED");
    assert.equal(opportunity.claimedAppointmentId, appointmentId);
  });

  test("duas pessoas disputando a mesma vaga: só uma leva", async () => {
    const { token } = await criarVaga();

    const resultados = await Promise.allSettled([
      reivindicar(token, { customerPhone: "11911111111" }),
      reivindicar(token, { customerPhone: "11922222222" }),
    ]);

    const vencedores = resultados.filter((r) => r.status === "fulfilled");
    assert.equal(vencedores.length, 1, "a mesma vaga não pode virar duas reservas");

    const total = await prisma.appointment.count({
      where: { barbershopId: SHOP, status: "CONFIRMED" },
    });
    assert.equal(total, 1);

    const opportunity = await prisma.smartOpportunity.findFirstOrThrow({
      where: { barbershopId: SHOP },
    });
    assert.equal(opportunity.status, "FILLED");
    assert.equal(opportunity.claimedAppointmentId, vencedores[0].value.appointmentId);
  });
});

describe("gerar link compartilhável (painel da equipe, Marco 6.6)", () => {
  test("vaga nasce sem link — só a equipe gera", async () => {
    await criarVaga({ shareTokenHash: null });

    const opportunity = await prisma.smartOpportunity.findFirstOrThrow({
      where: { barbershopId: SHOP },
    });
    assert.equal(opportunity.shareTokenHash, null);
  });

  test("gerar o link grava o hash e devolve uma URL /vaga/ funcional", async () => {
    const { startsAt } = await criarVaga({ shareTokenHash: null });
    const opportunity = await prisma.smartOpportunity.findFirstOrThrow({
      where: { barbershopId: SHOP },
    });

    const { shareUrl } = await generateShareLink(SHOP, opportunity.id);
    assert.ok(shareUrl.includes("/vaga/"));

    const geradoToken = shareUrl.split("/vaga/")[1];
    const claimed = await claimSmartOpportunity({
      token: geradoToken,
      serviceId: SERVICE,
      customerName: "Cliente via link gerado",
      customerPhone: "11977776666",
      acceptedTermsVersion: "dev-0",
    });
    assert.ok(claimed.appointmentId);

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: claimed.appointmentId },
    });
    assert.equal(appointment.startsAt.getTime(), startsAt.getTime());
  });

  test("gerar o link duas vezes é recusado — token cru nunca é regravado", async () => {
    await criarVaga({ shareTokenHash: null });
    const entry = await prisma.smartOpportunity.findFirstOrThrow({ where: { barbershopId: SHOP } });

    await generateShareLink(SHOP, entry.id);
    await assert.rejects(() => generateShareLink(SHOP, entry.id), PolicyError);
  });

  test("vaga de outra barbearia não é encontrada", async () => {
    const OUTRA_SHOP = randomUUID();
    await prisma.barbershop.create({
      data: { id: OUTRA_SHOP, name: "Outra Barbearia", slug: `outra-${OUTRA_SHOP.slice(0, 8)}` },
    });

    try {
      await criarVaga({ shareTokenHash: null });
      const entry = await prisma.smartOpportunity.findFirstOrThrow({ where: { barbershopId: SHOP } });

      await assert.rejects(() => generateShareLink(OUTRA_SHOP, entry.id), NotFoundError);
    } finally {
      await prisma.barbershop.delete({ where: { id: OUTRA_SHOP } });
    }
  });

  test("vaga já preenchida não gera link", async () => {
    await criarVaga({ shareTokenHash: null, status: "FILLED" });
    const entry = await prisma.smartOpportunity.findFirstOrThrow({ where: { barbershopId: SHOP } });

    await assert.rejects(() => generateShareLink(SHOP, entry.id), PolicyError);
  });
});
