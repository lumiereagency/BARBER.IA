import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeOpportunityMatch, computeReturnScore } from "../dist/return-score.js";

const AGORA = new Date("2026-09-04T12:00:00Z");
const diasAtras = (n) => new Date(AGORA.getTime() - n * 86_400_000);

function motivos(resultado) {
  return resultado.reasons.map((r) => r.code);
}

describe("computeReturnScore", () => {
  test("sem atendimento concluído não pontua — não há o que recuperar", () => {
    const r = computeReturnScore(
      { completedVisitsCount: 0, lastVisitAt: null, averageReturnDays: null, noShowCount: 0, cancelledCount: 0 },
      AGORA
    );
    assert.equal(r.score, 0);
    assert.deepEqual(motivos(r), ["sem_historico"]);
  });

  test("cliente no período que costuma voltar pontua alto e diz por quê", () => {
    const r = computeReturnScore(
      {
        completedVisitsCount: 4,
        lastVisitAt: diasAtras(30),
        averageReturnDays: 30,
        noShowCount: 0,
        cancelledCount: 0,
      },
      AGORA
    );
    assert.ok(motivos(r).includes("no_momento"));
    assert.ok(motivos(r).includes("recorrente"));
    assert.ok(r.score >= 40);
  });

  test("cliente muito atrasado pontua mais que o cliente em dia", () => {
    const noMomento = computeReturnScore(
      { completedVisitsCount: 3, lastVisitAt: diasAtras(30), averageReturnDays: 30, noShowCount: 0, cancelledCount: 0 },
      AGORA
    );
    const atrasado = computeReturnScore(
      { completedVisitsCount: 3, lastVisitAt: diasAtras(60), averageReturnDays: 30, noShowCount: 0, cancelledCount: 0 },
      AGORA
    );
    assert.ok(motivos(atrasado).includes("atrasado"));
    assert.ok(atrasado.score > noMomento.score);
  });

  test("cliente que ainda não chegou no período próprio pontua baixo", () => {
    const r = computeReturnScore(
      { completedVisitsCount: 3, lastVisitAt: diasAtras(5), averageReturnDays: 30, noShowCount: 0, cancelledCount: 0 },
      AGORA
    );
    assert.ok(motivos(r).includes("cedo_demais"));
  });

  test("uma visita só usa sinal genérico, nunca finge padrão pessoal", () => {
    const r = computeReturnScore(
      { completedVisitsCount: 1, lastVisitAt: diasAtras(30), averageReturnDays: null, noShowCount: 0, cancelledCount: 0 },
      AGORA
    );
    assert.ok(motivos(r).includes("tempo_generico"));
    assert.equal(motivos(r).some((m) => m === "no_momento" || m === "atrasado"), false);
  });

  test("falta sem avisar reduz a pontuação, mas não zera o histórico bom", () => {
    const semFalta = computeReturnScore(
      { completedVisitsCount: 4, lastVisitAt: diasAtras(30), averageReturnDays: 30, noShowCount: 0, cancelledCount: 0 },
      AGORA
    );
    const comFalta = computeReturnScore(
      { completedVisitsCount: 4, lastVisitAt: diasAtras(30), averageReturnDays: 30, noShowCount: 2, cancelledCount: 0 },
      AGORA
    );
    assert.ok(motivos(comFalta).includes("faltou"));
    assert.ok(comFalta.score < semFalta.score);
    assert.ok(comFalta.score > 0, "falta não pode apagar um histórico de retorno bom");
  });

  test("pontuação nunca sai do intervalo 0–100", () => {
    const r = computeReturnScore(
      { completedVisitsCount: 20, lastVisitAt: diasAtras(200), averageReturnDays: 10, noShowCount: 10, cancelledCount: 10 },
      AGORA
    );
    assert.ok(r.score >= 0 && r.score <= 100);
  });

  test("mesmo histórico, mesmo resultado — determinístico", () => {
    const entrada = {
      completedVisitsCount: 3,
      lastVisitAt: diasAtras(45),
      averageReturnDays: 30,
      noShowCount: 1,
      cancelledCount: 1,
    };
    const a = computeReturnScore(entrada, AGORA);
    const b = computeReturnScore(entrada, AGORA);
    assert.deepEqual(a, b);
  });
});

describe("computeOpportunityMatch", () => {
  const PRO_A = "11111111-1111-1111-1111-111111111111";
  const PRO_B = "22222222-2222-2222-2222-222222222222";
  const SERVICO_A = "33333333-3333-3333-3333-333333333333";

  test("profissional e serviço preferidos somam pontos com motivo", () => {
    const base = computeReturnScore(
      { completedVisitsCount: 3, lastVisitAt: diasAtras(30), averageReturnDays: 30, noShowCount: 0, cancelledCount: 0 },
      AGORA
    );
    const combinado = computeOpportunityMatch({
      returnScore: base,
      preferredProfessionalId: PRO_A,
      preferredServiceId: SERVICO_A,
      opportunityProfessionalId: PRO_A,
      compatibleServiceIds: [SERVICO_A],
    });
    assert.ok(combinado.score > base.score);
    assert.ok(motivos(combinado).includes("profissional_preferido"));
    assert.ok(motivos(combinado).includes("servico_preferido"));
  });

  test("profissional diferente do preferido não ganha o bônus", () => {
    const base = computeReturnScore(
      { completedVisitsCount: 3, lastVisitAt: diasAtras(30), averageReturnDays: 30, noShowCount: 0, cancelledCount: 0 },
      AGORA
    );
    const combinado = computeOpportunityMatch({
      returnScore: base,
      preferredProfessionalId: PRO_A,
      preferredServiceId: null,
      opportunityProfessionalId: PRO_B,
      compatibleServiceIds: [],
    });
    assert.equal(combinado.score, base.score);
    assert.equal(motivos(combinado).includes("profissional_preferido"), false);
  });

  test("sem preferência declarada, não inventa compatibilidade", () => {
    const base = computeReturnScore(
      { completedVisitsCount: 1, lastVisitAt: diasAtras(10), averageReturnDays: null, noShowCount: 0, cancelledCount: 0 },
      AGORA
    );
    const combinado = computeOpportunityMatch({
      returnScore: base,
      preferredProfessionalId: null,
      preferredServiceId: null,
      opportunityProfessionalId: PRO_A,
      compatibleServiceIds: [SERVICO_A],
    });
    assert.equal(combinado.score, base.score);
  });
});
