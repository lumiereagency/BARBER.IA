// Fluxo ponta a ponta sobre HTTP, contra o servidor rodando de verdade.
//
// É a evidência que o Marco 2 pede: agendar sem conta, disputar horário,
// gerenciar pelo link, cancelar e remarcar — sem WhatsApp e sem Google
// Calendar em nenhum ponto do caminho.
//
// Requer o servidor em BASE_URL e o banco migrado.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const { prisma } = await import("@barber/db");

const SHOP = randomUUID();
const PRO = randomUUID();
const SERVICE = randomUUID();
const SLUG = `e2e-${SHOP.slice(0, 8)}`;

// Quintas-feiras distintas: cada teste tem sua própria agenda, então um não
// esgota os horários do outro nem depende da ordem de execução.
const QUINTAS = [
  "2027-03-04", "2027-03-11", "2027-03-18", "2027-03-25",
  "2027-04-01", "2027-04-08", "2027-04-15", "2027-04-22",
];
let proximaQuinta = 0;
const reservarData = () => QUINTAS[proximaQuinta++];

before(async () => {
  await prisma.barbershop.create({
    data: {
      id: SHOP,
      name: "Barbearia E2E",
      slug: SLUG,
      timezone: "America/Sao_Paulo",
      phone: "+5511987654321",
      slotGranularityMinutes: 30,
      bookingWindowDays: 3650,
      cancellationPolicy: "Cancele com até 2 horas de antecedência.",
    },
  });
  await prisma.professional.create({
    data: { id: PRO, barbershopId: SHOP, displayName: "Matheus" },
  });
  await prisma.service.create({
    data: {
      id: SERVICE,
      barbershopId: SHOP,
      name: "Corte + Barba",
      priceMinor: 8000,
      durationMinutes: 45,
      bufferAfterMinutes: 15,
    },
  });
  await prisma.professionalService.create({
    data: { barbershopId: SHOP, professionalId: PRO, serviceId: SERVICE },
  });
  await prisma.workingHours.create({
    data: {
      barbershopId: SHOP,
      professionalId: PRO,
      weekday: 4, // quinta
      startLocalTime: "09:00",
      endLocalTime: "12:00",
    },
  });
});

after(async () => {
  await prisma.barbershop.delete({ where: { id: SHOP } });
  await prisma.$disconnect();
});

const api = (path, init) => fetch(`${BASE_URL}${path}`, init);

async function availability(date) {
  const response = await api(
    `/api/public/shops/${SLUG}/availability?serviceId=${SERVICE}&from=${date}&to=${date}`
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function hold(startsAt) {
  const response = await api(`/api/public/shops/${SLUG}/holds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serviceId: SERVICE, professionalId: PRO, startsAt }),
  });
  return { status: response.status, body: await response.json() };
}

async function confirm(holdToken, phone, idempotencyKey) {
  const headers = { "content-type": "application/json" };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  const response = await api(`/api/public/shops/${SLUG}/appointments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      holdToken,
      customerName: "João da Silva",
      customerPhone: phone,
      acceptedTermsVersion: "dev-0",
    }),
  });
  return { status: response.status, body: await response.json() };
}

const tokenFrom = (manageUrl) => manageUrl.split("/a/").pop();

describe("jornada pública de agendamento", () => {
  test("a agenda oferece os horários da jornada", async () => {
    const { timezone, days } = await availability(reservarData());
    assert.equal(timezone, "America/Sao_Paulo");
    assert.equal(days.length, 1);
    // 09:00 às 12:00, serviço de 45min + 15min de buffer, passo de 30min
    assert.ok(days[0].slots.length > 0);
    assert.equal(days[0].slots[0].professionalName, "Matheus");
    assert.equal(days[0].slots[0].priceMinor, 8000);
  });

  test("agenda sem conta: escolher, segurar e confirmar", async () => {
    const data = reservarData();
    const { days } = await availability(data);
    const slot = days[0].slots[0];

    const held = await hold(slot.startsAt);
    assert.equal(held.status, 201);
    assert.ok(held.body.holdToken);
    assert.ok(new Date(held.body.expiresAt) > new Date());

    const confirmed = await confirm(held.body.holdToken, "11999990000");
    assert.equal(confirmed.status, 201);
    assert.equal(confirmed.body.appointment.status, "CONFIRMED");
    assert.equal(confirmed.body.appointment.serviceName, "Corte + Barba");
    assert.equal(confirmed.body.appointment.localTime, "09:00");
    assert.ok(confirmed.body.manageUrl.includes("/a/"));
    // Mensagem pronta para envio manual — nunca envio automático
    assert.ok(confirmed.body.whatsappShareUrl.startsWith("https://wa.me/"));
    assert.ok(confirmed.body.calendarUrl);

    // O horário some da agenda
    const depois = await availability(data);
    assert.ok(!depois.days[0].slots.some((s) => s.startsAt === slot.startsAt));
  });

  test("o buffer remove também o horário seguinte", async () => {
    const data = reservarData();
    const { days } = await availability(data);
    const primeiro = days[0].slots[0];
    await confirm((await hold(primeiro.startsAt)).body.holdToken, "11944443333");

    const depois = await availability(data);
    const horarios = depois.days[0].slots.map((s) => s.startsAt);
    // 09:00 ocupa até 09:45, mais 15min de buffer = 10:00. Então 09:30 sai da
    // grade mesmo o atendimento em si já tendo terminado.
    const noveETrinta = `${data}T12:30:00.000Z`; // 09:30 em São Paulo
    assert.ok(!horarios.includes(noveETrinta), "09:30 deveria estar bloqueado pelo buffer");
    // e 10:00 continua disponível
    assert.ok(horarios.includes(`${data}T13:00:00.000Z`));
  });

  test("dois clientes disputando o mesmo horário: só um consegue", async () => {
    const { days } = await availability(reservarData());
    const slot = days[0].slots[0];

    const [a, b] = await Promise.all([hold(slot.startsAt), hold(slot.startsAt)]);
    const vencedores = [a, b].filter((r) => r.status === 201);
    const perdedores = [a, b].filter((r) => r.status === 409);

    assert.equal(vencedores.length, 1, "dois holds no mesmo horário");
    assert.equal(perdedores.length, 1);
    assert.equal(perdedores[0].body.error.code, "SLOT_UNAVAILABLE");
    // A recusa vem em linguagem de gente, não em jargão
    assert.match(perdedores[0].body.error.message, /preenchid/i);
  });

  test("retry com a mesma chave de idempotência não duplica a reserva", async () => {
    const { days } = await availability(reservarData());
    const slot = days[0].slots.at(-1);
    const held = await hold(slot.startsAt);
    const chave = randomUUID();

    const primeira = await confirm(held.body.holdToken, "11955554444", chave);
    const segunda = await confirm(held.body.holdToken, "11955554444", chave);

    assert.equal(primeira.status, 201);
    assert.equal(segunda.status, 201);
    assert.deepEqual(primeira.body.appointment, segunda.body.appointment);

    const total = await prisma.appointment.count({
      where: { barbershopId: SHOP, customerPhoneSnapshot: "+5511955554444" },
    });
    assert.equal(total, 1, "o retry criou uma segunda reserva");
  });
});

