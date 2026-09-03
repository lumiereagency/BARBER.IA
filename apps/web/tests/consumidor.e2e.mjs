// Marco 4 no navegador: do agendamento anônimo à conta do consumidor.
//
// Cobre o caminho que a Parte 1 §10 descreve — agendar sem conta, criar a conta
// depois, encontrar o próprio histórico já vinculado, e sair sem que o link de
// gestão da reserva deixe de funcionar.
//
// O código de acesso é lido do log do servidor de desenvolvimento, que é
// exatamente onde o provedor de log o escreve enquanto não há provedor de SMS.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SERVER_LOG = process.env.SERVER_LOG;
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

const sufixo = randomUUID().slice(0, 8);
const EMAIL_DONO = `dono-c-${sufixo}@teste.com`;
const NOME_BARBEARIA = `Barbearia Cliente ${sufixo}`;
// Telefone único por execução: o limite de pedidos de código é por número, e
// reaproveitá-lo faria a suíte falhar ao rodar duas vezes na mesma janela.
const SUFIXO_TELEFONE = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
const TELEFONE_E164 = `+55119${SUFIXO_TELEFONE}`;
const TELEFONE = `(11) 9${SUFIXO_TELEFONE.slice(0, 4)}-${SUFIXO_TELEFONE.slice(4)}`;
/// Telefone que nunca agendou, também único por execução pelo mesmo motivo
const SUFIXO_SEM_CADASTRO = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
const TELEFONE_SEM_CADASTRO = `(11) 9${SUFIXO_SEM_CADASTRO.slice(0, 4)}-${SUFIXO_SEM_CADASTRO.slice(4)}`;

let browser;
let page;
let slugPublico;
const problemas = [];

async function visivel(locator, timeout = 15000) {
  await locator.first().waitFor({ state: "visible", timeout });
  return true;
}

/// O provedor de desenvolvimento escreve o código no log do servidor. Em
/// produção isso não existe: lá o código sai pelo provedor de SMS.
function codigoDoLog(destino) {
  const conteudo = readFileSync(SERVER_LOG, "utf8");
  const linhas = conteudo
    .split("\n")
    .filter((linha) => linha.includes("[otp]") && linha.includes(destino));
  const ultima = linhas.at(-1);
  const match = ultima?.match(/(\d{6})\s*$/);
  assert.ok(match, `nenhum código encontrado no log para ${destino}`);
  return match[1];
}

