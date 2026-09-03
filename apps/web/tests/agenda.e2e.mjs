// Marco 3 no navegador: a barbearia opera o dia pelo sistema.
//
// Cobre o caminho que o balconista faz de verdade — abrir a agenda, encaixar
// quem chegou sem marcar, concluir atendimento, marcar falta, desfazer engano,
// bloquear um período — e confirma que os números do dia acompanham.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

const sufixo = randomUUID().slice(0, 8);
const EMAIL = `agenda-${sufixo}@teste.com`;
const SENHA = "senha-bem-longa-1";
const NOME_BARBEARIA = `Barbearia Agenda ${sufixo}`;

/// Ruído do roteador do Next, não defeito da aplicação: quando uma navegação
/// cancela um prefetch em voo, o roteador registra a falha no console e refaz a
/// navegação pelo caminho normal. Filtrar só esta mensagem mantém a asserção de
/// "nenhum erro no console" valendo para tudo o mais.
const RUIDO_DO_ROTEADOR = /Failed to fetch RSC payload/;

let browser;
let page;
const problemas = [];

async function visivel(locator, timeout = 15000) {
  await locator.first().waitFor({ state: "visible", timeout });
  return true;
}

/// Abre a seção só se estiver fechada. Depois de encaixar, ela permanece
/// aberta de propósito — o balconista vê a confirmação e pode encaixar outro —
/// então clicar às cegas no título fecharia o formulário.
async function abrirSecao(titulo) {
  const secao = page.getByRole("group").filter({ hasText: titulo });
  const aberta = await secao.first().evaluate((el) => el.open);
  if (!aberta) await secao.locator("summary").first().click();
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

  // Configura a barbearia pela interface, como o dono faria
  await page.goto(`${BASE_URL}/criar-conta`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Nome da barbearia" }).fill(NOME_BARBEARIA);
  await page.getByRole("textbox", { name: "Seu nome" }).fill("Dono");
  await page.getByRole("textbox", { name: "Seu e-mail" }).fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
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
});

