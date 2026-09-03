// Cálculo do CRM automático (Parte 1 §14).
//
// Função pura: recebe o histórico de atendimentos de UMA relação
// cliente–barbearia e devolve os indicadores. Não fala com banco, o que permite
// testar as regras difíceis — sobretudo a que mais importa aqui:
//
//   dado insuficiente fica desconhecido. Nunca inventamos previsão.
//
// Um cliente com uma visita só não tem "frequência média": ele tem uma visita.
// Devolver 30 dias porque "é o comum" seria fabricar informação que o dono
// usaria para decidir.

export interface CrmAppointment {
  status: "CONFIRMED" | "COMPLETED" | "NO_SHOW" | "CANCELLED_BY_CUSTOMER" | "CANCELLED_BY_SHOP" | "RESCHEDULED";
  startsAt: Date;
  priceMinor: number;
  professionalId: string;
  serviceId: string;
}

export interface CrmSummary {
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  completedVisitsCount: number;
  cancelledCount: number;
  noShowCount: number;
  totalSpentMinor: number;
  /// Nulo com zero atendimentos concluídos
  averageTicketMinor: number | null;
  /// Nulo com menos de dois atendimentos: não existe intervalo para medir
  averageReturnDays: number | null;
  /// Nulo quando não há preferência clara
  preferredProfessionalId: string | null;
  preferredServiceId: string | null;
  /// Nulo quando não há frequência para projetar
  nextReturnEstimate: Date | null;
}

/// Moda com desempate determinístico: sem critério de desempate, o "preferido"
/// mudaria a cada recálculo quando houvesse empate.
function mostFrequent(values: string[]): string | null {
  if (values.length === 0) return null;

  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let melhor: string | null = null;
  let melhorContagem = 0;

  for (const [value, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > melhorContagem) {
      melhor = value;
      melhorContagem = count;
    }
  }

  // Preferência exige repetição: com uma visita só, não há preferência, há
  // apenas o que aconteceu daquela vez.
  return melhorContagem >= 2 ? melhor : null;
}

export function computeCrmSummary(
  appointments: readonly CrmAppointment[],
  now: Date = new Date()
): CrmSummary {
  const concluidos = appointments
    .filter((item) => item.status === "COMPLETED")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const cancelledCount = appointments.filter(
    (item) => item.status === "CANCELLED_BY_CUSTOMER" || item.status === "CANCELLED_BY_SHOP"
  ).length;
  const noShowCount = appointments.filter((item) => item.status === "NO_SHOW").length;

  const totalSpentMinor = concluidos.reduce((total, item) => total + item.priceMinor, 0);

  const firstVisitAt = concluidos[0]?.startsAt ?? null;
  const lastVisitAt = concluidos.at(-1)?.startsAt ?? null;

  const averageTicketMinor =
    concluidos.length > 0 ? Math.round(totalSpentMinor / concluidos.length) : null;

  // Frequência precisa de pelo menos dois atendimentos: um intervalo exige
  // duas pontas.
  let averageReturnDays: number | null = null;
  if (concluidos.length >= 2) {
    const primeiro = concluidos[0]!.startsAt.getTime();
    const ultimo = concluidos.at(-1)!.startsAt.getTime();
    const intervalos = concluidos.length - 1;
    averageReturnDays = Math.round(((ultimo - primeiro) / intervalos / 864e5) * 10) / 10;
  }

  const nextReturnEstimate =
    averageReturnDays !== null && lastVisitAt !== null && averageReturnDays > 0
      ? new Date(lastVisitAt.getTime() + averageReturnDays * 864e5)
      : null;

  void now;

  return {
    firstVisitAt,
    lastVisitAt,
    completedVisitsCount: concluidos.length,
    cancelledCount,
    noShowCount,
    totalSpentMinor,
    averageTicketMinor,
    averageReturnDays,
    preferredProfessionalId: mostFrequent(concluidos.map((item) => item.professionalId)),
    preferredServiceId: mostFrequent(concluidos.map((item) => item.serviceId)),
    nextReturnEstimate,
  };
}