before(async () => {
  assert.ok(SERVER_LOG, "defina SERVER_LOG apontando para a saída do servidor");

  browser = await chromium.launch(launchOptions);
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => problemas.push(String(error)));
  page.on("console", (m) => {
    if (m.type() === "error") problemas.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 500) problemas.push(`${r.status()} ${r.url()}`);
  });

  // Barbearia configurada pela interface
  await page.goto(`${BASE_URL}/criar-conta`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Nome da barbearia" }).fill(NOME_BARBEARIA);
  await page.getByRole("textbox", { name: "Seu nome" }).fill("Dono");
  await page.getByRole("textbox", { name: "Seu e-mail" }).fill(EMAIL_DONO);
  await page.getByLabel("Senha").fill("senha-bem-longa-1");
  await page.getByRole("button", { name: /Criar minha barbearia/ }).click();
  await page.waitForURL(/\/hoje$/, { timeout: 20000 });

  await page.goto(`${BASE_URL}/gestao/servicos`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Nome do serviço" }).fill("Corte");
  await page.getByRole("textbox", { name: "Preço" }).fill("50,00");
  await page.getByRole("spinbutton", { name: "Duração em minutos" }).fill("30");
  await page.getByRole("button", { name: /Adicionar serviço/ }).click();
  await page.waitForTimeout(2500);

  await page.goto(`${BASE_URL}/equipe`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Nome do profissional" }).fill("Matheus");
  await page.getByRole("button", { name: /Adicionar profissional/ }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("checkbox", { name: "Corte" }).check();
  await page.getByRole("button", { name: /Salvar serviços/ }).click();
  await page.waitForTimeout(2500);
  for (const dia of ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]) {
    await page.getByRole("checkbox", { name: dia }).check();
  }
  await page.getByRole("button", { name: /Salvar horários/ }).click();
  await page.waitForTimeout(2500);

  await page.goto(`${BASE_URL}/gestao/configuracoes`, { waitUntil: "networkidle" });
  slugPublico = (await page.getByText(/\/b\//).first().innerText()).split("/b/").pop().trim();

  // Sai da sessão da equipe: o cliente é outra pessoa
  await page.goto(`${BASE_URL}/hoje`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/\/entrar$/, { timeout: 15000 });
});

after(async () => {
  await browser?.close();
  const { prisma } = await import("@barber/db");
  await prisma.barbershop.deleteMany({ where: { name: NOME_BARBEARIA } });
  await prisma.user.deleteMany({ where: { email: EMAIL_DONO } });
  await prisma.customer.deleteMany({ where: { normalizedPhone: TELEFONE_E164 } });
  await prisma.$disconnect();
});

describe("agendar sem conta e criar conta depois", () => {
  let manageUrl;

  test("o cliente agenda sem nenhuma conta", async () => {
    await page.goto(`${BASE_URL}/b/${slugPublico}`, { waitUntil: "networkidle" });
    await page.getByText("Corte").first().click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Qualquer profissional/ }).click();
    await page.waitForTimeout(2500);

    await page.locator("button", { hasText: /^\d{2}:\d{2}/ }).first().click();
    await page.waitForTimeout(1500);
    await page.getByRole("textbox", { name: "Seu nome" }).fill("Maria Cliente");
    await page.getByRole("textbox", { name: "WhatsApp" }).fill(TELEFONE);
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: /Confirmar agendamento/ }).click();
    await page.waitForTimeout(3000);

    assert.ok(await visivel(page.getByText("Horário reservado!")));
    manageUrl = await page
      .getByRole("link", { name: /Gerenciar meu agendamento/ })
      .getAttribute("href");
  });

  test("a área do cliente exige entrar", async () => {
    await page.goto(`${BASE_URL}/minha-conta`, { waitUntil: "networkidle" });
    assert.match(page.url(), /\/entrar-cliente$/);
  });

  test("pedir o código não revela se o telefone tem cadastro", async () => {
    await page.getByRole("textbox", { name: "Seu WhatsApp" }).fill(TELEFONE_SEM_CADASTRO);
    await page.getByRole("button", { name: /Receber código/ }).click();
    await page.waitForTimeout(2500);
    // Telefone sem histórico nenhum recebe a mesma tela de código
    assert.ok(await visivel(page.getByRole("textbox", { name: /Código/ })));
  });

  test("código errado é recusado", async () => {
    await page.goto(`${BASE_URL}/entrar-cliente`, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Seu WhatsApp" }).fill(TELEFONE);
    await page.getByRole("button", { name: /Receber código/ }).click();
    await page.waitForTimeout(2500);

    const correto = codigoDoLog(TELEFONE_E164);
    const errado = correto === "000000" ? "111111" : "000000";
    await page.getByRole("textbox", { name: /Código/ }).fill(errado);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForTimeout(2500);

    assert.ok(await visivel(page.getByText(/Código inválido ou expirado/)));
  });

  test("código correto entra e o histórico já vem vinculado", async () => {
    await page.goto(`${BASE_URL}/entrar-cliente`, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Seu WhatsApp" }).fill(TELEFONE);
    await page.getByRole("button", { name: /Receber código/ }).click();
    await page.waitForTimeout(2500);

    await page.getByRole("textbox", { name: /Código/ }).fill(codigoDoLog(TELEFONE_E164));
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/minha-conta$/, { timeout: 20000 });

    assert.ok(await visivel(page.getByText(/Olá, Maria/)));
    // A reserva feita antes da conta aparece aqui
    assert.ok(await visivel(page.getByText("Corte")));
    assert.ok(await visivel(page.getByText(NOME_BARBEARIA)));
  });

  test("o link de gestão continua funcionando depois da conta", async () => {
    await page.goto(manageUrl, { waitUntil: "networkidle" });
    assert.ok(await visivel(page.getByText("Confirmado")));
  });
});

