import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeAvailability,
  resolveAnyProfessional,
  nearestSlots,
} from "../dist/availability.js";
import { localDateTimeToInstant, instantToLocalTime } from "../dist/time.js";

const SP = "America/Sao_Paulo";
const at = (date, time, tz = SP) => localDateTimeToInstant(date, time, tz);

// 2026-09-10 é uma quinta-feira
const QUINTA = "2026-09-10";

function professional(overrides = {}) {
  return {
    professionalId: "p1",
    displayName: "Matheus",
    bookingPriority: 0,
    priceMinor: 5000,
    durationMinutes: 30,
    workingHours: [{ weekday: 4, startLocalTime: "09:00", endLocalTime: "12:00" }],
    exceptions: [],
    busy: [],
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    timeZone: SP,
    from: QUINTA,
    to: QUINTA,
    now: at("2026-09-01", "08:00"),
    slotGranularityMinutes: 30,
    minimumNoticeMinutes: 0,
    bookingWindowDays: 60,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    professionals: [professional()],
    ...overrides,
  };
}

const times = (days, tz = SP) => days[0].slots.map((s) => instantToLocalTime(s.startsAt, tz));

describe("jornada de trabalho", () => {
  test("gera a grade dentro da jornada", () => {
    assert.deepEqual(times(computeAvailability(input())), [
      "09:00",
      "09:30",
      "10:00",
      "10:30",
      "11:00",
      "11:30",
    ]);
  });

  test("não oferece horário que ultrapasse o fim da jornada", () => {
    const days = computeAvailability(
      input({ professionals: [professional({ durationMinutes: 45 })] })
    );
    // Nenhum atendimento pode terminar depois das 12:00 — é a invariante que
    // importa, não qual é o último horário da grade
    for (const slot of days[0].slots) {
      assert.ok(
        instantToLocalTime(slot.endsAt, SP) <= "12:00",
        `${instantToLocalTime(slot.startsAt, SP)} terminaria ${instantToLocalTime(slot.endsAt, SP)}`
      );
    }
    // Com passo de 30 min, o último que cabe começa 11:00 e termina 11:45
    assert.equal(times(days).at(-1), "11:00");
  });

  test("dia sem jornada não oferece nada", () => {
    // 2026-09-13 é domingo, e a jornada é só quinta
    const days = computeAvailability(input({ from: "2026-09-13", to: "2026-09-13" }));
    assert.equal(days[0].slots.length, 0);
  });

  test("jornada fora de vigência é ignorada", () => {
    const days = computeAvailability(
      input({
        professionals: [
          professional({
            workingHours: [
              {
                weekday: 4,
                startLocalTime: "09:00",
                endLocalTime: "12:00",
                effectiveTo: "2026-09-01",
              },
            ],
          }),
        ],
      })
    );
    assert.equal(days[0].slots.length, 0);
  });
});

describe("exceções e bloqueios", () => {
  test("folga de dia inteiro zera a agenda", () => {
    const days = computeAvailability(
      input({
        professionals: [
          professional({
            exceptions: [{ startDate: QUINTA, endDate: QUINTA, type: "UNAVAILABLE" }],
          }),
        ],
      })
    );
    assert.equal(days[0].slots.length, 0);
  });

  test("férias cobrindo o período zera a agenda", () => {
    const days = computeAvailability(
      input({
        professionals: [
          professional({
            exceptions: [
              { startDate: "2026-09-07", endDate: "2026-09-14", type: "VACATION" },
            ],
          }),
        ],
      })
    );
    assert.equal(days[0].slots.length, 0);
  });

  test("folga parcial recorta só o trecho", () => {
    const days = computeAvailability(
      input({
        professionals: [
          professional({
            exceptions: [
              {
                startDate: QUINTA,
                endDate: QUINTA,
                type: "UNAVAILABLE",
                startLocalTime: "10:00",
                endLocalTime: "11:00",
              },
            ],
          }),
        ],
      })
    );
    assert.deepEqual(times(days), ["09:00", "09:30", "11:00", "11:30"]);
  });

  test("exceção AVAILABLE abre dia que não teria jornada", () => {
    const days = computeAvailability(
      input({
        from: "2026-09-13",
        to: "2026-09-13", // domingo
        professionals: [
          professional({
            exceptions: [
              {
                startDate: "2026-09-13",
                endDate: "2026-09-13",
                type: "AVAILABLE",
                startLocalTime: "10:00",
                endLocalTime: "11:00",
              },
            ],
          }),
        ],
      })
    );
    assert.deepEqual(times(days), ["10:00", "10:30"]);
  });

  test("ocupação existente remove o horário", () => {
    const days = computeAvailability(
      input({
        professionals: [
          professional({
            busy: [{ start: at(QUINTA, "10:00"), end: at(QUINTA, "10:30") }],
          }),
        ],
      })
    );
    assert.ok(!times(days).includes("10:00"));
    assert.ok(times(days).includes("09:30"));
  });
});