after(async () => {
  await browser?.close();
  const { prisma } = await import("@barber/db");
  await prisma.barbershop.deleteMany({ where: { name: NOME_BARBEARIA } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

describe("agenda do dia", () => {
  test("abre vazia e sem erro", async () => {
    await page.goto(`${BASE_URL}/agenda`, { waitUntil: "networkidle" });
    assert.ok(await visivel(page.getByRole("heading", { name: "Agenda" })));
    assert.ok(await visivel(page.getByText("Nenhum atendimento")));
  });

  test("alterna entre dia e semana", async () => {
    await page.getByRole("link", { name: "Semana", exact: true }).click();
    await page.waitForURL(/visao=semana/, { timeout: 15000 });
    // A visão semanal mostra os sete dias
    assert.ok(await visivel(page.getByText(/segunda-feira/i)));

    await page.getByRole("link", { name: "Dia", exact: true }).click();
    await page.waitForURL((url) => !url.search.includes("visao=semana"), { timeout: 15000 });
  });

  test("navega para o dia seguinte e volta para hoje", async () => {
    const urlInicial = page.url();
    await page.getByRole("link", { name: /Próximo/ }).click();
    await page.waitForURL((url) => url.href !== urlInicial, { timeout: 15000 });

    await page.getByRole("link", { name: "Ir para hoje na agenda" }).click();
    await page.waitForTimeout(1500);
    assert.ok(await visivel(page.getByRole("heading", { name: "Agenda" })));
  });
});

describe("encaixe no balcão", () => {
  test("encaixa quem chegou sem marcar", async () => {
    await page.goto(`${BASE_URL}/agenda`, { waitUntil: "networkidle" });
    await abrirSecao("Encaixar atendimento");

    await page.getByRole("textbox", { name: "Nome do cliente" }).fill("João Sem Hora");
    await page.getByRole("textbox", { name: "WhatsApp do cliente" }).fill("(11) 97777-6666");
    // Horário fora da grade de propósito
    await page.locator('input[name="time"]').fill("10:07");
    await page.getByRole("button", { name: /Confirmar encaixe/ }).click();
    await page.waitForTimeout(3000);

    assert.ok(await visivel(page.getByText("João Sem Hora")));
    assert.ok(await visivel(page.getByText(/10:07/)));
    // Marcado como vindo do balcão
    assert.ok(await visivel(page.getByText(/balcão/)));
  });

  test("o mesmo horário no mesmo profissional é recusado com mensagem clara", async () => {
    await abrirSecao("Encaixar atendimento");
    await page.getByRole("textbox", { name: "Nome do cliente" }).fill("Outro Cliente");
    await page.getByRole("textbox", { name: "WhatsApp do cliente" }).fill("(11) 96666-5555");
    await page.locator('input[name="time"]').fill("10:15");
    await page.getByRole("button", { name: /Confirmar encaixe/ }).click();
    await page.waitForTimeout(3000);

    assert.ok(await visivel(page.getByText(/já tem atendimento nesse horário/i)));
  });
});

describe("status do atendimento", () => {
  test("oferece os atalhos de WhatsApp manual", async () => {
    await page.goto(`${BASE_URL}/agenda`, { waitUntil: "networkidle" });
    const confirmar = page.getByRole("link", { name: /Confirmar no WhatsApp/ }).first();
    assert.ok(await visivel(confirmar));

    // O link é wa.me com a mensagem pronta — o envio é sempre manual
    const href = await confirmar.getAttribute("href");
    assert.match(href, /^https:\/\/wa\.me\/5511977776666\?text=/);
    assert.match(decodeURIComponent(href), /Confirmando seu horário/);
  });

  test("concluir muda o estado e some das ações de confirmado", async () => {
    await page.getByRole("button", { name: "Concluir" }).first().click();
    await page.waitForTimeout(3000);

    assert.ok(await visivel(page.getByText("Concluído")));
    assert.equal(await page.getByRole("button", { name: "Concluir" }).isVisible(), false);
  });

  test("o realizado do dia acompanha na hora", async () => {
    // Números lidos ao vivo dos agendamentos, não de contador materializado
    const realizado = await page
      .locator("div", { hasText: /^Realizado/ })
      .last()
      .innerText();
    assert.match(realizado, /50,00/);
  });

  test("desfazer volta para confirmado", async () => {
    await page.getByRole("button", { name: "Desfazer" }).first().click();
    await page.waitForTimeout(3000);

    assert.ok(await visivel(page.getByText("Confirmado")));
    assert.ok(await visivel(page.getByRole("button", { name: "Concluir" })));
  });

  test("marcar falta registra sem contar como receita", async () => {
    await page.getByRole("button", { name: "Não veio" }).first().click();
    await page.waitForTimeout(3000);

    assert.ok(await visivel(page.getByText("Não veio")));

    const realizado = await page
      .locator("div", { hasText: /^Realizado/ })
      .last()
      .innerText();
    assert.match(realizado, /R\$\s?0,00/);
  });

  test("cancelar pede confirmação antes", async () => {
    await page.getByRole("button", { name: "Desfazer" }).first().click();
    await page.waitForTimeout(3000);

    await page.getByRole("button", { name: "Cancelar", exact: true }).first().click();
    assert.ok(await visivel(page.getByText(/Cancelar este atendimento/)));
    assert.ok(await visivel(page.getByRole("button", { name: /Manter/ })));

    await page.getByRole("button", { name: /Manter/ }).click();
    await page.waitForTimeout(500);
    assert.ok(await visivel(page.getByRole("button", { name: "Concluir" })));
  });
});

describe("bloqueio de período", () => {
  test("bloqueia e avisa sobre atendimento já confirmado no intervalo", async () => {
    await page.goto(`${BASE_URL}/agenda`, { waitUntil: "networkidle" });
    await abrirSecao("Bloquear um período");

    await page.locator('input[name="from"]').fill("10:00");
    await page.locator('input[name="to"]').fill("11:00");
    await page.getByRole("textbox", { name: /Motivo/ }).fill("Almoço");
    await page.getByRole("button", { name: /Bloquear período/ }).click();
    await page.waitForTimeout(3000);

    // Existe atendimento às 10:07 nesse intervalo: o dono precisa saber
    assert.ok(await visivel(page.getByText(/atendimento\(s\) já confirmado\(s\)/)));
    assert.ok(await visivel(page.getByText(/bloqueado/)));
    assert.ok(await visivel(page.getByText(/Almoço/)));
  });

  test("o atendimento afetado continua na agenda", async () => {
    // O bloqueio não cancela reserva de cliente por conta própria
    assert.ok(await visivel(page.getByText("João Sem Hora")));
    assert.ok(await visivel(page.getByText("Confirmado")));
  });

  test("liberar remove o bloqueio", async () => {
    await page.getByRole("button", { name: "Liberar" }).first().click();
    await page.waitForTimeout(3000);
    assert.equal(await page.getByText(/· bloqueado/).isVisible(), false);
  });

  test("nenhum erro de javascript nem de servidor no caminho todo", () => {
    assert.deepEqual(problemas, [], problemas.join("\n"));
  });
});
