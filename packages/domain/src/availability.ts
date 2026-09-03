// Motor de disponibilidade (Parte 1 §12).
//
// Função pura: recebe jornada, exceções, bloqueios e ocupação já carregados, e
// devolve os horários oferecíveis. Não fala com banco — é o que permite testar
// virada de dia, horário de verão e buffers sem infraestrutura.
//
// O que ele combina, na ordem: jornada semanal vigente -> exceções da data ->
// duração e buffers do serviço -> ocupação existente -> antecedência mínima ->
// janela máxima de agendamento.

import {
  addMinutes,
  instantToLocalDate,
  localDateRange,
  localDateTimeToInstant,
  localDateWeekday,
  minutesToLocalTime,
  parseLocalTimeToMinutes,
} from "./time.js";

export interface WorkingHoursRule {
  weekday: number; // 0 = domingo
  startLocalTime: string; // "09:00"
  endLocalTime: string; // "18:00"
  effectiveFrom?: string | null; // "YYYY-MM-DD"
  effectiveTo?: string | null;
}

export interface ScheduleExceptionRule {
  startDate: string;
  endDate: string;
  type: "AVAILABLE" | "UNAVAILABLE" | "VACATION";
  /// Nulos = dia inteiro
  startLocalTime?: string | null;
  endLocalTime?: string | null;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface ProfessionalAvailabilityInput {
  professionalId: string;
  displayName: string;
  bookingPriority: number;
  /// Preço e duração efetivos: o próprio do profissional quando existe,
  /// senão o padrão do serviço
  priceMinor: number;
  durationMinutes: number;
  workingHours: WorkingHoursRule[];
  exceptions: ScheduleExceptionRule[];
  /// Agendamentos que ocupam, holds ativos e bloqueios — já como footprint,
  /// isto é, com os buffers de quem ocupa já incluídos
  busy: Interval[];
}

export interface AvailabilityInput {
  timeZone: string;
  from: string; // data civil inclusiva
  to: string; // data civil inclusiva
  now: Date;
  slotGranularityMinutes: number;
  minimumNoticeMinutes: number;
  bookingWindowDays: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  professionals: ProfessionalAvailabilityInput[];
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  /// Footprint que este slot ocupará se virar reserva
  occupiesFrom: Date;
  occupiesTo: Date;
  professionalId: string;
  professionalName: string;
  priceMinor: number;
}

export interface AvailabilityDay {
  date: string;
  slots: Slot[];
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/// Janelas de trabalho de um profissional numa data civil, em minutos locais.
function workingWindowsFor(
  professional: ProfessionalAvailabilityInput,
  date: string,
  timeZone: string
): Array<{ startMinutes: number; endMinutes: number }> {
  const weekday = localDateWeekday(date, timeZone);

  const base = professional.workingHours
    .filter((rule) => rule.weekday === weekday)
    .filter((rule) => !rule.effectiveFrom || rule.effectiveFrom <= date)
    .filter((rule) => !rule.effectiveTo || rule.effectiveTo >= date)
    .map((rule) => ({
      startMinutes: parseLocalTimeToMinutes(rule.startLocalTime),
      endMinutes: parseLocalTimeToMinutes(rule.endLocalTime),
    }));

  const applicable = professional.exceptions.filter(
    (exception) => exception.startDate <= date && exception.endDate >= date
  );

  // Exceções AVAILABLE abrem janela extra (ex.: abrir num feriado)
  const extra = applicable
    .filter((exception) => exception.type === "AVAILABLE")
    .map((exception) => ({
      startMinutes: parseLocalTimeToMinutes(exception.startLocalTime ?? "00:00"),
      endMinutes: parseLocalTimeToMinutes(exception.endLocalTime ?? "24:00"),
    }));

  let windows = [...base, ...extra];

  // Folga e férias recortam. Sem hora definida, tiram o dia inteiro.
  for (const exception of applicable) {
    if (exception.type === "AVAILABLE") continue;

    const blockStart = parseLocalTimeToMinutes(exception.startLocalTime ?? "00:00");
    const blockEnd = parseLocalTimeToMinutes(exception.endLocalTime ?? "24:00");

    windows = windows.flatMap((window) => {
      if (blockEnd <= window.startMinutes || blockStart >= window.endMinutes) return [window];

      const remaining: Array<{ startMinutes: number; endMinutes: number }> = [];
      if (blockStart > window.startMinutes) {
        remaining.push({ startMinutes: window.startMinutes, endMinutes: blockStart });
      }
      if (blockEnd < window.endMinutes) {
        remaining.push({ startMinutes: blockEnd, endMinutes: window.endMinutes });
      }
      return remaining;
    });
  }

  return windows
    .filter((window) => window.endMinutes > window.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

export function computeAvailability(input: AvailabilityInput): AvailabilityDay[] {
  const earliestStart = addMinutes(input.now, input.minimumNoticeMinutes);
  const latestStart = addMinutes(input.now, input.bookingWindowDays * 24 * 60);

  return localDateRange(input.from, input.to).map((date) => {
    const slots: Slot[] = [];

    for (const professional of input.professionals) {
      const windows = workingWindowsFor(professional, date, input.timeZone);

      for (const window of windows) {
        for (
          let startMinutes = window.startMinutes;
          startMinutes + professional.durationMinutes <= window.endMinutes;
          startMinutes += input.slotGranularityMinutes
        ) {
          // A hora de parede é convertida por dia: em virada de horário de
          // verão, o mesmo "09:00" cai em instantes UTC diferentes.
          const startsAt = localDateTimeToInstant(
            date,
            minutesToLocalTime(startMinutes),
            input.timeZone
          );
          const endsAt = addMinutes(startsAt, professional.durationMinutes);

          // Um slot só é oferecido no dia a que de fato pertence: numa virada
          // de fuso, a conversão pode empurrar a hora para o dia seguinte.
          if (instantToLocalDate(startsAt, input.timeZone) !== date) continue;

          if (startsAt < earliestStart) continue;
          if (startsAt > latestStart) continue;

          // O footprint inclui os buffers do serviço que seria agendado aqui
          const occupiesFrom = addMinutes(startsAt, -input.bufferBeforeMinutes);
          const occupiesTo = addMinutes(endsAt, input.bufferAfterMinutes);

          const conflicts = professional.busy.some((busy) =>
            overlaps({ start: occupiesFrom, end: occupiesTo }, busy)
          );
          if (conflicts) continue;

          slots.push({
            startsAt,
            endsAt,
            occupiesFrom,
            occupiesTo,
            professionalId: professional.professionalId,
            professionalName: professional.displayName,
            priceMinor: professional.priceMinor,
          });
        }
      }
    }

    slots.sort(
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() ||
        a.professionalId.localeCompare(b.professionalId)
    );

    return { date, slots };
  });
}

/// "Qualquer profissional": escolhe um por horário, de forma determinística.
///
/// Critério, nesta ordem: menor booking_priority configurado pelo dono, depois
/// id — nunca aleatório, para que recarregar a página não troque o profissional
/// mostrado ao cliente (Parte 1 §12).
export function resolveAnyProfessional(
  days: AvailabilityDay[],
  priorityById: ReadonlyMap<string, number>
): AvailabilityDay[] {
  return days.map((day) => {
    const byStart = new Map<number, Slot>();

    for (const slot of day.slots) {
      const key = slot.startsAt.getTime();
      const current = byStart.get(key);
      if (!current) {
        byStart.set(key, slot);
        continue;
      }

      const currentPriority = priorityById.get(current.professionalId) ?? 0;
      const candidatePriority = priorityById.get(slot.professionalId) ?? 0;

      if (
        candidatePriority < currentPriority ||
        (candidatePriority === currentPriority &&
          slot.professionalId.localeCompare(current.professionalId) < 0)
      ) {
        byStart.set(key, slot);
      }
    }

    return {
      date: day.date,
      slots: [...byStart.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    };
  });
}

/// Horários mais próximos de um alvo, para responder a perda de slot com
/// alternativas em vez de só recusar (Parte 1 §8).
export function nearestSlots(days: AvailabilityDay[], target: Date, limit = 3): Slot[] {
  return days
    .flatMap((day) => day.slots)
    .sort(
      (a, b) =>
        Math.abs(a.startsAt.getTime() - target.getTime()) -
        Math.abs(b.startsAt.getTime() - target.getTime())
    )
    .slice(0, limit);
}
