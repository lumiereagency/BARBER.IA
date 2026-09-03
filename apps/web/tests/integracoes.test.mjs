// Painel de integrações: o que a tela mostra e o que ela recusa.
//
// Duas coisas são provadas aqui:
//  - o estado da integração vira frase acionável, sem jargão (Parte 1 §21 e
//    Parte 3 §11: "status e erro acionável aparecem no painel");
//  - o `state` do OAuth é inforjável — sem isso, um link preparado por
//    terceiro conectaria uma conta do Google ao profissional errado.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.TOKEN_HMAC_SECRET ??= "test-only-secret";

const { describeIntegration, signOAuthState, verifyOAuthState } = await import(
  "../lib/integrations.ts"
);
const { messagingProvider, setMessagingProvider } = await import("../lib/messaging.ts");

const SHOP = "11111111-1111-1111-1111-111111111111";
const PRO = "22222222-2222-2222-2222-222222222222";

function semJargao(texto) {
  const proibidos = [/HTTP/i, /\b40\d\b/, /\b50\d\b/, /token/i, /OAuth/i, /API/i, /null/i];
  return proibidos.every((padrao) => !padrao.test(texto));
}

describe("estado legível da integração", () => {
  test("sem conexão, a tela explica a consequência e não pede nada", () => {
    const estado = describeIntegration(null);
    assert.equal(estado.tone, "off");
    assert.equal(estado.needsReconnect, false);
    assert.ok(semJargao(estado.detail));
  });

  test("acesso revogado vira instrução, não código de erro", () => {
    const estado = describeIntegration({
      status: "ERROR",
      lastErrorCode: "REVOKED",
      lastSyncAt: new Date(),
    });
    assert.equal(estado.needsReconnect, true);
    assert.match(estado.detail, /Reconecte/);
    assert.ok(semJargao(estado.detail));
  });

  test("queda passageira não manda o dono fazer nada", () => {
    const estado = describeIntegration({
      status: "UNSTABLE",
      lastErrorCode: "TRANSIENT",
      lastSyncAt: new Date(),
    });
    assert.equal(estado.needsReconnect, false, "reconectar não resolve queda do Google");
    assert.match(estado.detail, /não é preciso fazer nada/);
  });

  test("erro sem código conhecido ainda diz o que fazer", () => {
    const estado = describeIntegration({
      status: "ERROR",
      lastErrorCode: "ALGO_NOVO",
      lastSyncAt: null,
    });
    assert.ok(estado.detail.length > 0);
    assert.ok(semJargao(estado.detail));
  });

  test("conectado sem envio ainda não promete o que não aconteceu", () => {
    const estado = describeIntegration({
      status: "CONNECTED",
      lastErrorCode: null,
      lastSyncAt: null,
    });
    assert.equal(estado.tone, "ok");
    assert.match(estado.detail, /assim que houver um agendamento/);
  });
});

describe("state do OAuth", () => {
  test("ida e volta preserva barbearia, profissional e nonce", () => {
    const original = { barbershopId: SHOP, professionalId: PRO, nonce: "n-1" };
    assert.deepEqual(verifyOAuthState(signOAuthState(original)), original);
  });

  test("state adulterado é recusado", () => {
    const assinado = signOAuthState({ barbershopId: SHOP, professionalId: PRO, nonce: "n-1" });
    const [payload, assinatura] = assinado.split(".");

    // Troca o profissional mantendo a assinatura antiga
    const forjado = Buffer.from(
      JSON.stringify({ barbershopId: SHOP, professionalId: "outro", nonce: "n-1" })
    ).toString("base64url");

    assert.equal(verifyOAuthState(`${forjado}.${assinatura}`), null);
    assert.equal(verifyOAuthState(`${payload}.${"0".repeat(assinatura.length)}`), null);
  });

  test("lixo e formato inesperado não derrubam a rota", () => {
    assert.equal(verifyOAuthState(""), null);
    assert.equal(verifyOAuthState("sem-ponto"), null);
    assert.equal(verifyOAuthState("a.b"), null);
    assert.equal(
      verifyOAuthState(`${Buffer.from("{}").toString("base64url")}.x`),
      null,
      "payload sem os campos obrigatórios não vale"
    );
  });
});

describe("provedor de envio do código de acesso", () => {
  function comAmbiente(env, fn) {
    const anterior = { ...process.env };
    Object.assign(process.env, env);
    setMessagingProvider(null);
    try {
      return fn();
    } finally {
      for (const chave of Object.keys(env)) delete process.env[chave];
      Object.assign(process.env, anterior);
      setMessagingProvider(null);
    }
  }

  test("não configurado em produção recusa em vez de fingir que enviou", () => {
    comAmbiente({ NODE_ENV: "production", SMS_PROVIDER: "" }, () => {
      assert.throws(() => messagingProvider(), /SMS_PROVIDER/);
    });
  });

  test("não configurado fora de produção registra no log", () => {
    comAmbiente({ NODE_ENV: "development", SMS_PROVIDER: "" }, () => {
      assert.equal(messagingProvider().name, "log");
    });
  });

  test("SMS_PROVIDER=log é opt-in explícito e vale no build de produção", () => {
    // É o que permite a CI e a homologação exercitarem o fluxo inteiro contra
    // o build de produção, que é o que de fato vai para a VPS.
    comAmbiente({ NODE_ENV: "production", SMS_PROVIDER: "log" }, () => {
      assert.equal(messagingProvider().name, "log");
    });
  });

  test("provedor desconhecido falha alto", () => {
    comAmbiente({ NODE_ENV: "development", SMS_PROVIDER: "twilio" }, () => {
      assert.throws(() => messagingProvider(), /desconhecido/);
    });
  });
});
