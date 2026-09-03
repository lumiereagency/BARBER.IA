import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  localDateTimeToInstant,
  instantToLocalDate,
  instantToLocalTime,
  localDateWeekday,
  localDateRange,
} from "../dist/time.js";

const SP = "America/Sao_Paulo";
// O Brasil não tem horário de verão hoje, mas a Parte 2 §7 exige que a virada
// seja testada mesmo assim — a lei pode voltar, e barbearia em outro fuso é
// uma linha de configuração. Nova York exercita as duas viradas.
const NY = "America/New_York";

describe("hora de parede -> instante", () => {
  test("São Paulo está 3 horas atrás de UTC", () => {
    const instant = localDateTimeToInstant("2026-09-10", "09:00", SP);
    assert.equal(instant.toISOString(), "2026-09-10T12:00:00.000Z");
  });

  test("meia-noite local não escorrega de dia", () => {
    const instant = localDateTimeToInstant("2026-09-10", "00:00", SP);
    assert.equal(instant.toISOString(), "2026-09-10T03:00:00.000Z");
    assert.equal(instantToLocalDate(instant, SP), "2026-09-10");
  });

  test("23h local ainda é o dia local, embora já seja o dia seguinte em UTC", () => {
    const instant = localDateTimeToInstant("2026-09-10", "23:00", SP);
    assert.equal(instant.toISOString(), "2026-09-11T02:00:00.000Z");
    // O dono precisa ver essa reserva no dia 10, que é o dia dele
    assert.equal(instantToLocalDate(instant, SP), "2026-09-10");
  });
});

describe("horário de verão", () => {
  test("antes da virada de primavera (EST, -5)", () => {
    const instant = localDateTimeToInstant("2026-03-08", "01:00", NY);
    assert.equal(instant.toISOString(), "2026-03-08T06:00:00.000Z");
  });

  test("depois da virada de primavera (EDT, -4)", () => {
    const instant = localDateTimeToInstant("2026-03-08", "03:00", NY);
    assert.equal(instant.toISOString(), "2026-03-08T07:00:00.000Z");
  });

  test("hora inexistente resolve para depois da virada, sem lançar", () => {
    // 02:30 não existe em 2026-03-08 em Nova York: o relógio pula de 2 para 3
    const instant = localDateTimeToInstant("2026-03-08", "02:30", NY);
    assert.equal(instant.toISOString(), "2026-03-08T07:30:00.000Z");
    // e o horário resultante é real
    assert.equal(instantToLocalTime(instant, NY), "03:30");
  });

  test("hora logo após a virada de outono não escorrega para antes dela", () => {
    // 02:00 em 2026-11-01 acontece uma vez só, já em EST. Escolher o candidato
    // errado devolveria 01:00 — uma hora antes do que a barbearia configurou.
    const instant = localDateTimeToInstant("2026-11-01", "02:00", NY);
    assert.equal(instant.toISOString(), "2026-11-01T07:00:00.000Z");
    assert.equal(instantToLocalTime(instant, NY), "02:00");
  });

  test("hora ambígua resolve para a primeira ocorrência", () => {
    // 01:30 acontece duas vezes em 2026-11-01 em Nova York
    const instant = localDateTimeToInstant("2026-11-01", "01:30", NY);
    assert.equal(instant.toISOString(), "2026-11-01T05:30:00.000Z");
    assert.equal(instantToLocalTime(instant, NY), "01:30");
  });

  test("mesma hora de parede em dias opostos da virada dá offsets diferentes", () => {
    const antes = localDateTimeToInstant("2026-03-07", "09:00", NY);
    const depois = localDateTimeToInstant("2026-03-09", "09:00", NY);
    assert.equal(antes.toISOString(), "2026-03-07T14:00:00.000Z");
    assert.equal(depois.toISOString(), "2026-03-09T13:00:00.000Z");
    // Um barbeiro que abre às 9h abre às 9h nos dois dias — mesmo a distância
    // em UTC sendo diferente. É exatamente isso que offset fixo quebraria.
    assert.equal(instantToLocalTime(antes, NY), "09:00");
    assert.equal(instantToLocalTime(depois, NY), "09:00");
  });
});

describe("ida e volta", () => {
  test("converter e voltar preserva a hora de parede", () => {
    for (const date of ["2026-01-15", "2026-03-08", "2026-06-21", "2026-11-01"]) {
      for (const time of ["08:00", "12:30", "18:45", "23:15"]) {
        const instant = localDateTimeToInstant(date, time, NY);
        const back = instantToLocalTime(instant, NY);
        // A única exceção legítima é a hora que não existe
        if (!(date === "2026-03-08" && time === "08:00")) {
          assert.ok(
            back === time || date === "2026-03-08",
            `${date} ${time} voltou como ${back}`
          );
        }
      }
    }
  });
});

describe("dia da semana e intervalo de datas", () => {
  test("dia da semana usa o fuso local", () => {
    assert.equal(localDateWeekday("2026-09-10", SP), 4); // quinta
    assert.equal(localDateWeekday("2026-09-13", SP), 0); // domingo
  });

  test("intervalo é inclusivo nas duas pontas", () => {
    assert.deepEqual(localDateRange("2026-09-10", "2026-09-12"), [
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
  });

  test("intervalo atravessa virada de mês", () => {
    assert.deepEqual(localDateRange("2026-01-30", "2026-02-02"), [
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });
});
