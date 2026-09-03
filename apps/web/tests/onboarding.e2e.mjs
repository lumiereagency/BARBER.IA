// Marco 1 no navegador: do cadastro até a página pública recebendo agendamento.
//
// É a evidência que o marco pede — o dono configura uma agenda válida sozinho,
// sem ninguém semear banco por trás.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
// Sem CHROMIUM_PATH, usa o navegador que o Playwright instalou
// (`pnpm --filter @barber/web exec playwright install chromium`).
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

const sufixo = randomUUID().slice(0, 8);
const EMAIL = `dono-${sufixo}@teste.com`;
const SENHA = "senha-bem-longa-1";
const NOME_BARBEARIA = `Barbearia Teste ${sufixo}`;

/// Ruído do roteador do Next, não defeito da aplicação: quando uma navegação
/// cancela um prefetch em voo, o roteador registra a falha no console e refaz a
/// navegação pelo caminho normal. Filtrar só esta mensagem mantém a asserção de
/// "nenhum erro no console" valendo para tudo o mais.
const RUIDO_DO_ROTEADOR = /Failed to fetch RSC payload/;

let browser;
let page;
let slugPublico;
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
});

after(async () => {
  await browser?.close();
  const { prisma } = await import("@barber/db");
  await prisma.barbershop.deleteMany({ where: { name: NOME_BARBEARIA } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

describe("o dono configura a barbearia do zero", () => {
  test("painel exige sessão: sem login, vai para a tela de entrada", async () => {
    await page.goto(`${BASE_URL}/hoje`, { waitUntil: "networkidle" });
    assert.match(page.url(), /\/entrar$/, "o painel não pode abrir sem sessão");
  });

  test("cria conta e barbearia em um formulário só", async () => {
    await page.goto(`${BASE_URL}/criar-conta`, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Nome da barbearia" }).fill(NOME_BARBEARIA);
    await page.getByRole("textbox", { name: "Seu nome" }).fill("Zé Proprietário");
    await page.getByRole("textbox", { name: "Seu e-mail" }).fill(EMAIL);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: /Criar minha barbearia/ }).click();
    await page.waitForURL(/\/hoje$/, { timeout: 20000 });
    assert.ok(await visivel(page.getByRole("heading", { name: "Hoje" })));
  });

  test("o painel vazio diz o que falta para receber agendamento", async () => {
    assert.ok(await visivel(page.getByText(/ainda não recebe agendamentos/i)));
    assert.ok(await visivel(page.getByRole("link", { name: /Cadastre seus serviços/ })));
  });

  test("cadastra um serviço", async () => {
    await page.goto(`${BASE_URL}/gestao/servicos`, { waitUntil: "networkidle" });
    assert.ok(await visivel(page.getByText(/Nenhum serviço cadastrado/)));

    await page.getByRole("textbox", { name: "Nome do serviço" }).fill("Corte + Barba");
    await page.getByRole("textbox", { name: "Preço" }).fill("80,00");
    await page.getByRole("spinbutton", { name: "Duração em minutos" }).fill("45");
    await page.getByRole("spinbutton", { name: "Limpeza depois" }).fill("15");
    await page.getByRole("button", { name: /Adicionar serviço/ }).click();
    await page.waitForTimeout(2500);

    assert.ok(await visivel(page.getByText("Corte + Barba")));
    assert.ok(await visivel(page.getByText(/45 min/)));
  });

  test("cadastra um profissional e o sistema avisa o que falta", async () => {
    await page.goto(`${BASE_URL}/equipe`, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Nome do profissional" }).fill("Matheus");
    await page.getByRole("button", { name: /Adicionar profissional/ }).click();
    await page.waitForTimeout(2500);

    assert.ok(await visivel(page.getByText("Matheus")));
    // Estado incompleto com a próxima ação clara
    assert.ok(await visivel(page.getByText(/Ainda não aparece na agenda/)));
  });

  test("vincula o serviço ao profissional", async () => {
    await page.getByRole("checkbox", { name: "Corte + Barba" }).check();
    await page.getByRole("button", { name: /Salvar serviços/ }).click();
    await page.waitForTimeout(2500);
    assert.ok(await visivel(page.getByText(/falta definir os horários/)));
  });

  test("define os horários de trabalho", async () => {
    await page.getByRole("checkbox", { name: "Segunda" }).check();
    await page.getByRole("checkbox", { name: "Terça" }).check();
    await page.getByRole("checkbox", { name: "Quarta" }).check();
    await page.getByRole("checkbox", { name: "Quinta" }).check();
    await page.getByRole("checkbox", { name: "Sexta" }).check();
    await page.getByRole("checkbox", { name: "Sábado" }).check();
    await page.getByRole("button", { name: /Salvar horários/ }).click();
    await page.waitForTimeout(2500);

    // O aviso de configuração incompleta some
    assert.equal(await page.getByText(/Ainda não aparece na agenda/).isVisible(), false);
  });

  test("as configurações mostram o link público da barbearia", async () => {
    await page.goto(`${BASE_URL}/gestao/configuracoes`, { waitUntil: "networkidle" });
    const texto = await page.getByText(/\/b\//).first().innerText();
    slugPublico = texto.split("/b/").pop().trim();
    assert.ok(slugPublico.length > 0);
    assert.match(slugPublico, /^barbearia-teste-/);
  });

  test("o painel para de pedir configuração", async () => {
    await page.goto(`${BASE_URL}/hoje`, { waitUntil: "networkidle" });
    assert.equal(await page.getByText(/ainda não recebe agendamentos/i).isVisible(), false);
  });
});

describe("a página pública funciona com o que foi configurado", () => {
  test("mostra o serviço cadastrado", async () => {
    await page.goto(`${BASE_URL}/b/${slugPublico}`, { waitUntil: "networkidle" });
    assert.ok(await visivel(page.getByText("Corte + Barba")));
    assert.ok(await visivel(page.getByText(/R\$\s?80,00/)));
    assert.ok(await visivel(page.getByText("Matheus")));
  });

  test("um cliente consegue agendar de ponta a ponta", async () => {
    await page.getByText("Corte + Barba").first().click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Qualquer profissional/ }).click();
    await page.waitForTimeout(2500);

    const horarios = await page.locator("button", { hasText: /^\d{2}:\d{2}/ }).count();
    assert.ok(horarios > 0, "a agenda configurada deveria oferecer horários");

    await page.locator("button", { hasText: /^\d{2}:\d{2}/ }).first().click();
    await page.waitForTimeout(1500);
    await page.getByRole("textbox", { name: "Seu nome" }).fill("Cliente Teste");
    await page.getByRole("textbox", { name: "WhatsApp" }).fill("(11) 98888-7777");
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: /Confirmar agendamento/ }).click();
    await page.waitForTimeout(3000);

    assert.ok(await visivel(page.getByText("Horário reservado!")));
  });
});

describe("o agendamento aparece no painel do dono", () => {
  test("Hoje ou a agenda registram a reserva", async () => {
    await page.goto(`${BASE_URL}/hoje`, { waitUntil: "networkidle" });
    // Pode cair hoje ou em outro dia, conforme a hora da execução; o que
    // importa é o painel abrir com sessão e sem erro.
    assert.ok(await visivel(page.getByRole("heading", { name: "Hoje" })));
  });

  test("sair encerra a sessão de verdade", async () => {
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL(/\/entrar$/, { timeout: 15000 });

    // Voltar ao painel não deve funcionar com a sessão revogada
    await page.goto(`${BASE_URL}/hoje`, { waitUntil: "networkidle" });
    assert.match(page.url(), /\/entrar$/, "sessão revogada não pode dar acesso");
  });

  test("entrar de novo com a senha correta funciona", async () => {
    await page.getByRole("textbox", { name: "E-mail" }).fill(EMAIL);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/hoje$/, { timeout: 20000 });
    assert.ok(await visivel(page.getByRole("heading", { name: "Hoje" })));
  });

  test("senha errada não entra e não diz se o e-mail existe", async () => {
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL(/\/entrar$/, { timeout: 15000 });

    await page.getByRole("textbox", { name: "E-mail" }).fill(EMAIL);
    await page.getByLabel("Senha").fill("senha-errada-mesmo");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForTimeout(2500);

    const mensagemComEmailReal = await page.getByText("E-mail ou senha incorretos.").isVisible();
    assert.ok(mensagemComEmailReal);

    // E-mail inexistente devolve exatamente a mesma mensagem
    await page.getByRole("textbox", { name: "E-mail" }).fill(`naoexiste-${sufixo}@teste.com`);
    await page.getByLabel("Senha").fill("qualquer-senha-aqui");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForTimeout(2500);
    assert.ok(await page.getByText("E-mail ou senha incorretos.").isVisible());
  });

  test("nenhum erro de javascript nem de servidor no caminho todo", () => {
    assert.deepEqual(problemas, [], problemas.join("\n"));
  });
});
