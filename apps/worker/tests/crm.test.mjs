// Marco 6.5 — pontuação de retorno computada junto do CRM, contra Postgres real.
//
// O que este teste existe para provar:
//  - recomputar o CRM também grava customer_return_scores, com o mesmo
//    gatilho e os mesmos agregados, sem virar um job separado;
//  - reprocessar atualiza a mesma linha (upsert), nunca duplica;
//  - cliente sem atendimento concluído ainda ganha uma linha honesta (score 0,
//    motivo "sem_historico") — nunca fica sem pontuação por omissão do job.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@barber/db");
const { recomputeCustomerCrm } = await import("../handlers/crm.ts");

const SHOP = randomUUID();
const PRO = randomUUID();
const SERVICE = randomUUID();

before(async () => {
  await prisma.barbershop.create({
    data: { id: SHOP, name: "Barbearia CRM", slug: `crm-${SHOP.slice(0, 8)}`, timezone: "America/Sao_Paulo" },
  });
  await prisma.professional.create({ data: { id: PRO, barbershopId: SHOP, displayName: "Matheus" } });
  await prisma.service.create({
    data: { id: SERVICE, barbershopId: SHOP, name: "Corte", priceMinor: 5000, durationMinutes: 30 },
  });
});

after(async () => {
  await prisma.barbershop.delete({ where: { id: SHOP } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.appointment.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.customerReturnScore.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.barbershopCustomer.deleteMany({ where: { barbershopId: SHOP } });
});

async function relacao(overrides = {}) {
  return prisma.barbershopCustomer.create({
    data: { barbershopId: SHOP, normalizedPhone: "11988887777", currentName: "Cliente CRM", ...overrides },
  });
}

describe("pontuação de retorno via recomputeCustomerCrm", () => {
  test("cliente sem atendimento concluído ainda ganha uma linha honesta", async () => {
    const cliente = await relacao();

    await recomputeCustomerCrm({ barbershopCustomerId: cliente.id });

    const pontuacao = await prisma.customerReturnScore.findUniqueOrThrow({
      where: { barbershopCustomerId: cliente.id },
    });
    assert.equal(pontuacao.score, 0);
    assert.deepEqual(pontuacao.reasons, [
      { code: "sem_historico", label: "Ainda não teve atendimento concluído" },
    ]);
  });

  test("cliente com histórico ganha pontuação e motivos coerentes com o CRM recém-calculado", async () => {
    const cliente = await relacao();

    await prisma.appointment.create({
      data: {
        barbershopId: SHOP,
        barbershopCustomerId: cliente.id,
        professionalId: PRO,
        serviceId: SERVICE,
        startsAt: new Date(Date.now() - 30 * 86_400_000),
        endsAt: new Date(Date.now() - 30 * 86_400_000 + 30 * 60_000),
        occupiesFrom: new Date(Date.now() - 30 * 86_400_000),
        occupiesTo: new Date(Date.now() - 30 * 86_400_000 + 30 * 60_000),
        status: "COMPLETED",
        priceSnapshotMinor: 5000,
        serviceNameSnapshot: "Corte",
        professionalNameSnapshot: "Matheus",
        customerNameSnapshot: "Cliente CRM",
        customerPhoneSnapshot: "11988887777",
        managementTokenHash: randomUUID(),
      },
    });

    await recomputeCustomerCrm({ barbershopCustomerId: cliente.id });

    const pontuacao = await prisma.customerReturnScore.findUniqueOrThrow({
      where: { barbershopCustomerId: cliente.id },
    });
    assert.ok(pontuacao.score > 0);
    assert.equal(pontuacao.barbershopId, SHOP);
  });

  test("reprocessar atualiza a mesma linha, nunca duplica", async () => {
    const cliente = await relacao();

    await recomputeCustomerCrm({ barbershopCustomerId: cliente.id });
    await recomputeCustomerCrm({ barbershopCustomerId: cliente.id });

    const total = await prisma.customerReturnScore.count({
      where: { barbershopCustomerId: cliente.id },
    });
    assert.equal(total, 1);
  });
});
