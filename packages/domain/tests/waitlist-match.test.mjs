import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { waitlistEntryMatchesOpportunity } from "../dist/waitlist-match.js";

const PRO_A = "11111111-1111-1111-1111-111111111111";
const PRO_B = "22222222-2222-2222-2222-222222222222";
const SERVICO_A = "33333333-3333-3333-3333-333333333333";
const SERVICO_B = "44444444-4444-4444-4444-444444444444";

const semFiltro = {
  professionalId: null,
  serviceId: null,
  dateFrom: null,
  dateTo: null,
  timeRangeStart: null,
  timeRangeEnd: null,
};

const vaga = {
  professionalId: PRO_A,
  compatibleServiceIds: [SERVICO_A],
  localDate: "2027-01-15",
  localTime: "10:00",
};

describe("waitlistEntryMatchesOpportunity", () => {
  test("sem nenhum filtro, qualquer vaga casa", () => {
    assert.equal(waitlistEntryMatchesOpportunity(semFiltro, vaga), true);
  });

  test("profissional diferente do pedido não casa", () => {
    assert.equal(
      waitlistEntryMatchesOpportunity({ ...semFiltro, professionalId: PRO_B }, vaga),
      false
    );
  });

  test("profissional igual ao pedido casa", () => {
    assert.equal(
      waitlistEntryMatchesOpportunity({ ...semFiltro, professionalId: PRO_A }, vaga),
      true
    );
  });

  test("serviço pedido fora da lista de compatíveis da vaga não casa", () => {
    assert.equal(waitlistEntryMatchesOpportunity({ ...semFiltro, serviceId: SERVICO_B }, vaga), false);
  });

  test("serviço pedido dentro da lista de compatíveis casa", () => {
    assert.equal(waitlistEntryMatchesOpportunity({ ...semFiltro, serviceId: SERVICO_A }, vaga), true);
  });

  test("data da vaga antes do início da janela não casa", () => {
    assert.equal(waitlistEntryMatchesOpportunity({ ...semFiltro, dateFrom: "2027-01-16" }, vaga), false);
  });

  test("data da vaga depois do fim da janela não casa", () => {
    assert.equal(waitlistEntryMatchesOpportunity({ ...semFiltro, dateTo: "2027-01-14" }, vaga), false);
  });

  test("data da vaga exatamente na borda da janela casa (inclusivo)", () => {
    assert.equal(
      waitlistEntryMatchesOpportunity({ ...semFiltro, dateFrom: "2027-01-15", dateTo: "2027-01-15" }, vaga),
      true
    );
  });

  test("hora da vaga fora da faixa pedida não casa", () => {
    assert.equal(
      waitlistEntryMatchesOpportunity({ ...semFiltro, timeRangeStart: "14:00" }, vaga),
      false
    );
    assert.equal(
      waitlistEntryMatchesOpportunity({ ...semFiltro, timeRangeEnd: "09:00" }, vaga),
      false
    );
  });

  test("hora da vaga dentro da faixa pedida casa", () => {
    assert.equal(
      waitlistEntryMatchesOpportunity(
        { ...semFiltro, timeRangeStart: "09:00", timeRangeEnd: "12:00" },
        vaga
      ),
      true
    );
  });
});
