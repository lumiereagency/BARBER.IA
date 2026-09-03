// Conversão entre hora local da barbearia e instante absoluto (Parte 2 §7).
//
// A regra do produto: jornada de trabalho é hora de parede ("abro às 9h"),
// reserva é instante. Quem mistura os dois erra na virada de horário de verão —
// por isso nunca usamos offset fixo, sempre o fuso IANA da barbearia.
//
// Implementado sobre Intl, sem dependência externa. Se um dia a aritmética de
// fuso ficar mais complexa que isto, o caminho é trocar o miolo destas funções
// por uma biblioteca, mantendo a assinatura.

/// Offset do fuso, em minutos, no instante dado. Positivo a leste de Greenwich.
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  // Intl devolve 24 para meia-noite em algumas plataformas; normalizamos.
  const hour = get("hour") % 24;

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  );

  return (asUtc - instant.getTime()) / 60000;
}

/// Converte hora de parede + fuso em instante.
///
/// Duas passagens: a primeira estima o offset, a segunda corrige quando a
/// estimativa caiu do outro lado de uma virada de horário de verão.
///
/// Casos de fronteira, com convenção explícita:
/// - hora inexistente (relógio pula para frente): resolve para o instante logo
///   após a virada, então "2:30" numa madrugada que pula das 2 para as 3 vira 3:30;
/// - hora ambígua (relógio volta): resolve para a primeira ocorrência, a de
///   antes da virada.
export function zonedWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);

  // Dois candidatos: um usando o offset vigente antes da conversão, outro
  // usando o offset do próprio resultado. Fora de virada, os dois coincidem.
  const candidateA = new Date(asIfUtc - offsetMinutesAt(new Date(asIfUtc), timeZone) * 60000);
  const candidateB = new Date(asIfUtc - offsetMinutesAt(candidateA, timeZone) * 60000);

  // Escolher pelo que de fato reproduz a hora pedida, em vez de confiar na
  // ordem dos candidatos: numa virada de outono, 01:30 e 02:00 caem em
  // candidatos opostos, e fixar um deles quebraria o outro.
  const roundTrips = (candidate: Date) =>
    instantToLocalTime(candidate, timeZone) ===
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  if (roundTrips(candidateA)) return candidateA;
  if (roundTrips(candidateB)) return candidateB;

  // Nenhum reproduz: a hora não existe (o relógio pulou para frente). Convenção
  // documentada — resolver para depois da virada, nunca para antes, para que o
  // horário calculado jamais caia antes do que a barbearia configurou.
  return candidateA.getTime() > candidateB.getTime() ? candidateA : candidateB;
}

/// "YYYY-MM-DD" + "HH:MM" no fuso da barbearia -> instante.
export function localDateTimeToInstant(
  localDate: string,
  localTime: string,
  timeZone: string
): Date {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  const [hour, minute] = localTime.split(":").map(Number) as [number, number];
  return zonedWallTimeToInstant(year, month, day, hour, minute, timeZone);
}

/// Data civil ("YYYY-MM-DD") que um instante representa no fuso da barbearia.
/// É o que decide a qual dia da agenda uma reserva pertence — 23h em São Paulo
/// já é o dia seguinte em UTC, e a agenda do dono precisa mostrar o dia dele.
export function instantToLocalDate(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(instant);
}

/// Hora de parede ("HH:MM") de um instante no fuso da barbearia.
export function instantToLocalTime(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return formatter.format(instant);
}

/// Dia da semana (0 = domingo) de uma data civil no fuso da barbearia.
export function localDateWeekday(localDate: string, timeZone: string): number {
  const noon = localDateTimeToInstant(localDate, "12:00", timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(noon);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/// Sequência de datas civis, inclusiva nas duas pontas.
export function localDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60000);
}

export function parseLocalTimeToMinutes(localTime: string): number {
  const [hour, minute] = localTime.split(":").map(Number) as [number, number];
  return hour * 60 + minute;
}

export function minutesToLocalTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
