// Marco 5 — integrações resilientes.
//
// O que estes testes existem para provar, na letra da Parte 3 §8 e §11:
//  - "integração externa pode falhar sem corromper reservas";
//  - "falha não desfaz nem duplica reserva";
//  - "status e erro acionável aparecem no painel";
//  - "retentativas têm limite";
//  - "reconexão não duplica eventos/mensagens".
//
// A cadeia inteira é exercitada de verdade: reserva gravada pelo caminho real
// de agendamento, evento saindo pelo outbox, worker processando, e um provedor
// falso no lugar do Google — falso apenas para poder falhar sob comando, com a
// mesma interface e os mesmos erros que o provedor real levanta.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.TOKEN_HMAC_SECRET ??= "test-only-secret";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { prisma } = await import("@barber/db");
const {
  CalendarError,
  setCalendarProvider,
  writeCredentials,
  reconcileCalendar,
} = await import("@barber/integrations");
const booking = await import("../../web/lib/booking.ts");
const worker = await import("../index.ts");

const SHOP = randomUUID();
const PRO = randomUUID();
const PRO_SEM_CONEXAO = randomUUID();
const SERVICE = randomUUID();

const base = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const minutes = (n) => new Date(base.getTime() + n * 60000);

// --- Provedor falso ---------------------------------------------------------

/// Guarda o que "existe no Google" e permite programar a próxima falha.
class FakeCalendar {
  constructor() {
    this.name = "fake";
    this.eventos = new Map(); // id -> resumo
    this.chamadas = [];
    this.falha = null;
    this.proximoId = 0;
    this.refreshes = 0;
  }

  /// A próxima operação levanta este erro; `vezes` limita quantas.
  programarFalha(code, vezes = Infinity) {
    this.falha = { code, restantes: vezes };
  }

  async refreshCredentials() {
    this.refreshes++;
    return null; // credencial ainda válida: nada a renovar
  }

  async upsertEvent(_credentials, input) {
    this.chamadas.push({ op: input.externalEventId ? "patch" : "post", id: input.externalEventId });
    this.#dispararFalhaSeProgramada();

    // PATCH em evento que não existe mais: o provedor real cai no create
    if (input.externalEventId && !this.eventos.has(input.externalEventId)) {
      const novo = `evt-${++this.proximoId}`;
      this.eventos.set(novo, input.summary);
      return novo;
    }

    const id = input.externalEventId ?? `evt-${++this.proximoId}`;
    this.eventos.set(id, input.summary);
    return id;
  }

  async deleteEvent(_credentials, externalEventId) {
    this.chamadas.push({ op: "delete", id: externalEventId });
    this.#dispararFalhaSeProgramada();
    this.eventos.delete(externalEventId);
  }

  #dispararFalhaSeProgramada() {
    if (!this.falha) return;
    const { code } = this.falha;
    this.falha.restantes -= 1;
    if (this.falha.restantes <= 0) this.falha = null;
    throw new CalendarError("falha programada pelo teste", code);
  }
}

let google;

// --- Fixtures ---------------------------------------------------------------

async function conectar(overrides = {}) {
  return prisma.integrationConnection.create({
    data: {
      barbershopId: SHOP,
      professionalId: PRO,
      provider: "GOOGLE_CALENDAR",
      status: "CONNECTED",
      externalAccount: "matheus@exemplo.com",
      credentialsEncrypted: writeCredentials({
        accessToken: "token-de-acesso",
        refreshToken: "token-de-renovacao",
        expiresAt: new Date(Date.now() + 3600_000),
      }),
      ...overrides,
    },
  });
}

async function agendar(offset = 0, professionalId = PRO) {
  const { holdToken } = await booking.createHold({
    barbershopId: SHOP,
    professionalId,
    serviceId: SERVICE,
    startsAt: minutes(offset),
    endsAt: minutes(offset + 45),
    occupiesFrom: minutes(offset),
    occupiesTo: minutes(offset + 45),
    holdDurationMinutes: 5,
  });

  return booking.confirmAppointment({
    barbershopId: SHOP,
    holdToken,
    customerName: "João",
    customerPhone: `1199999${String(1000 + Math.floor(Math.random() * 8999))}`,
    acceptedTermsVersion: "dev-0",
  });
}

/// Processa a fila até esvaziar, liberando o backoff entre as rodadas para não
/// esperar minutos de relógio. O limite existe para o teste não girar sem fim.
async function drenarFila(rodadas = 10) {
  let total = { processados: 0, falhas: 0 };
  for (let i = 0; i < rodadas; i++) {
    const pendentes = await prisma.outboxEvent.count({
      where: { barbershopId: SHOP, status: "PENDING" },
    });
    if (pendentes === 0) break;
    await prisma.outboxEvent.updateMany({
      where: { barbershopId: SHOP, status: "PENDING" },
      data: { availableAt: new Date() },
    });
    const { processados, falhas } = await worker.processBatch();
    total = { processados: total.processados + processados, falhas: total.falhas + falhas };
  }
  return total;
}

