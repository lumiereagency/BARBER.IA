// Entitlements de plano (Parte 1 §2, Parte 3 §19 #7).
//
// Duas checagens independentes decidem se alguém vê um recurso Pro: RBAC
// (este papel pode esta ação?) e entitlement (o plano desta barbearia inclui
// o recurso?). As duas moram em módulos diferentes de propósito — trocar de
// plano nunca deveria mexer em permissão de equipe, e vice-versa.

export interface PlanFeatures {
  smartAgenda: boolean;
  waitlist: boolean;
  advancedReports: boolean;
  baileys: boolean;
}

const DEFAULT_FEATURES: PlanFeatures = {
  smartAgenda: false,
  waitlist: false,
  advancedReports: false,
  baileys: false,
};

/// `Plan.features` é `Json` no banco — forma nenhuma é garantida na borda.
/// Um plano mal cadastrado vira "sem recurso nenhum", nunca um erro de runtime.
export function parsePlanFeatures(raw: unknown): PlanFeatures {
  if (typeof raw !== "object" || raw === null) return DEFAULT_FEATURES;
  const obj = raw as Record<string, unknown>;
  return {
    smartAgenda: obj.smartAgenda === true,
    waitlist: obj.waitlist === true,
    advancedReports: obj.advancedReports === true,
    baileys: obj.baileys === true,
  };
}

/// Trial vencido sem virar assinatura ativa não deveria continuar dando
/// acesso — mas isso só importa quando o Marco 7 (cobrança) existir para
/// vencer um trial de verdade. Até lá, `currentPeriodEnd` nulo é "sem prazo".
export function subscriptionGrantsAccess(
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED",
  currentPeriodEnd: Date | null,
  now: Date = new Date()
): boolean {
  if (status === "ACTIVE") return true;
  if (status === "TRIALING") return currentPeriodEnd === null || currentPeriodEnd > now;
  return false;
}
