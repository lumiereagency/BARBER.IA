import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeCrmSummary } from "../dist/crm.js";

const dia = (n) => new Date(`2027-01-${String(n).padStart(2, "0")}T13:00:00Z`);

const atendimento = (overrides = {}) => ({
  status: "COMPLETED",
  startsAt: dia(1),
  priceMinor: 5000,
  professionalId: "p1",
  serviceId: "s1",
  ...overrides,
});

describe("cliente sem histórico", () => {
  test("tudo desconhecido, nada inventado", () => {
    const resumo = computeCrmSummary([]);

    assert.equal(resumo.completedVisitsCount, 0);
    assert.equal(resumo.totalSpentMinor, 0);
    assert.equal(resumo.firstVisitAt, null);
    assert.equal(resumo.lastVisitAt, null);
    assert.equal(resumo.averageTicketMinor, null);
    assert.equal(resumo.averageReturnDays, null);
    assert.equal(resumo.nextReturnEstimate, null);
    assert.equal(resumo.preferredProfessionalId, null);
    assert.equal(resumo.preferredServiceId, null);
  });

  test("agendamento marcado mas ainda não atendido não conta como visita", () => {
    const resumo = computeCrmSummary([atendimento({ status: "CONFIRMED" })]);
    assert.equal(resumo.completedVisitsCount, 0);
    assert.equal(resumo.firstVisitAt, null);
    assert.equal(resumo.totalSpentMinor, 0);
  });
});

describe("uma visita só", () => {
  const resumo = computeCrmSummary([atendimento({ startsAt: dia(10), priceMinor: 8000 })]);

  test("registra a visita e o ticket", () => {
    assert.equal(resumo.completedVisitsCount, 1);
    assert.equal(resumo.totalSpentMinor, 8000);
    assert.equal(resumo.averageTicketMinor, 8000);
    assert.deepEqual(resumo.firstVisitAt, dia(10));
    assert.deepEqual(resumo.lastVisitAt, dia(10));
  });

  test("não inventa frequência: uma visita não tem intervalo", () => {
    assert.equal(resumo.averageReturnDays, null);
    assert.equal(resumo.nextReturnEstimate, null);
  });

  test("não inventa preferência: uma vez não é preferência", () => {
    assert.equal(resumo.preferredProfessionalId, null);
    assert.equal(resumo.preferredServiceId, null);
  });
});

describe("cliente recorrente", () => {
  const resumo = computeCrmSummary([
    atendimento({ startsAt: dia(1), priceMinor: 5000 }),
    atendimento({ startsAt: dia(15), priceMinor: 5000 }),
    atendimento({ startsAt: dia(29), priceMinor: 8000 }),
  ]);

  test("soma o realizado e calcula o ticket médio", () => {
    assert.equal(resumo.totalSpentMinor, 18000);
    assert.equal(resumo.averageTicketMinor, 6000);
    assert.equal(resumo.completedVisitsCount, 3);
  });

  test("frequência média é a distância entre as visitas", () => {
    // 28 dias entre a primeira e a última, dois intervalos
    assert.equal(resumo.averageReturnDays, 14);
  });

  test("projeta o próximo retorno a partir da última visita", () => {
    assert.deepEqual(resumo.nextReturnEstimate, new Date(dia(29).getTime() + 14 * 864e5));
  });

  test("preferência aparece quando há repetição", () => {
    assert.equal(resumo.preferredProfessionalId, "p1");
    assert.equal(resumo.preferredServiceId, "s1");
  });
});

describe("preferência", () => {
  test("escolhe quem aparece mais", () => {
    const resumo = computeCrmSummary([
      atendimento({ professionalId: "p1", startsAt: dia(1) }),
      atendimento({ professionalId: "p1", startsAt: dia(8) }),
      atendimento({ professionalId: "p2", startsAt: dia(15) }),
    ]);
    assert.equal(resumo.preferredProfessionalId, "p1");
  });

  test("empate é resolvido de forma determinística, não aleatória", () => {
    const historico = [
      atendimento({ professionalId: "p2", startsAt: dia(1) }),
      atendimento({ professionalId: "p2", startsAt: dia(8) }),
      atendimento({ professionalId: "p1", startsAt: dia(15) }),
      atendimento({ professionalId: "p1", startsAt: dia(22) }),
    ];

    const primeira = computeCrmSummary(historico).preferredProfessionalId;
    const segunda = computeCrmSummary([...historico].reverse()).preferredProfessionalId;
    assert.equal(primeira, segunda, "recalcular não pode trocar o preferido");
  });

  test("cada um uma vez não gera preferência", () => {
    const resumo = computeCrmSummary([
      atendimento({ professionalId: "p1", startsAt: dia(1) }),
      atendimento({ professionalId: "p2", startsAt: dia(8) }),
    ]);
    assert.equal(resumo.preferredProfessionalId, null);
  });
});

describe("o que não é receita", () => {
  test("cancelamento e falta são contados à parte, sem virar dinheiro", () => {
    const resumo = computeCrmSummary([
      atendimento({ startsAt: dia(1), priceMinor: 5000 }),
      atendimento({ status: "CANCELLED_BY_CUSTOMER", startsAt: dia(8), priceMinor: 5000 }),
      atendimento({ status: "CANCELLED_BY_SHOP", startsAt: dia(9), priceMinor: 5000 }),
      atendimento({ status: "NO_SHOW", startsAt: dia(15), priceMinor: 5000 }),
    ]);

    assert.equal(resumo.totalSpentMinor, 5000, "só o concluído entra na receita");
    assert.equal(resumo.completedVisitsCount, 1);
    assert.equal(resumo.cancelledCount, 2);
    assert.equal(resumo.noShowCount, 1);
  });

  test("remarcação não conta como cancelamento", () => {
    const resumo = computeCrmSummary([
      atendimento({ status: "RESCHEDULED", startsAt: dia(1) }),
      atendimento({ startsAt: dia(2) }),
    ]);
    assert.equal(resumo.cancelledCount, 0);
    assert.equal(resumo.completedVisitsCount, 1);
  });
});

describe("ordem da entrada", () => {
  test("histórico fora de ordem não altera o resultado", () => {
    const fora = computeCrmSummary([
      atendimento({ startsAt: dia(29) }),
      atendimento({ startsAt: dia(1) }),
      atendimento({ startsAt: dia(15) }),
    ]);

    assert.deepEqual(fora.firstVisitAt, dia(1));
    assert.deepEqual(fora.lastVisitAt, dia(29));
    assert.equal(fora.averageReturnDays, 14);
  });
});