async function syncsDe(appointmentId) {
  return prisma.appointmentCalendarSync.findMany({ where: { appointmentId } });
}

before(async () => {
  await prisma.barbershop.create({
    data: {
      id: SHOP,
      name: "Barbearia Integração",
      slug: `integra-${SHOP.slice(0, 8)}`,
      timezone: "America/Sao_Paulo",
      cancellationNoticeMinutes: 0,
    },
  });
  await prisma.professional.createMany({
    data: [
      { id: PRO, barbershopId: SHOP, displayName: "Matheus" },
      { id: PRO_SEM_CONEXAO, barbershopId: SHOP, displayName: "Rafael" },
    ],
  });
  await prisma.service.create({
    data: {
      id: SERVICE,
      barbershopId: SHOP,
      name: "Corte",
      priceMinor: 5000,
      durationMinutes: 45,
    },
  });
});

after(async () => {
  setCalendarProvider(null);
  await prisma.barbershop.delete({ where: { id: SHOP } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  google = new FakeCalendar();
  setCalendarProvider(google);
  await prisma.outboxEvent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointmentCalendarSync.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointmentHold.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointmentEvent.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.appointment.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.integrationConnection.deleteMany({ where: { barbershopId: SHOP } });
  await prisma.barbershopCustomer.deleteMany({ where: { barbershopId: SHOP } });
});

// --- Caminho feliz ----------------------------------------------------------

describe("projeção no calendário", () => {
  test("confirmar cria o evento e registra a projeção", async () => {
    await conectar();
    const { appointmentId } = await agendar();

    await drenarFila();

    assert.equal(google.eventos.size, 1);
    const [registro] = await syncsDe(appointmentId);
    assert.equal(registro.status, "SYNCED");
    assert.ok(registro.externalEventId);
    assert.ok(registro.lastSyncedAt);
  });

  test("encaixe no balcão também vai para o calendário", async () => {
    await conectar();
    await booking.createManualAppointment({
      barbershopId: SHOP,
      professionalId: PRO,
      serviceId: SERVICE,
      startsAt: minutes(300),
      customerName: "Cliente do balcão",
      customerPhone: "11988887777",
      actorId: randomUUID(),
    });

    await drenarFila();
    assert.equal(google.eventos.size, 1);
  });

  test("cancelar remove o evento", async () => {
    await conectar();
    const { appointmentId } = await agendar();
    await drenarFila();

    await booking.cancelAppointment({ appointmentId, actorType: "CUSTOMER" });
    await drenarFila();

    assert.equal(google.eventos.size, 0);
    const [registro] = await syncsDe(appointmentId);
    assert.equal(registro.status, "DELETED");
    assert.equal(registro.externalEventId, null);
  });

  test("remarcar tira o horário antigo e põe o novo, sem deixar os dois", async () => {
    await conectar();
    const primeiro = await agendar();
    await drenarFila();
    const idAntigo = google.eventos.keys().next().value;

    const { holdToken } = await booking.createHold({
      barbershopId: SHOP,
      professionalId: PRO,
      serviceId: SERVICE,
      startsAt: minutes(120),
      endsAt: minutes(165),
      occupiesFrom: minutes(120),
      occupiesTo: minutes(165),
      holdDurationMinutes: 5,
    });
    await booking.rescheduleAppointment({
      appointmentId: primeiro.appointmentId,
      holdToken,
      actorType: "CUSTOMER",
    });

    await drenarFila();

    assert.equal(google.eventos.size, 1, "só o novo horário fica no calendário");
    assert.equal(google.eventos.has(idAntigo), false);
  });

  test("sem conexão ativa nada é sincronizado, e a reserva segue válida", async () => {
    const { appointmentId } = await agendar(0, PRO_SEM_CONEXAO);
    const { falhas } = await drenarFila();

    assert.equal(falhas, 0, "ausência de integração não é falha");
    assert.equal(google.chamadas.length, 0);
    const reserva = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    assert.equal(reserva.status, "CONFIRMED");
  });
});

// --- Idempotência e convergência --------------------------------------------

describe("entrega ao menos uma vez", () => {
  test("reprocessar o mesmo evento atualiza, não duplica", async () => {
    await conectar();
    const { appointmentId } = await agendar();
    await drenarFila();

    // Segunda entrega do mesmo efeito, que o outbox não promete evitar
    await prisma.outboxEvent.create({
      data: { barbershopId: SHOP, type: "APPOINTMENT_CONFIRMED", payload: { appointmentId } },
    });
    await drenarFila();

    assert.equal(google.eventos.size, 1);
    assert.deepEqual(
      google.chamadas.map((c) => c.op),
      ["post", "patch"],
      "a segunda passada atualiza o evento existente"
    );
  });

  test("confirmação reentregue depois do cancelamento não ressuscita o evento", async () => {
    await conectar();
    const { appointmentId } = await agendar();
    await drenarFila();

    await booking.cancelAppointment({ appointmentId, actorType: "CUSTOMER" });
    await drenarFila();
    assert.equal(google.eventos.size, 0);

    // Fora de ordem: o outbox não garante ordem entre eventos independentes
    await prisma.outboxEvent.create({
      data: { barbershopId: SHOP, type: "APPOINTMENT_CONFIRMED", payload: { appointmentId } },
    });
    await drenarFila();

    assert.equal(google.eventos.size, 0, "o estado do banco é que manda, não o nome do evento");
  });

  test("cancelamento reentregue não tenta apagar de novo", async () => {
    await conectar();
    const { appointmentId } = await agendar();
    await drenarFila();
    await booking.cancelAppointment({ appointmentId, actorType: "CUSTOMER" });
    await drenarFila();

    const antes = google.chamadas.length;
    await prisma.outboxEvent.create({
      data: { barbershopId: SHOP, type: "APPOINTMENT_CANCELLED", payload: { appointmentId } },
    });
    await drenarFila();

    assert.equal(google.chamadas.length, antes, "nada a fazer não gasta chamada de rede");
  });

  test("evento apagado à mão no Google é recriado, não duplicado", async () => {
    await conectar();
    const { appointmentId } = await agendar();
    await drenarFila();

    // O profissional apagou o compromisso direto no Google
    google.eventos.clear();

    await prisma.outboxEvent.create({
      data: { barbershopId: SHOP, type: "SYNC_CALENDAR", payload: { appointmentId } },
    });
    await drenarFila();

    assert.equal(google.eventos.size, 1);
    const [registro] = await syncsDe(appointmentId);
    assert.equal(registro.status, "SYNCED");
  });
});

// --- Falha -------------------------------------------------------------------

describe("falha externa não corrompe a reserva", () => {
  test("queda do Google deixa a reserva intacta e a integração instável", async () => {
    const conexao = await conectar();
    google.programarFalha("TRANSIENT", 1);
    const { appointmentId } = await agendar();

    await prisma.outboxEvent.updateMany({
      where: { barbershopId: SHOP, status: "PENDING" },
      data: { availableAt: new Date() },
    });
    const { falhas } = await worker.processBatch();

    assert.equal(falhas, 1);

    const reserva = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    assert.equal(reserva.status, "CONFIRMED", "a reserva não depende do Google");

    const estado = await prisma.integrationConnection.findUnique({ where: { id: conexao.id } });
    assert.equal(estado.status, "UNSTABLE");
    assert.equal(estado.lastErrorCode, "TRANSIENT");
    assert.ok(estado.lastErrorAt);

    const [registro] = await syncsDe(appointmentId);
    assert.equal(registro.status, "FAILED");
    assert.ok(registro.lastError);
  });

  test("a retentativa cria o evento uma única vez", async () => {
    await conectar();
    google.programarFalha("TRANSIENT", 1);
    const { appointmentId } = await agendar();

    await drenarFila();

    assert.equal(google.eventos.size, 1);
    const [registro] = await syncsDe(appointmentId);
    assert.equal(registro.status, "SYNCED");
  });

  test("retentativa tem limite: vira carta morta e a reserva continua de pé", async () => {
    await conectar();
    google.programarFalha("TRANSIENT");
    const { appointmentId } = await agendar();

    await drenarFila(12);

    const evento = await prisma.outboxEvent.findFirst({
      where: { barbershopId: SHOP, type: "APPOINTMENT_CONFIRMED" },
    });
    assert.equal(evento.status, "DEAD_LETTER");
    assert.equal(evento.attempts, 5, "cinco tentativas e para");

    const reserva = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    assert.equal(reserva.status, "CONFIRMED");
  });

  test("falha permanente não fica girando na fila", async () => {
    const conexao = await conectar();
    google.programarFalha("PERMANENT");
    await agendar();

    await drenarFila();

    const evento = await prisma.outboxEvent.findFirst({
      where: { barbershopId: SHOP, type: "APPOINTMENT_CONFIRMED" },
    });
    assert.equal(evento.status, "DONE", "insistir não conserta requisição inválida");
    assert.equal(evento.attempts, 1);

    const estado = await prisma.integrationConnection.findUnique({ where: { id: conexao.id } });
    assert.equal(estado.status, "ERROR");
    assert.equal(estado.lastErrorCode, "PERMANENT");
  });

  test("autorização revogada apaga a credencial e pede reconexão", async () => {
    const conexao = await conectar();
    google.programarFalha("REVOKED");
    await agendar();

    await drenarFila();

    const estado = await prisma.integrationConnection.findUnique({ where: { id: conexao.id } });
    assert.equal(estado.status, "ERROR");
    assert.equal(estado.lastErrorCode, "REVOKED");
    assert.equal(estado.credentialsEncrypted, null, "credencial inútil não fica guardada");

    const evento = await prisma.outboxEvent.findFirst({
      where: { barbershopId: SHOP, type: "APPOINTMENT_CONFIRMED" },
    });
    assert.equal(evento.status, "DONE", "retentativa não reverte revogação");
  });

  test("credencial ilegível não vaza nem insiste", async () => {
    const conexao = await conectar({ credentialsEncrypted: "v1.aaaa.bbbb.cccc" });
    await agendar();

    await drenarFila();

    const estado = await prisma.integrationConnection.findUnique({ where: { id: conexao.id } });
    assert.equal(estado.status, "ERROR");
    assert.equal(estado.lastErrorCode, "REVOKED");
    assert.equal(google.chamadas.length, 0);
  });
});

// --- Segredo em repouso ------------------------------------------------------

describe("credencial em repouso", () => {
  test("o banco não guarda o token em claro", async () => {
    const conexao = await conectar();
    const linha = await prisma.integrationConnection.findUnique({ where: { id: conexao.id } });

    assert.equal(linha.credentialsEncrypted.includes("token-de-renovacao"), false);
    assert.equal(linha.credentialsEncrypted.includes("token-de-acesso"), false);
    assert.ok(linha.credentialsEncrypted.startsWith("v1."));
  });
});

// --- Reconciliação e reconexão ----------------------------------------------

describe("reconciliação", () => {
  test("traz o que ficou para trás enquanto a integração estava desligada", async () => {
    const conexao = await conectar({ status: "DISCONNECTED", credentialsEncrypted: null });

    const { appointmentId } = await agendar();
    await drenarFila();
    assert.equal(google.eventos.size, 0, "desligada, nada sai");

    // Reconexão
    await prisma.integrationConnection.update({
      where: { id: conexao.id },
      data: {
        status: "CONNECTED",
        credentialsEncrypted: writeCredentials({
          accessToken: "novo",
          refreshToken: "novo",
          expiresAt: new Date(Date.now() + 3600_000),
        }),
      },
    });

    const reenfileirados = await reconcileCalendar();
    assert.ok(reenfileirados >= 1);
    await drenarFila();

    assert.equal(google.eventos.size, 1);
    const [registro] = await syncsDe(appointmentId);
    assert.equal(registro.status, "SYNCED");
  });

  test("não enfileira duas vezes o mesmo agendamento", async () => {
    await conectar();
    await agendar();
    await prisma.outboxEvent.deleteMany({ where: { barbershopId: SHOP } });

    assert.equal(await reconcileCalendar(), 1);
    assert.equal(await reconcileCalendar(), 0, "já há um evento pendente para ele");
  });

  test("reconexão não duplica o evento já existente no calendário", async () => {
    const conexao = await conectar();
    const { appointmentId } = await agendar();
    await drenarFila();
    const idOriginal = google.eventos.keys().next().value;

    // Desconecta e reconecta na mesma conta
    await prisma.integrationConnection.update({
      where: { id: conexao.id },
      data: { status: "DISCONNECTED", credentialsEncrypted: null, disconnectedAt: new Date() },
    });
    await prisma.integrationConnection.update({
      where: { id: conexao.id },
      data: {
        status: "CONNECTED",
        disconnectedAt: null,
        credentialsEncrypted: writeCredentials({
          accessToken: "novo",
          refreshToken: "novo",
          expiresAt: new Date(Date.now() + 3600_000),
        }),
      },
    });

    await prisma.outboxEvent.create({
      data: { barbershopId: SHOP, type: "SYNC_CALENDAR", payload: { appointmentId } },
    });
    await drenarFila();

    assert.equal(google.eventos.size, 1);
    assert.equal(google.eventos.has(idOriginal), true, "o mesmo evento foi atualizado");
  });

  test("não reenfileira agendamento de conexão sem credencial", async () => {
    await conectar({ status: "CONNECTED", credentialsEncrypted: null });
    await agendar();
    await prisma.outboxEvent.deleteMany({ where: { barbershopId: SHOP } });

    assert.equal(await reconcileCalendar(), 0);
  });
});
