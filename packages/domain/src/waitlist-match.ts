// Casamento entre uma entrada da lista de espera e uma vaga da Agenda
// Inteligente (Marco 6.5).
//
// Função pura: os filtros que o cliente declarou (profissional, serviço,
// janela de data/hora) contra os dados já resolvidos da vaga. Comparação de
// data e hora locais é por string "YYYY-MM-DD"/"HH:mm" — ambos os formatos
// ordenam igual lexicograficamente e cronologicamente, então não precisa de
// Date para isso (mesma convenção do resto do domínio, ver availability.ts).

export interface WaitlistMatchFilters {
  /// Nulo = qualquer profissional serve
  professionalId: string | null;
  /// Nulo = qualquer serviço que caiba na vaga serve
  serviceId: string | null;
  /// Nulos = sem limite naquela ponta
  dateFrom: string | null;
  dateTo: string | null;
  timeRangeStart: string | null;
  timeRangeEnd: string | null;
}

export interface OpportunityForWaitlistMatch {
  professionalId: string;
  compatibleServiceIds: readonly string[];
  localDate: string;
  localTime: string;
}

export function waitlistEntryMatchesOpportunity(
  entry: WaitlistMatchFilters,
  opportunity: OpportunityForWaitlistMatch
): boolean {
  if (entry.professionalId && entry.professionalId !== opportunity.professionalId) return false;
  if (entry.serviceId && !opportunity.compatibleServiceIds.includes(entry.serviceId)) return false;
  if (entry.dateFrom && opportunity.localDate < entry.dateFrom) return false;
  if (entry.dateTo && opportunity.localDate > entry.dateTo) return false;
  if (entry.timeRangeStart && opportunity.localTime < entry.timeRangeStart) return false;
  if (entry.timeRangeEnd && opportunity.localTime > entry.timeRangeEnd) return false;
  return true;
}
