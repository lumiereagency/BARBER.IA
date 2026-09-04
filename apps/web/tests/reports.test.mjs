// Marco 6.7 — relatório avançado da Agenda Inteligente, contra Postgres real.
//
// O que estes testes existem para provar:
//  - contagens de vagas e lista de espera batem com o que foi criado;
//  - receita recuperada usa o preço REAL do agendamento reivindicado, não a
//    estimativa da detecção (as duas podem divergir quando o cliente escolhe
//    outro serviço compatível ao reivindicar, Marco 6.4);
//  - taxa de preenchimento é nula sem nenhuma vaga resolvida — nunca inventa
//    um percentual sem dado;
//  - só entram no período quem foi criado dentro da janela pedida;
//  - clientes atrasados são só quem tem o motivo "atrasado" na pontuação.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@barber/db");
const { computeSmartAgendaReport } = await import("../lib/reports.ts");

const SHOP = randomUUID();
const PRO = randomUUID();
const SERVICE = randomUUID();
const OUTRO_SERVICE = randomUUID();

const AGORA = new Date();
const diasAtras = (n) => new Date(AGORA.getTime() - n * 86_400_000);

before(async () => {
  await prisma.barbershop.create({
    data: { id: SHOP, name: "Barbearia Relatórios", slug: `rel-${SHOP.slice(0, 8)}`, timezone: "America/Sao_Paulo" },
  });
  await prisma.professional.create({ data: { id: PRO, barbershopId: SHOP, displayName: "Matheus" } });
  await prisma.service.createMany({
    data: [
      { id: SERVICE, barbershopId: SHOP, name: "Corte", priceMinor: 5000, durationMinutes: 30 },
      { id: OUTRO_SERVICE, barbershopId: SHOP, name: "Barba", priceMinor: 3000, durationMinutes: 20 },
    ],
  });
});