describe("buffers", () => {
  test("buffer antes impede encaixe colado ao compromisso anterior", () => {
    const days = computeAvailability(
      input({
        bufferBeforeMinutes: 15,
        professionals: [
          professional({
            busy: [{ start: at(QUINTA, "09:00"), end: at(QUINTA, "09:30") }],
          }),
        ],
      })
    );
    // 09:30 exigiria estar livre desde 09:15, e 09:15 está ocupado
    assert.ok(!times(days).includes("09:30"));
    assert.ok(times(days).includes("10:00"));
  });

  test("buffer depois protege o fim do atendimento", () => {
    const days = computeAvailability(
      input({
        bufferAfterMinutes: 15,
        professionals: [
          professional({
            busy: [{ start: at(QUINTA, "10:30"), end: at(QUINTA, "11:00") }],
          }),
        ],
      })
    );
    // 10:00 termina 10:30 e precisaria de folga até 10:45, que está ocupada
    assert.ok(!times(days).includes("10:00"));
    assert.ok(times(days).includes("09:30"));
  });

  test("footprint devolvido inclui os buffers", () => {
    const days = computeAvailability(input({ bufferBeforeMinutes: 10, bufferAfterMinutes: 20 }));
    const slot = days[0].slots[0];
    assert.equal(instantToLocalTime(slot.occupiesFrom, SP), "08:50");
    assert.equal(instantToLocalTime(slot.startsAt, SP), "09:00");
    assert.equal(instantToLocalTime(slot.endsAt, SP), "09:30");
    assert.equal(instantToLocalTime(slot.occupiesTo, SP), "09:50");
  });
});

describe("antecedência e janela", () => {
  test("antecedência mínima corta os horários próximos demais", () => {
    const days = computeAvailability(
      input({ now: at(QUINTA, "09:00"), minimumNoticeMinutes: 60 })
    );
    // Antes das 10:00 não é oferecido
    assert.deepEqual(times(days), ["10:00", "10:30", "11:00", "11:30"]);
  });

  test("janela máxima corta datas distantes", () => {
    const days = computeAvailability(
      input({ now: at("2026-09-01", "08:00"), bookingWindowDays: 5 })
    );
    assert.equal(days[0].slots.length, 0);
  });
});

describe("horário de verão", () => {
  const NY = "America/New_York";

  test("a jornada continua começando às 9h nos dois lados da virada", () => {
    const dias = computeAvailability({
      ...input(),
      timeZone: NY,
      from: "2026-03-07",
      to: "2026-03-09",
      now: at("2026-03-01", "08:00", NY),
      professionals: [
        professional({
          // sábado, domingo e segunda
          workingHours: [
            { weekday: 6, startLocalTime: "09:00", endLocalTime: "10:00" },
            { weekday: 0, startLocalTime: "09:00", endLocalTime: "10:00" },
            { weekday: 1, startLocalTime: "09:00", endLocalTime: "10:00" },
          ],
        }),
      ],
    });

    for (const dia of dias) {
      assert.equal(dia.slots.length, 2, `${dia.date} deveria ter 2 horários`);
      assert.equal(instantToLocalTime(dia.slots[0].startsAt, NY), "09:00");
    }

    // O sábado ainda é EST (-5); a virada acontece às 2h de domingo, então às
    // 9h do próprio domingo já vale EDT (-4). Em UTC a mesma "9h" muda de
    // instante — que é exatamente o que offset fixo erraria.
    assert.equal(dias[0].slots[0].startsAt.toISOString(), "2026-03-07T14:00:00.000Z");
    assert.equal(dias[1].slots[0].startsAt.toISOString(), "2026-03-08T13:00:00.000Z");
    assert.equal(dias[2].slots[0].startsAt.toISOString(), "2026-03-09T13:00:00.000Z");
  });
});

describe("qualquer profissional", () => {
  const doisProfissionais = input({
    professionals: [
      professional({ professionalId: "p2", displayName: "Rafael", bookingPriority: 5 }),
      professional({ professionalId: "p1", displayName: "Matheus", bookingPriority: 1 }),
    ],
  });

  test("escolhe um por horário, pela prioridade configurada", () => {
    const dias = resolveAnyProfessional(
      computeAvailability(doisProfissionais),
      new Map([
        ["p1", 1],
        ["p2", 5],
      ])
    );
    assert.equal(dias[0].slots.length, 6);
    for (const slot of dias[0].slots) {
      assert.equal(slot.professionalId, "p1");
    }
  });

  test("é determinístico: mesma entrada, mesma escolha", () => {
    const prioridades = new Map([
      ["p1", 0],
      ["p2", 0],
    ]);
    const primeira = resolveAnyProfessional(computeAvailability(doisProfissionais), prioridades);
    const segunda = resolveAnyProfessional(computeAvailability(doisProfissionais), prioridades);
    assert.deepEqual(
      primeira[0].slots.map((s) => s.professionalId),
      segunda[0].slots.map((s) => s.professionalId)
    );
  });

  test("cai para outro profissional quando o preferido está ocupado", () => {
    const dias = resolveAnyProfessional(
      computeAvailability(
        input({
          professionals: [
            professional({ professionalId: "p1", bookingPriority: 1,
              busy: [{ start: at(QUINTA, "09:00"), end: at(QUINTA, "09:30") }] }),
            professional({ professionalId: "p2", displayName: "Rafael", bookingPriority: 5 }),
          ],
        })
      ),
      new Map([["p1", 1], ["p2", 5]])
    );
    assert.equal(dias[0].slots[0].professionalId, "p2");
    assert.equal(instantToLocalTime(dias[0].slots[0].startsAt, SP), "09:00");
  });
});

describe("alternativas quando o horário é perdido", () => {
  test("devolve os mais próximos do alvo", () => {
    const dias = computeAvailability(input());
    const proximos = nearestSlots(dias, at(QUINTA, "10:20"), 2);
    assert.deepEqual(
      proximos.map((s) => instantToLocalTime(s.startsAt, SP)),
      ["10:30", "10:00"]
    );
  });
});
