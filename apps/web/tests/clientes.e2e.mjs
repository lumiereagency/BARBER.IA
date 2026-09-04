// Marco visual seguinte à Parte 4, gap G2: tela Clientes (CRM da equipe).
//
// O que estes testes existem para provar:
//  - a tela lê o CRM automático do Marco 4, não inventa nada;
//  - busca e filtro "já voltaram" funcionam;
//  - nota é editável por quem tem customers.write e persiste de verdade;
//  - consentimento aparece como informação, nunca como algo que a equipe concede;
//  - a ação de WhatsApp é sempre um link manual, nunca um envio automático.

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
const EMAIL = `clientes-${sufixo}@teste.com`;
const SENHA = "senha-bem-longa-1";
const NOME_BARBEARIA = `Barbearia Clientes ${sufixo}`;

let browser;
let page;
let barbershopId;
let anaId;
const problemas = [];

async function visivel(locator, timeout = 15000) {
  await locator.first().waitFor({ state: "visible", timeout });
  return true;
}

before(async () => {
  browser = await chromium.launch(launchOptions);
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => problemas.push(String(error)));
  page.on("console", (m) => {
    if (m.type() === "error" && !RUIDO_DO_ROTEADOR.test(m.text())) problemas.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 500) problemas.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(`${BASE_URL}/criar-conta`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Nome da barbearia" }).fill(NOME_BARBEARIA);
  await page.getByRole("textbox", { name: "Seu nome" }).fill("Dono");
  await page.getByRole("textbox", { name: "Seu e-mail" }).fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: /Criar minha barbearia/ }).click();
  await page.waitForURL(/\/hoje$/, { timeout: 20000 });

  const { prisma } = await import("@barber/db");
  const shop = await prisma.barbershop.findFirstOrThrow({ where: { name: NOME_BARBEARIA } });
  barbershopId = shop.id;

  // O CRM é materializado pelo worker (Marco 4) — já provado em
  // packages/domain/tests/crm.test.mjs. Aqui semeamos o resultado direto,
  // porque o que esta tela precisa provar é que ela LÊ certo, não que o
  // cálculo está certo.
  const ana = await prisma.barbershopCustomer.create({
    data: {
      barbershopId,
      normalizedPhone: "+5511988887777",
      currentName: "Ana Beatriz Souza",
      firstVisitAt: new Date("2026-01-10T13:00:00Z"),
      lastVisitAt: new Date("2026-08-20T13:00:00Z"),
      completedVisitsCount: 3,
      cancelledCount: 1,
      noShowCount: 0,
      totalSpentMinor: 24000,
      averageTicketMinor: 8000,
      averageReturnDays: 45,
      notes: "Prefere corte social, sem máquina zero.",
      tags: ["vip"],
    },
  });
  anaId = ana.id;
  await prisma.consent.create({
    data: {
      barbershopId,
      barbershopCustomerId: ana.id,
      channel: "WHATSAPP",
      purpose: "MARKETING",
      status: "GRANTED",
      textVersion: "dev-0",
      source: "public_booking",
    },
  });

  await prisma.barbershopCustomer.create({
    data: {
      barbershopId,
      normalizedPhone: "+5511977776666",
      currentName: "Bruno Lima",
      completedVisitsCount: 0,
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

describe("lista de clientes", () => {
  test("o menu leva à lista, com os dois clientes", async () => {
    await page.goto(`${BASE_URL}/hoje`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Clientes" }).click();
    await page.waitForURL(/\/clientes$/, { timeout: 15000 });

    await visivel(page.getByRole("heading", { name: "Clientes" }));
    await visivel(page.getByText("Ana Beatriz Souza"));
    await visivel(page.getByText("Bruno Lima"));
  });

  test("quem já voltou aparece marcado, quem não voltou não", async () => {
    const linhaAna = page.locator("a", { hasText: "Ana Beatriz Souza" });
    const linhaBruno = page.locator("a", { hasText: "Bruno Lima" });
    assert.match(await linhaAna.innerText(), /Retorna/);
    assert.match(await linhaBruno.innerText(), /1ª visita/);
  });

  test("busca filtra por nome", async () => {
    await page.getByRole("searchbox", { name: "Buscar cliente por nome ou telefone" }).fill("Ana Beatriz");
    await page.waitForURL(/q=/, { timeout: 15000 });
    await visivel(page.getByText("Ana Beatriz Souza"));
    assert.equal(await page.getByText("Bruno Lima").count(), 0);
  });

  test('filtro "já voltaram" mostra só quem tem retorno', async () => {
    await page.goto(`${BASE_URL}/clientes`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Já voltaram" }).click();
    await page.waitForURL(/retorno=1/, { timeout: 15000 });
    await visivel(page.getByText("Ana Beatriz Souza"));
    assert.equal(await page.getByText("Bruno Lima").count(), 0);
  });
});

describe("perfil do cliente", () => {
  test("mostra os indicadores do CRM automático", async () => {
    await page.goto(`${BASE_URL}/clientes/${anaId}`, { waitUntil: "networkidle" });

    await visivel(page.getByRole("heading", { name: "Ana Beatriz Souza" }));
    const texto = await page.locator("body").innerText();
    assert.match(texto, /R\$\s?240,00/, "total gasto");
    assert.match(texto, /R\$\s?80,00/, "ticket médio");
    assert.match(texto, /45 dias/, "frequência média");
    assert.match(texto, /\bvip\b/, "tag");
  });

  test("consentimento aparece como informação, não como controle da equipe", async () => {
    const texto = await page.locator("body").innerText();
    assert.match(texto, /Marketing por WhatsApp/);
    assert.match(texto, /Concedido/);
    assert.match(
      texto,
      /Só o cliente concede ou revoga/,
      "a tela precisa deixar claro que a equipe não concede consentimento"
    );
  });

  test("cliente sem consentimento mostra estado vazio, não erro", async () => {
    await page.goto(`${BASE_URL}/clientes`, { waitUntil: "networkidle" });
    await page.getByText("Bruno Lima").click();
    await page.waitForURL(/\/clientes\/.+/, { timeout: 15000 });
    await visivel(page.getByText("Nenhum consentimento registrado"));
  });

  test("o botão de WhatsApp é um link manual para o número do cliente", async () => {
    await page.goto(`${BASE_URL}/clientes/${anaId}`, { waitUntil: "networkidle" });
    const link = page.getByRole("link", { name: /Abrir WhatsApp/ });
    await visivel(link);
    const href = await link.getAttribute("href");
    assert.match(href, /^https:\/\/wa\.me\/5511988887777$/);
    assert.equal(await link.getAttribute("target"), "_blank");
  });

  test("a nota é editável e persiste de verdade", async () => {
    const area = page.getByPlaceholder(/Preferências, observações/);
    await visivel(area);
    assert.equal(await area.inputValue(), "Prefere corte social, sem máquina zero.");

    await area.fill("Prefere corte social. Alérgico a determinado produto.");
    await page.getByRole("button", { name: "Salvar nota" }).click();
    await page.waitForTimeout(1500);

    await page.reload({ waitUntil: "networkidle" });
    assert.equal(
      await page.getByPlaceholder(/Preferências, observações/).inputValue(),
      "Prefere corte social. Alérgico a determinado produto."
    );
  });

  test("nenhum erro de javascript nem de servidor no caminho todo", () => {
    assert.deepEqual(problemas, [], problemas.join("\n"));
  });
});