after(async () => {
  await prisma.barbershop.delete({ where: { id: SHOP } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.appointment.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.smartOpportunity.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.waitlistEntry.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.customerReturnScore.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.barbershopCustomer.deleteMany({ where: { barbershopId: SHOP } });
});

async function criarCliente(overrides = {}) {
  return prisma.barbershopCustomer.create({
    data: {
      barbershopId: SHOP,
      normalizedPhone: `+551199999${String(Math.floor(Math.random() * 9000) + 1000)}`,
      currentName: "Cliente Relatório",
      ...overrides,
    },
  });
}

async function criarAgendamentoReivindicado(priceMinor, serviceId = SERVICE) {
  const cliente = await criarCliente();
  const startsAt = diasAtras(-1); // futuro
  return prisma.appointment.create({
    data: {
      barbershopId: SHOP,
      barbershopCustomerId: cliente.id,
      professionalId: PRO,
      serviceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60000),
      occupiesFrom: startsAt,
      occupiesTo: new Date(startsAt.getTime() + 30 * 60000),
      status: "CONFIRMED",
      priceSnapshotMinor: priceMinor,
      serviceNameSnapshot: "Serviço",
      professionalNameSnapshot: "Matheus",
      customerNameSnapshot: cliente.currentName,
      customerPhoneSnapshot: cliente.normalizedPhone,
      source: "SMART_OPPORTUNITY",
      managementTokenHash: randomUUID(),
    },
  });
}

async function criarVaga({ status, createdAt, estimatedRevenueMinor = 5000, claimedAppointmentId = null }) {
  return prisma.smartOpportunity.create({
    data: {
      barbershopId: SHOP,
      professionalId: PRO,
      startsAt: diasAtras(-1),
      endsAt: diasAtras(-1),
      compatibleServiceIds: [SERVICE],
      estimatedRevenueMinor,
      status,
      expiresAt: diasAtras(-1),
      createdAt,
      claimedAppointmentId,
    },
  });
}

describe("computeSmartAgendaReport", () => {
  test("sem nenhuma vaga, taxa de preenchimento é nula e receita zero", async () => {
    const relatorio = await computeSmartAgendaReport(SHOP, 30);
    assert.equal(relatorio.vagas.detectadas, 0);
    assert.equal(relatorio.vagas.taxaPreenchimento, null);
    assert.equal(relatorio.vagas.receitaRecuperadaMinor, 0);
  });

  test("conta detectadas, preenchidas e expiradas, e calcula a taxa sobre as resolvidas", async () => {
    await criarVaga({ status: "OPEN", createdAt: diasAtras(1) });
    await criarVaga({ status: "EXPIRED", createdAt: diasAtras(2) });
    const agendamento = await criarAgendamentoReivindicado(5000);
    await criarVaga({
      status: "FILLED",
      createdAt: diasAtras(3),
      claimedAppointmentId: agendamento.id,
    });

    const relatorio = await computeSmartAgendaReport(SHOP, 30);
    assert.equal(relatorio.vagas.detectadas, 3);
    assert.equal(relatorio.vagas.preenchidas, 1);
    assert.equal(relatorio.vagas.expiradas, 1);
    // 1 preenchida entre 2 resolvidas (a OPEN não conta como resolvida)
    assert.equal(relatorio.vagas.taxaPreenchimento, 0.5);
  });

  test("receita recuperada usa o preço real do agendamento, não a estimativa", async () => {
    // Estimativa gravada na detecção era do serviço cancelado (Corte, 5000);
    // o cliente reivindicou com Barba (3000) — a receita real é 3000.
    const agendamento = await criarAgendamentoReivindicado(3000, OUTRO_SERVICE);
    await criarVaga({
      status: "FILLED",
      createdAt: diasAtras(1),
      estimatedRevenueMinor: 5000,
      claimedAppointmentId: agendamento.id,
    });

    const relatorio = await computeSmartAgendaReport(SHOP, 30);
    assert.equal(relatorio.vagas.receitaRecuperadaMinor, 3000);
  });

  test("vaga fora da janela pedida não entra na contagem", async () => {
    await criarVaga({ status: "EXPIRED", createdAt: diasAtras(90) });

    const relatorio = await computeSmartAgendaReport(SHOP, 30);
    assert.equal(relatorio.vagas.detectadas, 0);
  });

  test("lista de espera: esperando agora não depende do período, entradas dependem", async () => {
    const cliente = await criarCliente();
    await prisma.waitlistEntry.create({
      data: { barbershopId: SHOP, barbershopCustomerId: cliente.id, status: "WAITING", createdAt: diasAtras(90) },
    });
    await prisma.waitlistEntry.create({
      data: { barbershopId: SHOP, barbershopCustomerId: cliente.id, status: "WAITING", createdAt: diasAtras(5) },
    });

    const relatorio = await computeSmartAgendaReport(SHOP, 30);
    assert.equal(relatorio.listaEspera.esperandoAgora, 2, "ambos ainda esperam, independente de quando entraram");
    assert.equal(relatorio.listaEspera.entradasNoPeriodo, 1, "só quem entrou dentro dos 30 dias");
  });

  test("só clientes com motivo 'atrasado' aparecem na lista de atrasados", async () => {
    const noMomento = await criarCliente({ currentName: "No Momento" });
    const atrasado = await criarCliente({ currentName: "Atrasado" });
    await prisma.customerReturnScore.create({
      data: {
        barbershopId: SHOP,
        barbershopCustomerId: noMomento.id,
        score: 30,
        reasons: [{ code: "no_momento", label: "Está no período em que costuma voltar" }],
      },
    });
    await prisma.customerReturnScore.create({
      data: {
        barbershopId: SHOP,
        barbershopCustomerId: atrasado.id,
        score: 60,
        reasons: [{ code: "atrasado", label: "Já passou do período que costuma voltar" }],
      },
    });

    const relatorio = await computeSmartAgendaReport(SHOP, 30);
    assert.equal(relatorio.clientesAtrasados.length, 1);
    assert.equal(relatorio.clientesAtrasados[0].nome, "Atrasado");
  });
});
