// Conta do consumidor e CRM (Marco 4), contra Postgres real.
//
// O que estes testes existem para impedir:
//  - código de OTP adivinhável ou legível no banco;
//  - força bruta compensar;
//  - a tela revelar quais telefones têm cadastro;
//  - herdar histórico de número de celular reciclado;
//  - CRM inventar número quando não há dado.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.TOKEN_HMAC_SECRET ??= "test-only-secret";
process.env.AUTH_SECRET ??= "test-only-secret";

const { prisma } = await import("@barber/db");
const { hashToken } = await import("@barber/domain");
const auth = await import("../lib/customer-account.ts");
const { setMessagingProvider } = await import("../lib/messaging.ts");
const { recomputeCustomerCrm } = await import("../../worker/handlers/crm.ts");

const SHOP = randomUUID();
const OUTRA_SHOP = randomUUID();
const PRO = randomUUID();
const SERVICE = randomUUID();
const TELEFONE = "+5511955551234";

/// Captura o que seria enviado, em vez de enviar
const enviados = [];
setMessagingProvider({
  name: "teste",
  async sendAccessCode(input) {
    enviados.push(input);
  },
});

const ultimoCodigo = () => enviados.at(-1)?.code;

before(async () => {
  for (const [id, nome] of [
    [SHOP, "Barbearia Consumidor"],
    [OUTRA_SHOP, "Outra Barbearia"],
  ]) {
    await prisma.barbershop.create({
      data: { id, name: nome, slug: `cons-${id.slice(0, 8)}`, timezone: "America/Sao_Paulo" },
    });
  }
  await prisma.professional.create({
    data: { id: PRO, barbershopId: SHOP, displayName: "Matheus" },
  });
  await prisma.service.create({
    data: { id: SERVICE, barbershopId: SHOP, name: "Corte", priceMinor: 5000, durationMinutes: 30 },
  });
});

