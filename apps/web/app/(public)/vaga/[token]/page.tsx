import { notFound } from "next/navigation";
import { prisma } from "@barber/db";
import { instantToLocalDate, instantToLocalTime } from "@barber/domain";
import { findOpenOpportunityByToken } from "@/lib/smart-opportunity";
import { VagaClaimForm } from "@/components/vaga-claim-form";

export const dynamic = "force-dynamic";

/// A janela oferecida é exclusivamente a que o cancelamento liberou — abrir a
/// página nunca reserva nada (Parte 1 §13.3; docs/tech-review-part2.md §3.5).
export default async function SmartOpportunityPage({ params }: { params: { token: string } }) {
  const opportunity = await findOpenOpportunityByToken(params.token);
  if (!opportunity) notFound();

  const disponivel = opportunity.status === "OPEN" && opportunity.expiresAt > new Date();

  const services = disponivel
    ? await prisma.service.findMany({
        where: {
          id: { in: opportunity.compatibleServiceIds },
          barbershopId: opportunity.barbershopId,
          active: true,
        },
        orderBy: { publicOrder: "asc" },
      })
    : [];

  const shop = opportunity.barbershop;
  const localDate = instantToLocalDate(opportunity.startsAt, shop.timezone);
  const localTime = instantToLocalTime(opportunity.startsAt, shop.timezone);
  const dayLabel = new Date(`${localDate}T12:00:00Z`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <main className="relative mx-auto min-h-screen max-w-lg overflow-hidden bg-surface-1 px-5 py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(255,90,31,.28), transparent 70%)" }}
      />

      <header className="relative mb-6">
        <p className="text-sm text-ink-secondary">{shop.name}</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Vaga disponível</h1>
      </header>

      <section
        className={`relative rounded-xl p-5 ${disponivel ? "bg-brand-500/12" : "bg-surface-2"}`}
      >
        <p className="text-sm font-medium uppercase tracking-wide text-ink-secondary">
          {disponivel ? "Horário aberto por cancelamento" : "Vaga indisponível"}
        </p>
        <p className="mt-2 text-lg font-semibold text-ink">
          com {opportunity.professional.displayName}
        </p>
        <p className="mt-1 text-ink first-letter:uppercase">
          {dayLabel}, {localTime}
        </p>
        {disponivel ? (
          <p className="mt-2 text-sm text-ink-secondary">
            Primeiro a confirmar leva — a vaga é sua assim que você preencher os dados abaixo.
          </p>
        ) : null}
      </section>

      {disponivel ? (
        <div className="relative mt-6">
          <VagaClaimForm
            token={params.token}
            services={services.map((service) => ({
              id: service.id,
              name: service.name,
              priceMinor: service.priceMinor,
              durationMinutes: service.durationMinutes,
            }))}
          />
        </div>
      ) : (
        <p className="relative mt-6 text-sm text-ink-secondary">
          Essa vaga já foi preenchida ou o horário passou. Você ainda pode agendar um novo horário
          direto com a {shop.name}.
        </p>
      )}
    </main>
  );
}