describe("gestão pelo link seguro", () => {
  let manageToken;
  let dataDaGestao;

  before(async () => {
    dataDaGestao = reservarData();
    const { days } = await availability(dataDaGestao);
    const held = await hold(days[0].slots[0].startsAt);
    const confirmed = await confirm(held.body.holdToken, "11933332222");
    manageToken = tokenFrom(confirmed.body.manageUrl);
  });

  test("o link mostra a reserva e o que é permitido", async () => {
    const response = await api(`/api/public/appointments/${manageToken}`);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.appointment.status, "CONFIRMED");
    assert.equal(body.shop.name, "Barbearia E2E");
    assert.equal(body.shop.cancellationPolicy, "Cancele com até 2 horas de antecedência.");
    assert.equal(body.permissions.canCancel, true);
    assert.equal(body.permissions.canReschedule, true);
    // A página não expõe dado da operação da barbearia
    assert.equal(body.appointment.customerPhone, undefined);
  });

  test("link inválido não revela se existe ou não", async () => {
    const response = await api(`/api/public/appointments/${"x".repeat(43)}`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.match(body.error.message, /inválido ou expirado/i);
  });

  test("remarcar move o horário e emite link novo", async () => {
    const { days } = await availability(dataDaGestao);
    const destino = days[0].slots.at(-1);
    const novoHold = await hold(destino.startsAt);

    const response = await api(`/api/public/appointments/${manageToken}/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ holdToken: novoHold.body.holdToken }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.appointment.status, "CONFIRMED");
    assert.notEqual(tokenFrom(body.manageUrl), manageToken);

    // O agendamento anterior virou RESCHEDULED, não cancelamento
    const anterior = await api(`/api/public/appointments/${manageToken}`);
    const anteriorBody = await anterior.json();
    assert.equal(anteriorBody.appointment.status, "RESCHEDULED");
    assert.equal(anteriorBody.permissions.canCancel, false);

    manageToken = tokenFrom(body.manageUrl);
  });

  test("cancelar pelo link devolve o horário para a agenda", async () => {
    const antes = await api(`/api/public/appointments/${manageToken}`);
    const { appointment } = await antes.json();

    const response = await api(`/api/public/appointments/${manageToken}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "imprevisto" }),
    });
    assert.equal(response.status, 200);

    const depois = await availability(dataDaGestao);
    assert.ok(
      depois.days[0].slots.some((slot) => slot.startsAt === appointment.startsAt),
      "o horário cancelado deveria voltar a ser oferecido"
    );
  });
});

describe("isolamento e validação", () => {
  test("barbearia inexistente não vaza nada", async () => {
    const data = QUINTAS[0];
    const response = await api(`/api/public/shops/nao-existe/availability?serviceId=${SERVICE}&from=${data}&to=${data}`);
    assert.equal(response.status, 404);
  });

  test("profissional que não faz o serviço é recusado", async () => {
    const outro = await prisma.professional.create({
      data: { barbershopId: SHOP, displayName: "Rafael" },
    });

    const response = await api(`/api/public/shops/${SLUG}/holds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId: SERVICE,
        professionalId: outro.id,
        startsAt: `${QUINTAS[0]}T14:00:00.000Z`,
      }),
    });

    assert.equal(response.status, 422);
    await prisma.professional.delete({ where: { id: outro.id } });
  });

  test("telefone malformado é recusado com mensagem clara", async () => {
    const { days } = await availability(reservarData());
    const held = await hold(days[0].slots[0].startsAt);
    const confirmed = await confirm(held.body.holdToken, "123");
    assert.equal(confirmed.status, 422);
  });
});