after(async () => {
  await prisma.barbershop.deleteMany({ where: { id: { in: [SHOP, OUTRA_SHOP] } } });
  await prisma.customer.deleteMany({ where: { normalizedPhone: { contains: "+55119555" } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  enviados.length = 0;
  await prisma.customerAuthChallenge.deleteMany({});
  await prisma.appointment.deleteMany({ where: { barbershopId: { in: [SHOP, OUTRA_SHOP] } } });
  await prisma.barbershopCustomer.deleteMany({
    where: { barbershopId: { in: [SHOP, OUTRA_SHOP] } },
  });
  await prisma.customerSession.deleteMany({});
  await prisma.customer.deleteMany({ where: { normalizedPhone: { contains: "+55119555" } } });
});

async function relacao(overrides = {}) {
  return prisma.barbershopCustomer.create({
    data: {
      barbershopId: SHOP,
      normalizedPhone: TELEFONE,
      currentName: "João",
      ...overrides,
    },
  });
}

describe("pedido de código", () => {
  test("envia o código pelo canal, sem devolvê-lo na resposta", async () => {
    const resultado = await auth.requestAccessCode("(11) 95555-1234");

    assert.deepEqual(resultado, { sent: true });
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].destination, TELEFONE);
    assert.match(enviados[0].code, /^\d{6}$/);
    // O código não pode voltar na resposta: qualquer um pediria o de outro
    assert.equal(JSON.stringify(resultado).includes(enviados[0].code), false);
  });

  test("o código não é guardado em claro no banco", async () => {
    await auth.requestAccessCode(TELEFONE);
    const desafio = await prisma.customerAuthChallenge.findFirstOrThrow({
      where: { destination: TELEFONE },
    });

    assert.notEqual(desafio.codeHash, ultimoCodigo());
    assert.equal(desafio.codeHash, hashToken(ultimoCodigo(), process.env.AUTH_SECRET));
  });

  test("telefone sem cadastro recebe a mesma resposta de quem tem", async () => {
    const semCadastro = await auth.requestAccessCode("+5511955559999");
    await relacao();
    const comCadastro = await auth.requestAccessCode(TELEFONE);

    // Resposta idêntica: a tela não é oráculo de quem tem conta
    assert.deepEqual(semCadastro, comCadastro);
  });

  test("telefone inválido é recusado", async () => {
    await assert.rejects(() => auth.requestAccessCode("123"), auth.InvalidPhoneError);
  });

  test("pedir de novo invalida o código anterior", async () => {
    await auth.requestAccessCode(TELEFONE);
    const primeiro = ultimoCodigo();
    await auth.requestAccessCode(TELEFONE);

    await assert.rejects(
      () => auth.verifyAccessCode(TELEFONE, primeiro),
      auth.InvalidCodeError
    );
    // O novo continua valendo
    const resultado = await auth.verifyAccessCode(TELEFONE, ultimoCodigo());
    assert.ok(resultado.customerId);
  });

  test("limite de pedidos por telefone freia a máquina de SMS", async () => {
    await auth.requestAccessCode(TELEFONE);
    await auth.requestAccessCode(TELEFONE);
    await auth.requestAccessCode(TELEFONE);
    await assert.rejects(() => auth.requestAccessCode(TELEFONE), auth.TooManyRequestsError);
  });
});

describe("verificação", () => {
  test("código correto autentica e cria o cadastro global", async () => {
    await relacao();
    await auth.requestAccessCode(TELEFONE);

    const { customerId } = await auth.verifyAccessCode(TELEFONE, ultimoCodigo());
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });

    assert.equal(customer.normalizedPhone, TELEFONE);
    assert.ok(customer.phoneVerifiedAt, "o telefone precisa ficar marcado como verificado");
  });

  test("código errado não entra", async () => {
    await auth.requestAccessCode(TELEFONE);
    const errado = ultimoCodigo() === "000000" ? "111111" : "000000";
    await assert.rejects(() => auth.verifyAccessCode(TELEFONE, errado), auth.InvalidCodeError);
  });

  test("força bruta esgota as tentativas e queima o código", async () => {
    await auth.requestAccessCode(TELEFONE);
    const certo = ultimoCodigo();
    const errado = certo === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => auth.verifyAccessCode(TELEFONE, errado));
    }

    // Mesmo acertando depois, o desafio já foi invalidado
    await assert.rejects(
      () => auth.verifyAccessCode(TELEFONE, certo),
      auth.TooManyRequestsError
    );
  });

  test("código expirado não entra", async () => {
    await auth.requestAccessCode(TELEFONE);
    await prisma.customerAuthChallenge.updateMany({
      where: { destination: TELEFONE },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await assert.rejects(
      () => auth.verifyAccessCode(TELEFONE, ultimoCodigo()),
      auth.InvalidCodeError
    );
  });

  test("código usado não serve duas vezes", async () => {
    await auth.requestAccessCode(TELEFONE);
    const codigo = ultimoCodigo();
    await auth.verifyAccessCode(TELEFONE, codigo);
    await assert.rejects(() => auth.verifyAccessCode(TELEFONE, codigo), auth.InvalidCodeError);
  });
});

describe("vinculação de histórico", () => {
  test("vincula as relações do telefone em todas as barbearias", async () => {
    await relacao();
    await relacao({ barbershopId: OUTRA_SHOP });

    await auth.requestAccessCode(TELEFONE);
    const { customerId, linkedRelations } = await auth.verifyAccessCode(
      TELEFONE,
      ultimoCodigo()
    );

    assert.equal(linkedRelations, 2);
    const vinculadas = await prisma.barbershopCustomer.findMany({ where: { customerId } });
    assert.equal(vinculadas.length, 2);
  });

  test("relação antiga não é herdada: número de celular é reciclado", async () => {
    const antiga = new Date();
    antiga.setMonth(antiga.getMonth() - 18);

    await relacao({ createdAt: antiga, lastVisitAt: antiga, currentName: "Dono Anterior" });

    await auth.requestAccessCode(TELEFONE);
    const { customerId, linkedRelations } = await auth.verifyAccessCode(
      TELEFONE,
      ultimoCodigo()
    );

    assert.equal(linkedRelations, 0, "histórico de 18 meses atrás não pode ser herdado");
    const vinculadas = await prisma.barbershopCustomer.findMany({ where: { customerId } });
    assert.equal(vinculadas.length, 0);
  });

  test("relação recente é vinculada normalmente", async () => {
    const recente = new Date();
    recente.setMonth(recente.getMonth() - 2);
    await relacao({ createdAt: recente, lastVisitAt: recente });

    await auth.requestAccessCode(TELEFONE);
    const { linkedRelations } = await auth.verifyAccessCode(TELEFONE, ultimoCodigo());
    assert.equal(linkedRelations, 1);
  });

  test("a barbearia continua enxergando só a própria relação", async () => {
    await relacao();
    await relacao({ barbershopId: OUTRA_SHOP });

    await auth.requestAccessCode(TELEFONE);
    await auth.verifyAccessCode(TELEFONE, ultimoCodigo());

    const daShop = await prisma.barbershopCustomer.findMany({ where: { barbershopId: SHOP } });
    assert.equal(daShop.length, 1, "vincular conta não junta o histórico das barbearias");
  });
});

