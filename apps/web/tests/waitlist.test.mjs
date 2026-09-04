// Marco 6.5 — lista de espera, contra Postgres real.
//
// O que estes testes existem para provar:
//  - entrar na lista de espera cria a relação com o cliente e a entrada
//    WAITING, sem exigir cadastro nem conta;
//  - a pontuação gravada na entrada é a propensão geral já calculada pelo CRM
//    — nunca inventada quando o cliente ainda não tem histórico;
//  - serviço/profissional inválidos ou incompatíveis entre si são recusados;
//  - dois consentimentos distintos ficam registrados (termos gerais e
//    contato sobre esta fila), nunca colapsados num só.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.TOKEN_HMAC_SECRET ??= "test-only-secret";

const { prisma } = await import("@barber/db");
const { joinWaitlist } = await import("../lib/waitlist.ts");
const { NotFoundError, PolicyError } = await import("../lib/booking.ts");

const SHOP = randomUUID();
const PRO = randomUUID();
const SERVICE = randomUUID();
const SERVICE_SEM_LINK = randomUUID();

before(async () => {
  await prisma.barbershop.create({
    data: { id: SHOP, name: "Barbearia Espera", slug: `espera-${SHOP.slice(0, 8)}`, timezone: "America/Sao_Paulo" },
  });
  await prisma.professional.create({ data: { id: PRO, barbershopId: SHOP, displayName: "Matheus" } });
  await prisma.service.createMany({
    data: [
      { id: SERVICE, barbershopId: SHOP, name: "Corte", priceMinor: 5000, durationMinutes: 30 },
      { id: SERVICE_SEM_LINK, barbershopId: SHOP, name: "Sobrancelha", priceMinor: 2000, durationMinutes: 15 },
    ],
  });
  await prisma.professionalService.create({
    data: { barbershopId: SHOP, professionalId: PRO, serviceId: SERVICE },
  });
});

after(async () => {
  await prisma.barbershop.delete({ where: { id: SHOP } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.waitlistEntry.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.consent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.customerReturnScore.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.barbershopCustomer.deleteMany({ where: { barbershopId: SHOP } });
});

function entrar(overrides = {}) {
  return joinWaitlist({
    barbershopId: SHOP,
    customerName: "Cliente Espera",
    customerPhone: "11999990000",
    acceptedTermsVersion: "dev-0",
    contactConsentTextVersion: "dev-0-espera",
    ...overrides,
  });
}

describe("entrar na lista de espera", () => {
  test("cria a relação e a entrada WAITING, sem pontuação inventada", async () => {
    const { id, status } = await entrar();
    assert.equal(status, "WAITING");

    const entry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id } });
    assert.equal(entry.status, "WAITING");
    assert.equal(entry.rankScore, null, "sem CustomerReturnScore prévio, não inventa pontuação");

    const relation = await prisma.barbershopCustomer.findFirstOrThrow({
      where: { barbershopId: SHOP, normalizedPhone: "+5511999990000" },
    });
    assert.equal(relation.currentName, "Cliente Espera");
  });

  test("usa a propensão de retorno já calculada, quando existe", async () => {
    const relation = await prisma.barbershopCustomer.create({
      data: { barbershopId: SHOP, normalizedPhone: "+5511988887777", currentName: "Cliente Antigo" },
    });
    await prisma.customerReturnScore.create({
      data: {
        barbershopId: SHOP,
        barbershopCustomerId: relation.id,
        score: 42,
        reasons: [{ code: "recorrente", label: "Já veio 3 vezes" }],
      },
    });

    const { id } = await entrar({ customerPhone: "11988887777" });

    const entry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id } });
    assert.equal(entry.rankScore, 42);
    assert.deepEqual(entry.rankReasons, [{ code: "recorrente", label: "Já veio 3 vezes" }]);
  });

  test("dois consentimentos distintos ficam registrados", async () => {
    await entrar();

    const consentimentos = await prisma.consent.findMany({
      where: { barbershopId: SHOP, source: "public_waitlist" },
      orderBy: { textVersion: "asc" },
    });
    assert.equal(consentimentos.length, 2);
    assert.deepEqual(
      consentimentos.map((c) => c.textVersion).sort(),
      ["dev-0", "dev-0-espera"]
    );
  });

  test("serviço inexistente é recusado", async () => {
    await assert.rejects(() => entrar({ serviceId: randomUUID() }), NotFoundError);
  });

  test("profissional que não realiza o serviço pedido é recusado", async () => {
    await assert.rejects(
      () => entrar({ serviceId: SERVICE_SEM_LINK, professionalId: PRO }),
      PolicyError
    );
  });

  test("mesmo telefone duas vezes não duplica o cliente, mas cria duas entradas", async () => {
    await entrar();
    await entrar();

    const clientes = await prisma.barbershopCustomer.count({
      where: { barbershopId: SHOP, normalizedPhone: "+5511999990000" },
    });
    assert.equal(clientes, 1);

    const entradas = await prisma.waitlistEntry.count({ where: { barbershopId: SHOP } });
    assert.equal(entradas, 2);
  });
});
