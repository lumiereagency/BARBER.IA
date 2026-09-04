// Pontuação de retorno do cliente (Agenda Inteligente, Marco 6).
//
// Motor de regras, não IA generativa: cada fator é explícito, com peso fixo,
// e produz um motivo em português que o dono lê — nunca uma caixa preta.
// Funções puras, sem banco, para testar o motor sem depender de fixture.
//
// Dois estágios:
//  1. `computeReturnScore` — propensão geral de um cliente voltar, só com o
//     histórico dele (o que já vira `customer_return_scores`, recalculado
//     por job como o CRM). Não depende de nenhuma vaga específica.
//  2. `computeOpportunityMatch` — combina essa propensão com a compatibilidade
//     com UMA vaga (ou UMA entrada de lista de espera) específica, para
//     ordenar candidatos. É recomputado na hora, nunca fica em cache — a
//     vaga muda a cada chamada, o cliente não.

export interface ReturnScoreInput {
  completedVisitsCount: number;
  lastVisitAt: Date | null;
  averageReturnDays: number | null;
  noShowCount: number;
  cancelledCount: number;
}

export interface ScoreReason {
  code: string;
  /// Frase pronta para a tela, em português — não um código pra traduzir depois
  label: string;
}

export interface ReturnScoreResult {
  /// 0–100. Não é probabilidade calibrada — é ordenação, não previsão.
  score: number;
  reasons: ScoreReason[];
}

const DIA_MS = 86_400_000;

/// Cliente sem nenhum atendimento concluído não tem o que "recuperar": não há
/// padrão de retorno para medir. Quem chama decide se inclui esse caso na
/// lista (normalmente não faz sentido para a Agenda Inteligente).
export function computeReturnScore(
  input: ReturnScoreInput,
  now: Date = new Date()
): ReturnScoreResult {
  const reasons: ScoreReason[] = [];
  let score = 0;

  if (input.completedVisitsCount === 0 || input.lastVisitAt === null) {
    return {
      score: 0,
      reasons: [{ code: "sem_historico", label: "Ainda não teve atendimento concluído" }],
    };
  }

  // Vínculo: quem já voltou mais de uma vez tem um padrão de fato, não um
  // acaso — vale mais a pena investir em trazer de volta.
  if (input.completedVisitsCount >= 5) {
    score += 25;
    reasons.push({ code: "fidelizado", label: `Já veio ${input.completedVisitsCount} vezes` });
  } else if (input.completedVisitsCount >= 2) {
    score += 15;
    reasons.push({ code: "recorrente", label: `Já veio ${input.completedVisitsCount} vezes` });
  } else {
    score += 5;
    reasons.push({ code: "primeira_visita", label: "Veio uma vez" });
  }

  // O fator que mais pesa: está no momento em que costuma voltar?
  const diasDesdeUltimaVisita = (now.getTime() - input.lastVisitAt.getTime()) / DIA_MS;

  if (input.averageReturnDays !== null && input.averageReturnDays > 0) {
    const proporcao = diasDesdeUltimaVisita / input.averageReturnDays;
    if (proporcao >= 1.5) {
      score += 35;
      reasons.push({
        code: "atrasado",
        label: `Já passou do período que costuma voltar (a cada ${Math.round(input.averageReturnDays)} dias)`,
      });
    } else if (proporcao >= 0.8) {
      score += 30;
      reasons.push({
        code: "no_momento",
        label: `Está no período em que costuma voltar (a cada ${Math.round(input.averageReturnDays)} dias)`,
      });
    } else {
      reasons.push({
        code: "cedo_demais",
        label: "Ainda não chegou no período em que costuma voltar",
      });
    }
  } else {
    // Uma visita só: não existe padrão pessoal ainda. Sinal genérico e fraco,
    // rotulado como tal — não finge ser um padrão que não existe.
    if (diasDesdeUltimaVisita >= 20 && diasDesdeUltimaVisita <= 60) {
      score += 10;
      reasons.push({ code: "tempo_generico", label: "Faz um tempo desde a única visita" });
    }
  }

  // Faltar sem avisar pesa mais que cancelar: cancelar é ao menos comunicar.
  if (input.noShowCount > 0) {
    score -= Math.min(15, input.noShowCount * 8);
    reasons.push({
      code: "faltou",
      label: input.noShowCount === 1 ? "Já faltou uma vez sem avisar" : `Já faltou ${input.noShowCount} vezes sem avisar`,
    });
  }
  if (input.cancelledCount >= 3) {
    score -= 5;
    reasons.push({ code: "cancela_bastante", label: "Cancela com frequência" });
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

export interface OpportunityMatchInput {
  returnScore: ReturnScoreResult;
  /// Preferência inferida do CRM, ou declarada numa entrada de lista de
  /// espera — a mesma função serve as duas origens.
  preferredProfessionalId: string | null;
  preferredServiceId: string | null;
  opportunityProfessionalId: string;
  compatibleServiceIds: readonly string[];
}

/// Combina a propensão geral com a compatibilidade com UMA vaga. O resultado
/// serve para ordenar, não é um percentual — pode passar de 100.
export function computeOpportunityMatch(input: OpportunityMatchInput): ReturnScoreResult {
  let score = input.returnScore.score;
  const reasons = [...input.returnScore.reasons];

  if (input.preferredProfessionalId && input.preferredProfessionalId === input.opportunityProfessionalId) {
    score += 20;
    reasons.push({ code: "profissional_preferido", label: "Prefere este profissional" });
  }

  if (input.preferredServiceId && input.compatibleServiceIds.includes(input.preferredServiceId)) {
    score += 15;
    reasons.push({ code: "servico_preferido", label: "Já fez este serviço antes" });
  }

  return { score, reasons };
}