describe("CRM automático", () => {
  async function comHistorico(statuses) {
    const rel = await relacao();
    let dia = 1;
    for (const status of statuses) {
      await prisma.appointment.create({
        data: {
          barbershopId: SHOP,
          barbershopCustomerId: rel.id,
          professionalId: PRO,
          serviceId: SERVICE,
          startsAt: new Date(`2027-02-${String(dia).padStart(2, "0")}T13:00:00Z`),
          endsAt: new Date(`2027-02-${String(dia).padStart(2, "0")}T13:30:00Z`),
          occupiesFrom: new Date(`2027-02-${String(dia).padStart(2, "0")}T13:00:00Z`),
          occupiesTo: new Date(`2027-02-${String(dia).padStart(2, "0")}T13:30:00Z`),
          status,
          priceSnapshotMinor: 5000,
          serviceNameSnapshot: "Corte",
          professionalNameSnapshot: "Matheus",
          customerNameSnapshot: "João",
          customerPhoneSnapshot: TELEFONE,
          managementTokenHash: `hash-${randomUUID()}`,
        },
      });
      dia += 14;
    }
    return rel;
  }

  test("atendimento concluído alimenta os indicadores", async () => {
    const rel = await comHistorico(["COMPLETED", "COMPLETED", "COMPLETED"]);
    await recomputeCustomerCrm({ barbershopCustomerId: rel.id });

    const atualizada = await prisma.barbershopCustomer.findUniqueOrThrow({ where: { id: rel.id } });
    assert.equal(atualizada.completedVisitsCount, 3);
    assert.equal(atualizada.totalSpentMinor, 15000);
    assert.equal(atualizada.averageTicketMinor, 5000);
    assert.equal(atualizada.averageReturnDays, 14);
    assert.equal(atualizada.preferredProfessionalId, PRO);
  });

  test("cancelamento e falta não viram receita", async () => {
    const rel = await comHistorico(["COMPLETED", "CANCELLED_BY_CUSTOMER", "NO_SHOW"]);
    await recomputeCustomerCrm({ barbershopCustomerId: rel.id });

    const atualizada = await prisma.barbershopCustomer.findUniqueOrThrow({ where: { id: rel.id } });
    assert.equal(atualizada.totalSpentMinor, 5000);
    assert.equal(atualizada.completedVisitsCount, 1);
    assert.equal(atualizada.cancelledCount, 1);
    assert.equal(atualizada.noShowCount, 1);
  });

  test("uma visita só não gera frequência inventada", async () => {
    const rel = await comHistorico(["COMPLETED"]);
    await recomputeCustomerCrm({ barbershopCustomerId: rel.id });

    const atualizada = await prisma.barbershopCustomer.findUniqueOrThrow({ where: { id: rel.id } });
    assert.equal(atualizada.completedVisitsCount, 1);
    assert.equal(atualizada.averageReturnDays, null, "sem dois atendimentos não há frequência");
    assert.equal(atualizada.preferredProfessionalId, null);
  });

  test("reprocessar o mesmo evento dá o mesmo resultado", async () => {
    const rel = await comHistorico(["COMPLETED", "COMPLETED"]);

    await recomputeCustomerCrm({ barbershopCustomerId: rel.id });
    const primeira = await prisma.barbershopCustomer.findUniqueOrThrow({ where: { id: rel.id } });

    await recomputeCustomerCrm({ barbershopCustomerId: rel.id });
    const segunda = await prisma.barbershopCustomer.findUniqueOrThrow({ where: { id: rel.id } });

    assert.equal(primeira.totalSpentMinor, segunda.totalSpentMinor);
    assert.equal(primeira.completedVisitsCount, segunda.completedVisitsCount);
    assert.deepEqual(primeira.lastVisitAt, segunda.lastVisitAt);
  });

  test("relação apagada antes do processamento não quebra o worker", async () => {
    const rel = await relacao();
    await prisma.barbershopCustomer.delete({ where: { id: rel.id } });
    await recomputeCustomerCrm({ barbershopCustomerId: rel.id });
  });

  test("o snapshot é o que vale: reajuste de preço não reescreve o histórico", async () => {
    const rel = await comHistorico(["COMPLETED"]);
    await prisma.service.update({ where: { id: SERVICE }, data: { priceMinor: 20000 } });

    await recomputeCustomerCrm({ barbershopCustomerId: rel.id });
    const atualizada = await prisma.barbershopCustomer.findUniqueOrThrow({ where: { id: rel.id } });
    assert.equal(atualizada.totalSpentMinor, 5000);

    await prisma.service.update({ where: { id: SERVICE }, data: { priceMinor: 5000 } });
  });
});