describe("preferências e privacidade", () => {
  test("promoção é escolha por barbearia, começando desligada", async () => {
    await page.goto(`${BASE_URL}/minha-conta/preferencias`, { waitUntil: "networkidle" });
    assert.ok(await visivel(page.getByText(NOME_BARBEARIA)));

    const whatsapp = page.getByRole("checkbox", { name: /promoções por WhatsApp/ });
    assert.equal(await whatsapp.isChecked(), false, "marketing nunca vem ligado por padrão");
  });

  test("aceitar e salvar registra o consentimento", async () => {
    await page.getByRole("checkbox", { name: /promoções por WhatsApp/ }).check();
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForTimeout(2500);

    await page.reload({ waitUntil: "networkidle" });
    assert.equal(
      await page.getByRole("checkbox", { name: /promoções por WhatsApp/ }).isChecked(),
      true
    );

    const { prisma } = await import("@barber/db");
    const consentimento = await prisma.consent.findFirst({
      where: { purpose: "MARKETING", status: "GRANTED", channel: "WHATSAPP" },
      orderBy: { capturedAt: "desc" },
    });
    assert.ok(consentimento.textVersion, "a versão do texto aceito precisa ficar registrada");
    await prisma.$disconnect();
  });

  test("revogar mantém o registro da revogação", async () => {
    await page.getByRole("checkbox", { name: /promoções por WhatsApp/ }).uncheck();
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForTimeout(2500);

    const { prisma } = await import("@barber/db");
    const revogado = await prisma.consent.findFirst({
      where: { purpose: "MARKETING", status: "REVOKED", channel: "WHATSAPP" },
      orderBy: { capturedAt: "desc" },
    });
    assert.ok(revogado?.revokedAt, "a revogação precisa ficar datada, não apagada");
    await prisma.$disconnect();
  });

  test("encerrar conta pede confirmação e diz o que acontece", async () => {
    await page.getByRole("button", { name: "Encerrar minha conta" }).click();
    assert.ok(await visivel(page.getByText(/não pode ser desfeito/)));
    assert.ok(await visivel(page.getByRole("button", { name: /Manter conta/ })));
    await page.getByRole("button", { name: /Manter conta/ }).click();
  });
});

describe("histórico e agendar de novo", () => {
  test("o histórico mostra o resumo da relação", async () => {
    await page.goto(`${BASE_URL}/minha-conta/historico`, { waitUntil: "networkidle" });
    assert.ok(await visivel(page.getByText(NOME_BARBEARIA)));
    assert.ok(await visivel(page.getByRole("link", { name: /Agendar de novo/ })));
  });

  test("agendar de novo leva para a página da barbearia", async () => {
    // Navega antes de agir: teste não deve depender do estado deixado pelo anterior
    await page.goto(`${BASE_URL}/minha-conta/historico`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Agendar de novo/ }).first().click();
    // Navegação client-side do Next não dispara networkidle: esperar pela URL
    await page.waitForURL(new RegExp(`/b/${slugPublico}`), { timeout: 15000 });
  });

  test("sair encerra a sessão do cliente", async () => {
    await page.goto(`${BASE_URL}/minha-conta`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL(/\/entrar-cliente$/, { timeout: 15000 });

    await page.goto(`${BASE_URL}/minha-conta`, { waitUntil: "networkidle" });
    assert.match(page.url(), /\/entrar-cliente$/);
  });

  test("nenhum erro de javascript nem de servidor no caminho todo", () => {
    assert.deepEqual(problemas, [], problemas.join("\n"));
  });
});
