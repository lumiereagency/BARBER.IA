// Marco 5 no navegador: o painel de integrações.
//
// O que precisa aparecer, pela Parte 3 §11: status e erro acionável, em
// linguagem de dono de barbearia. E, pela Parte 1 §3, a tela precisa deixar
// claro que a agenda daqui continua valendo mesmo com a integração quebrada.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

const sufixo = randomUUID().slice(0, 8);
const EMAIL = `integra-${sufixo}@teste.com`;
const SENHA = "senha-bem-longa-1";
const NOME_BARBEARIA = `Barbearia Integra ${sufixo}`;

let browser;
let page;
let barbershopId;
let professionalId;
const problemas = [];

before(async () => {
  browser = await chromium.launch(launchOptions);
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => problemas.push(String(error)));
  page.on("response", (r) => {
    if (r.status() >= 500) problemas.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(`${BASE_URL}/criar-conta`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Nome da barbearia" }).fill(NOME_BARBEARIA);
  await page.getByRole("textbox", { name: "Seu nome" }).fill("Zé Proprietário");
  await page.getByRole("textbox", { name: "Seu e-mail" }).fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: /Criar minha barbearia/ }).click();
  await page.waitForURL(/\/hoje$/, { timeout: 20000 });

  await page.goto(`${BASE_URL}/equipe`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Nome do profissional" }).fill("Matheus");
  await page.getByRole("button", { name: /Adicionar profissional/ }).click();
  await page.waitForTimeout(1000);

  const { prisma } = await import("@barber/db");
  const barbershop = await prisma.barbershop.findFirstOrThrow({
    where: { name: NOME_BARBEARIA },
  });
  barbershopId = barbershop.id;
  professionalId = (
    await prisma.professional.findFirstOrThrow({ where: { barbershopId } })
  ).id;
  await prisma.$disconnect();
});

after(async () => {
  await browser?.close();
  const { prisma } = await import("@barber/db");
  await prisma.barbershop.deleteMany({ where: { name: NOME_BARBEARIA } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
  assert.deepEqual(problemas, [], "o painel não pode registrar erro no navegador");
});

async function estadoConexao(data) {
  const { prisma } = await import("@barber/db");
  await prisma.integrationConnection.upsert({
    where: {
      barbershopId_professionalId_provider: {
        barbershopId,
        professionalId,
        provider: "GOOGLE_CALENDAR",
      },
    },
    update: data,
    create: { barbershopId, professionalId, provider: "GOOGLE_CALENDAR", ...data },
  });
  await prisma.$disconnect();
}

describe("painel de integrações", () => {
  test("o menu leva ao painel e ele lista os profissionais", async () => {
    await page.goto(`${BASE_URL}/hoje`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Integrações" }).click();
    await page.waitForURL(/\/gestao\/integracoes$/, { timeout: 15000 });

    await page.getByRole("heading", { name: "Google Agenda" }).waitFor({ state: "visible" });
    await page.getByText("Matheus").first().waitFor({ state: "visible" });
    await page.getByText("Não conectado").first().waitFor({ state: "visible" });
  });

  test("diz que a agenda daqui continua valendo se o Google falhar", async () => {
    const texto = await page.locator("body").innerText();
    assert.match(texto, /continuam valendo aqui mesmo se o Google falhar/);
  });

  test("acesso revogado aparece como instrução, não como código de erro", async () => {
    await estadoConexao({
      status: "ERROR",
      lastErrorCode: "REVOKED",
      lastErrorAt: new Date(),
      externalAccount: "matheus@exemplo.com",
      credentialsEncrypted: null,
    });

    await page.goto(`${BASE_URL}/gestao/integracoes`, { waitUntil: "networkidle" });
    const texto = await page.locator("body").innerText();

    await page.getByText("Precisa reconectar").first().waitFor({ state: "visible" });
    assert.match(texto, /O acesso ao Google foi retirado/);
    assert.match(texto, /matheus@exemplo\.com/, "a tela diz qual conta estava conectada");
    assert.doesNotMatch(texto, /REVOKED|401|403|token/i, "sem jargão na tela");
  });

  test("instabilidade não manda o dono fazer nada", async () => {
    await estadoConexao({
      status: "UNSTABLE",
      lastErrorCode: "TRANSIENT",
      lastErrorAt: new Date(),
      lastSyncAt: new Date(),
      credentialsEncrypted: "v1.x.y.z",
    });

    await page.goto(`${BASE_URL}/gestao/integracoes`, { waitUntil: "networkidle" });
    const texto = await page.locator("body").innerText();

    await page.getByText("Instável").first().waitFor({ state: "visible" });
    assert.match(texto, /não é preciso fazer nada/);
    assert.match(texto, /Último envio:/);
  });

  test("desconectar volta ao estado inicial sem apagar nada do Google", async () => {
    await estadoConexao({
      status: "CONNECTED",
      lastSyncAt: new Date(),
      credentialsEncrypted: "v1.x.y.z",
      lastErrorCode: null,
    });
    await page.goto(`${BASE_URL}/gestao/integracoes`, { waitUntil: "networkidle" });
    await page.getByText("Conectado").first().waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Desconectar" }).click();
    await page.getByText("Não conectado").first().waitFor({ state: "visible", timeout: 15000 });

    const { prisma } = await import("@barber/db");
    const conexao = await prisma.integrationConnection.findFirstOrThrow({
      where: { barbershopId, professionalId },
    });
    await prisma.$disconnect();

    assert.equal(conexao.status, "DISCONNECTED");
    assert.equal(conexao.credentialsEncrypted, null, "a credencial sai do banco");
    assert.ok(conexao.disconnectedAt);
  });
});
