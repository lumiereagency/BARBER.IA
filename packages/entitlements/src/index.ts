// Entitlement de plano para uma barbearia — a metade que fala com o banco. O
// cálculo em si (o que cada status/prazo permite) é puro e vive em
// packages/domain/src/entitlements.ts, testado sem banco.

import { prisma } from "@barber/db";
import { type PlanFeatures, parsePlanFeatures, subscriptionGrantsAccess } from "@barber/domain";

const NO_ACCESS: PlanFeatures = {
  smartAgenda: false,
  waitlist: false,
  advancedReports: false,
  baileys: false,
};

/// Recursos que a barbearia pode usar agora. Nunca lança: sem assinatura
/// (não deveria acontecer para uma barbearia criada pelo onboarding, mas uma
/// tela não pode quebrar por causa disso) é o mesmo que nenhum recurso Pro.
export async function barbershopFeatures(barbershopId: string): Promise<PlanFeatures> {
  const subscription = await prisma.subscription.findUnique({
    where: { barbershopId },
    include: { plan: { select: { features: true } } },
  });
  if (!subscription) return NO_ACCESS;

  const acesso = subscriptionGrantsAccess(subscription.status, subscription.currentPeriodEnd);
  if (!acesso) return NO_ACCESS;

  return parsePlanFeatures(subscription.plan.features);
}
