// Fluxo público no navegador, em viewport de celular (Parte 3 §13, mobile first).
//
// Complementa flow.e2e.mjs: aquele prova os contratos HTTP, este prova que uma
// pessoa consegue de fato agendar, ver a confirmação e cancelar pelo link.
//
// Requer o servidor em BASE_URL e a barbearia de demonstração semeada
// (pnpm --filter @barber/web seed:demo).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SLUG = process.env.DEMO_SLUG ?? "barbearia-do-ze";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

let browser;
let page;
const problemas = [];

/// isVisible() não espera — sem isto o teste vira corrida com a renderização.
async function visivel(locator, timeout = 10000) {
  await locator.first().waitFor({ state: "visible", timeout });
  return true;
}

before(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  page.on("pageerror", (error) => problemas.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") problemas.push(message.text());
  });
  // Ícones ausentes não são problema de aplicação
  page.on("response", (response) => {
    if (response.status() >= 500) problemas.push(`${response.status()} ${response.url()}`);
  });
});

after(async () => {
  await browser?.close();
});

describe("agendar pelo celular", () => {
  let manageUrl;

  test("a página pública lista os serviços com preço", async () => {
    await page.goto(`${BASE_URL}/b/${SLUG}`, { waitUntil: "networkidle" });
    assert.ok(await visivel(page.getByRole("heading", { level: 1 })));
    assert.ok(await visivel(page.getByText("Corte + Barba")));
    assert.ok(await visivel(page.getByText(/R\$\s?80,00/)));
  });

  test("escolher serviço leva direto para a escolha de profissional", async () => {
    await page.getByText("Corte + Barba").first().click();
    await page.waitForLoadState("networkidle");
    assert.ok(await visivel(page.getByRole("button", { name: /Qualquer profissional/ })));
  });

  test("a agenda vem do servidor e oferece horários", async () => {
    await page.getByRole("button", { name: /Qualquer profissional/ }).click();
    await page.waitForTimeout(2000);
    const horarios = await page.locator("button", { hasText: /^\d{2}:\d{2}/ }).count();
    assert.ok(horarios > 0, "nenhum horário oferecido");
  });

  test("selecionar horário mostra a contagem regressiva do hold", async () => {
    await page.locator("button", { hasText: /^\d{2}:\d{2}/ }).first().click();
    await page.waitForTimeout(1500);
    assert.ok(
      await visivel(page.getByText(/Guardamos este horário/)),
      "o cliente precisa ver quanto tempo o horário está guardado"
    );
  });

  test("promoção é escolha separada do aceite obrigatório", async () => {
    const checkboxes = page.locator('input[type="checkbox"]');
    assert.equal(await checkboxes.count(), 2, "termos e promoções devem ser aceites distintos");
    assert.equal(await checkboxes.nth(0).isChecked(), false);
    assert.equal(await checkboxes.nth(1).isChecked(), false);
  });

  test("confirmar sem conta conclui o agendamento", async () => {
    await page.getByRole("textbox", { name: "Seu nome" }).fill("João da Silva");
    // Telefone como a pessoa digita: quem normaliza é o servidor
    await page.getByRole("textbox", { name: "WhatsApp" }).fill("(11) 99999-0000");
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: /Confirmar agendamento/ }).click();
    await page.waitForTimeout(3000);

    assert.ok(await visivel(page.getByText("Horário reservado!")));
    manageUrl = await page
      .getByRole("link", { name: /Gerenciar meu agendamento/ })
      .getAttribute("href");
    assert.ok(manageUrl?.includes("/a/"));
    // Envio de WhatsApp é oferecido, nunca automático
    assert.ok(await visivel(page.getByRole("link", { name: /WhatsApp/ })));
  });

  test("o link de gestão mostra a reserva", async () => {
    await page.goto(manageUrl, { waitUntil: "networkidle" });
    assert.ok(await visivel(page.getByText("Confirmado")));
    assert.ok(await visivel(page.getByRole("button", { name: /Cancelar agendamento/ })));
  });

  test("cancelar pede confirmação antes de acontecer", async () => {
    await page.getByRole("button", { name: /Cancelar agendamento/ }).click();
    assert.ok(await visivel(page.getByText(/Tem certeza/)));
    assert.ok(await visivel(page.getByRole("button", { name: /Manter/ })));
  });

  test("confirmar o cancelamento atualiza a página", async () => {
    await page.getByRole("button", { name: /Sim, cancelar/ }).click();
    await page.waitForTimeout(2500);
    assert.ok(await visivel(page.getByText(/Cancelado por você/)));
    assert.equal(
      await page.getByRole("button", { name: /Cancelar agendamento/ }).isVisible(),
      false,
      "não deveria oferecer cancelar de novo"
    );
  });

  test("nenhum erro de javascript nem de servidor no caminho todo", () => {
    assert.deepEqual(problemas, [], problemas.join("\n"));
  });
});
