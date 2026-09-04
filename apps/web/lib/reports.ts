// Relatório avançado da Agenda Inteligente (Marco 6.7, plano Pro).
//
// Só agrega o que já existe e já foi provado nos módulos anteriores — nenhum
// número aqui é estimado ou inferido além do que os próprios registros dizem.
// Receita recuperada usa o preço REAL do agendamento reivindicado, não a
// estimativa gravada na detecção: quem reivindica pode escolher um serviço
// diferente do que liberou a vaga, dentre os compatíveis (Marco 6.4).

import { prisma } from "@barber/db";

export interface SmartAgendaReport {
  periodo: { from: Date; to: Date; dias: number };
  vagas: {
    detectadas: number;
    preenchidas: number;
    expiradas: number;
    /// Nulo quando nenhuma vaga do período ainda se resolveu (nem preenchida
    /// nem expirada) — não inventamos uma taxa sem dado.
    taxaPreenchimento: number | null;
    receitaRecuperadaMinor: number;
  };
  listaEspera: {
    esperandoAgora: number;
    entradasNoPeriodo: number;
  };
  /// Clientes cujo motivo de pontuação inclui "atrasado" (Marco 6.2) — quem
  /// já passou do próprio período de retorno e vale a pena contatar.
  clientesAtrasados: Array<{
    barbershopCustomerId: string;
    nome: string;
    telefone: string;
    score: number;
  }>;
}

export async function computeSmartAgendaReport(
  barbershopId: string,
  dias = 30
): Promise<SmartAgendaReport> {
  const to = new Date();
  const from = new Date(to.getTime() - dias * 86_400_000);
  const periodo = { gte: from, lte: to };

  const [detectadas, preenchidas, expiradas, esperandoAgora, entradasNoPeriodo, pontuacoes] =
    await Promise.all([
      prisma.smartOpportunity.count({ where: { barbershopId, createdAt: periodo } }),
      prisma.smartOpportunity.findMany({
        where: { barbershopId, status: "FILLED", createdAt: periodo },
        select: {
          estimatedRevenueMinor: true,
          claimedAppointment: { select: { priceSnapshotMinor: true } },
        },
      }),
      prisma.smartOpportunity.count({ where: { barbershopId, status: "EXPIRED", createdAt: periodo } }),
      prisma.waitlistEntry.count({ where: { barbershopId, status: "WAITING" } }),
      prisma.waitlistEntry.count({ where: { barbershopId, createdAt: periodo } }),
      prisma.customerReturnScore.findMany({
        where: { barbershopId },
        include: { barbershopCustomer: { select: { currentName: true, normalizedPhone: true } } },
        orderBy: { score: "desc" },
      }),
    ]);

  const totalResolvidas = preenchidas.length + expiradas;
  const receitaRecuperadaMinor = preenchidas.reduce(
    (soma, vaga) => soma + (vaga.claimedAppointment?.priceSnapshotMinor ?? vaga.estimatedRevenueMinor),
    0
  );

  const clientesAtrasados = pontuacoes
    .filter((linha) =>
      (linha.reasons as Array<{ code: string }> | null)?.some((motivo) => motivo.code === "atrasado")
    )
    .slice(0, 10)
    .map((linha) => ({
      barbershopCustomerId: linha.barbershopCustomerId,
      nome: linha.barbershopCustomer.currentName,
      telefone: linha.barbershopCustomer.normalizedPhone,
      score: linha.score,
    }));

  return {
    periodo: { from, to, dias },
    vagas: {
      detectadas,
      preenchidas: preenchidas.length,
      expiradas,
      taxaPreenchimento: totalResolvidas === 0 ? null : preenchidas.length / totalResolvidas,
      receitaRecuperadaMinor,
    },
    listaEspera: { esperandoAgora, entradasNoPeriodo },
    clientesAtrasados,
  };
}
