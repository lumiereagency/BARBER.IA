// Marco 6.8 — validação ponta a ponta da Agenda Inteligente, contra o
// servidor real: cadeia inteira, do painel da equipe até o relatório.
//
// O que este teste existe para provar:
//  - a equipe vê a vaga aberta e quem tem mais chance de querê-la;
//  - "Gerar link" produz uma URL /vaga/ que funciona de verdade — não um
//    texto qualquer;
//  - um cliente (sessão separada, sem cookie da equipe) reivindica a vaga
//    pelo link e vira agendamento real;
//  - o relatório reflete a vaga preenchida e o cliente atrasado, sem
//    depender de nenhum cálculo feito no navegador.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

const RUIDO_DO_ROTEADOR = /Failed to fetch RSC payload/;

const sufixo = randomUUID().slice(0, 8);
const EMAIL = `agenda-ia-${sufixo}@teste.com`;
const SENHA = "senha-bem-longa-1";
const NOME_BARBEARIA = `Barbearia Agenda IA ${sufixo}`;

let browser;
let staffPage;
let shopId;
let proId;
let serviceId;
const problemas = [];

function observar(page) {
  page.on("pageerror", (error) => problemas.push(String(error)));
  page.on("console", (m) => {
    if (m.type() === "error" && !RUIDO_DO_ROTEADOR.test(m.text())) problemas.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 500) problemas.push(`${r.status()} ${r.url()}`);
  });
}

async function visivel(locator, timeout = 15000) {
  await locator.first().waitFor({ state: "visible", timeout });
  return true;
}

before(async () => {
  browser = await chromium.launch(launchOptions);
  staffPage = await browser.newPage({ viewport: { width: 420, height: 1000 } });
  observar(staffPage);

  await staffPage.goto(`${BASE_URL}/criar-conta`, { waitUntil: "networkidle" });
  await staffPage.getByRole("textbox", { name: "Nome da barbearia" }).fill(NOME_BARBEARIA);
  await staffPage.getByRole("textbox", { name: "Seu nome" }).fill("Dono");
  await staffPage.getByRole("textbox", { name: "Seu e-mail" }).fill(EMAIL);
  await staffPage.getByLabel("Senha").fill(SENHA);
  await staffPage.getByRole("button", { name: /Criar minha barbearia/ }).click();
  await staffPage.waitForURL(/\/hoje$/, { timeout: 20000 });

  const { prisma } = await import("@barber/db");
  const shop = await prisma.barbershop.findFirstOrThrow({ where: { name: NOME_BARBEARIA } });
  shopId = shop.id;
  proId = randomUUID();
  serviceId = randomUUID();

  await prisma.professional.create({
    data: { id: proId, barbershopId: shopId, displayName: "Matheus" },
  });
  await prisma.service.create({
    data: { id: serviceId, barbershopId: shopId, name: "Corte", priceMinor: 5000, durationMinutes: 30 },
  });
  await prisma.professionalService.create({
    data: { barbershopId: shopId, professionalId: proId, serviceId },
  });

  // Candidato da lista de espera: mesma vaga, com propensão já calculada.
  const candidato = await prisma.barbershopCustomer.create({
    data: { barbershopId: shopId, normalizedPhone: "+5511988880000", currentName: "Ana Candidata" },
  });
  await prisma.customerReturnScore.create({
    data: {
      barbershopId: shopId,
      barbershopCustomerId: candidato.id,
      score: 55,
      reasons: [{ code: "no_momento", label: "Está no período em que costuma voltar" }],
    },
  });
  await prisma.waitlistEntry.create({
    data: {
      barbershopId: shopId,
      barbershopCustomerId: candidato.id,
      serviceId,
      professionalId: proId,
      status: "WAITING",
      rankScore: 55,
      rankReasons: [{ code: "no_momento", label: "Está no período em que costuma voltar" }],
    },
  });

  // Cliente atrasado, para o relatório mostrar algo além da vaga.
  const atrasado = await prisma.barbershopCustomer.create({
    data: { barbershopId: shopId, normalizedPhone: "+5511977770000", currentName: "Bruno Atrasado" },
  });
  await prisma.customerReturnScore.create({
    data: {
      barbershopId: shopId,
      barbershopCustomerId: atrasado.id,
      score: 60,
      reasons: [{ code: "atrasado", label: "Já passou do período que costuma voltar" }],
    },
  });

  const startsAt = new Date(Date.now() + 20 * 60 * 60 * 1000);
  await prisma.smartOpportunity.create({
    data: {
      barbershopId: shopId,
      professionalId: proId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60000),
      compatibleServiceIds: [serviceId],
      estimatedRevenueMinor: 5000,
      status: "OPEN",
      expiresAt: startsAt,
    },
  });

  await prisma.$disconnect();
});

after(async () => {
  await browser?.close();
  const { prisma } = await import("@barber/db");
  await prisma.barbershop.deleteMany({ where: { name: NOME_BARBEARIA } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

describe("painel Agenda Inteligente", () => {
  test("mostra a vaga aberta e a candidata da lista de espera", async () => {
    await staffPage.goto(`${BASE_URL}/agenda-inteligente`, { waitUntil: "networkidle" });
    await visivel(staffPage.getByText("com Matheus"));
    await visivel(staffPage.getByText("Ana Candidata"));
  });

  test("também aparece na lista de espera completa", async () => {
    const texto = await staffPage.locator("body").innerText();
    assert.match(texto, /Lista de espera/i);
    assert.match(texto, /Ana Candidata/);
  });
});

let vagaUrl;

describe("gerar e usar o link da vaga", () => {
  test("\"Gerar link\" produz uma URL /vaga/ real", async () => {
    await staffPage.getByRole("button", { name: "Gerar link para compartilhar" }).click();
    const codigo = staffPage.locator("code");
    await visivel(codigo);
    vagaUrl = (await codigo.innerText()).trim();
    assert.match(vagaUrl, /\/vaga\//);
  });

  test("um cliente, em sessão separada, reivindica a vaga pelo link", async () => {
    const contextoCliente = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const clientePage = await contextoCliente.newPage();
    observar(clientePage);

    await clientePage.goto(vagaUrl, { waitUntil: "networkidle" });
    await visivel(clientePage.getByText("Vaga disponível"));
    await visivel(clientePage.getByText("Primeiro a confirmar leva"));

    await clientePage.locator('input[autocomplete="name"]').fill("Cliente Vaga");
    await clientePage.locator('input[autocomplete="tel"]').fill("11966665555");
    await clientePage.locator('input[type="checkbox"]').check();
    await clientePage.getByRole("button", { name: "Garantir esta vaga" }).click();
    await visivel(clientePage.getByText("Vaga garantida!"), 20000);

    await contextoCliente.close();
  });
});

describe("relatório reflete a vaga preenchida", () => {
  test("mostra 1 preenchida, receita recuperada e o cliente atrasado", async () => {
    await staffPage.goto(`${BASE_URL}/relatorios`, { waitUntil: "networkidle" });
    await visivel(staffPage.getByText("Relatórios avançados"));

    const texto = await staffPage.locator("body").innerText();
    assert.match(texto, /Preenchidas\s*\n?\s*1/);
    assert.match(texto, /R\$\s?50,00/, "receita recuperada = preço real do serviço reivindicado");
    assert.match(texto, /Bruno Atrasado/);
  });
});

describe("integridade", () => {
  test("nenhum erro de javascript nem de servidor no caminho todo", () => {
    assert.deepEqual(problemas, [], problemas.join("\n"));
  });
});