describe("encerramento de conta", () => {
  test("anonimiza a identificação e preserva o histórico operacional", async () => {
    const rel = await relacao();
    await prisma.appointment.create({
      data: {
        barbershopId: SHOP,
        barbershopCustomerId: rel.id,
        professionalId: PRO,
        serviceId: SERVICE,
        startsAt: new Date("2027-02-01T13:00:00Z"),
        endsAt: new Date("2027-02-01T13:30:00Z"),
        occupiesFrom: new Date("2027-02-01T13:00:00Z"),
        occupiesTo: new Date("2027-02-01T13:30:00Z"),
        status: "COMPLETED",
        priceSnapshotMinor: 5000,
        serviceNameSnapshot: "Corte",
        professionalNameSnapshot: "Matheus",
        customerNameSnapshot: "João",
        customerPhoneSnapshot: TELEFONE,
        managementTokenHash: `hash-${randomUUID()}`,
      },
    });

    await auth.requestAccessCode(TELEFONE);
    const { customerId } = await auth.verifyAccessCode(TELEFONE, ultimoCodigo());

    await auth.closeCustomerAccount(customerId);

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    assert.equal(customer.accountStatus, "ANONYMIZED");
    assert.equal(customer.normalizedPhone, null);
    assert.ok(customer.anonymizedAt);

    // A barbearia mantém o atendimento realizado, sem identificar a pessoa
    const relacaoDepois = await prisma.barbershopCustomer.findUniqueOrThrow({
      where: { id: rel.id },
    });
    assert.equal(relacaoDepois.currentName, "Cliente removido");
    assert.notEqual(relacaoDepois.normalizedPhone, TELEFONE);
    assert.equal(relacaoDepois.customerId, null);

    const atendimentos = await prisma.appointment.count({
      where: { barbershopCustomerId: rel.id, status: "COMPLETED" },
    });
    assert.equal(atendimentos, 1, "o histórico operacional da barbearia é preservado");
  });

  test("as sessões do cliente são revogadas", async () => {
    await relacao();
    await auth.requestAccessCode(TELEFONE);
    const { customerId } = await auth.verifyAccessCode(TELEFONE, ultimoCodigo());

    await prisma.customerSession.create({
      data: {
        customerId,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 864e5),
      },
    });

    await auth.closeCustomerAccount(customerId);

    const ativas = await prisma.customerSession.count({
      where: { customerId, revokedAt: null },
    });
    assert.equal(ativas, 0);
  });
});
