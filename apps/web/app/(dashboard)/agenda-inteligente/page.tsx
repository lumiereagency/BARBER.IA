import { prisma } from "@barber/db";
import {
  can,
  computeOpportunityMatch,
  instantToLocalDate,
  instantToLocalTime,
  waitlistEntryMatchesOpportunity,
  type ReturnScoreResult,
} from "@barber/domain";
import { barbershopFeatures } from "@barber/entitlements";
import { formatPhoneBR } from "@barber/domain";
import { requirePermission } from "@/lib/auth";
import { VagaOportunidadeCard, type Candidato } from "@/components/vaga-opportunity-card";

export const dynamic = "force-dynamic";

const formatPrice = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

export default async function AgendaInteligentePage() {
  const session = await requirePermission("smart_agenda.read");
  const podeAgir = can(session.membership, "smart_agenda.act");
  const podeVerListaEspera = can(session.membership, "waitlist.read");

  const [shop, features] = await Promise.all([
    prisma.barbershop.findUniqueOrThrow({
      where: { id: session.barbershopId },
      select: { timezone: true },
    }),
    barbershopFeatures(session.barbershopId),
  ]);

  const opportunities = features.smartAgenda
    ? await prisma.smartOpportunity.findMany({
        where: { barbershopId: session.barbershopId, status: "OPEN" },
        include: { professional: true },
        orderBy: { startsAt: "asc" },
      })
    : [];

  const waitingEntries =
    podeVerListaEspera && features.waitlist
      ? await prisma.waitlistEntry.findMany({
          where: { barbershopId: session.barbershopId, status: "WAITING" },
          include: { barbershopCustomer: true, service: true, professional: true },
          orderBy: [{ rankScore: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
        })
      : [];

  const opportunityCards = opportunities.map((opportunity) => {
    const localDate = instantToLocalDate(opportunity.startsAt, shop.timezone);
    const localTime = instantToLocalTime(opportunity.startsAt, shop.timezone);

    const candidatos: Candidato[] = features.waitlist
      ? waitingEntries
          .filter((entry) =>
            waitlistEntryMatchesOpportunity(
              {
                professionalId: entry.professionalId,
                serviceId: entry.serviceId,
                dateFrom: entry.dateFrom ? instantToLocalDate(entry.dateFrom, shop.timezone) : null,
                dateTo: entry.dateTo ? instantToLocalDate(entry.dateTo, shop.timezone) : null,
                timeRangeStart: entry.timeRangeStart,
                timeRangeEnd: entry.timeRangeEnd,
              },
              {
                professionalId: opportunity.professionalId,
                compatibleServiceIds: opportunity.compatibleServiceIds,
                localDate,
                localTime,
              }
            )
          )
          .map((entry) => {
            const base: ReturnScoreResult =
              entry.rankScore != null
                ? {
                    score: entry.rankScore,
                    reasons: (entry.rankReasons as unknown as ReturnScoreResult["reasons"]) ?? [],
                  }
                : { score: 0, reasons: [{ code: "sem_historico", label: "Sem histórico ainda" }] };

            const combinado = computeOpportunityMatch({
              returnScore: base,
              preferredProfessionalId: entry.professionalId,
              preferredServiceId: entry.serviceId,
              opportunityProfessionalId: opportunity.professionalId,
              compatibleServiceIds: opportunity.compatibleServiceIds,
            });

            return {
              id: entry.id,
              nome: entry.barbershopCustomer.currentName,
              telefone: entry.barbershopCustomer.normalizedPhone,
              score: combinado.score,
              motivos: combinado.reasons.map((r) => r.label),
            };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
      : [];

    return (
      <VagaOportunidadeCard
        key={opportunity.id}
        opportunityId={opportunity.id}
        professionalName={opportunity.professional.displayName}
        diaLabel={shortDate(localDate)}
        horario={localTime}
        valorFormatado={formatPrice(opportunity.estimatedRevenueMinor)}
        jaTemLink={Boolean(opportunity.shareTokenHash)}
        candidatos={candidatos}
        podeAgir={podeAgir}
      />
    );
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold text-ink">Agenda Inteligente</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Vagas abertas por cancelamento e quem tem mais chance de querer cada uma.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          Vagas abertas
        </h2>
        {!features.smartAgenda ? (
          <UpsellCard texto="A Agenda Inteligente detecta vagas por cancelamento automaticamente. Disponível no plano Pro." />
        ) : opportunityCards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-6 text-center text-sm text-ink-secondary">
            Nenhuma vaga aberta agora. Assim que um cancelamento liberar um horário próximo, ele
            aparece aqui.
          </p>
        ) : (
          <div className="space-y-3">{opportunityCards}</div>
        )}
      </section>

      {podeVerListaEspera ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            Lista de espera
          </h2>
          {!features.waitlist ? (
            <UpsellCard texto="Clientes entram na fila quando não há horário livre. Disponível no plano Pro." />
          ) : waitingEntries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-6 text-center text-sm text-ink-secondary">
              Ninguém na lista de espera agora.
            </p>
          ) : (
            <ul className="space-y-2">
              {waitingEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line-subtle bg-surface-1 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{entry.barbershopCustomer.currentName}</p>
                    <p className="truncate text-sm text-ink-secondary">
                      {formatPhoneBR(entry.barbershopCustomer.normalizedPhone)}
                      {entry.service ? ` · ${entry.service.name}` : ""}
                      {entry.professional ? ` · ${entry.professional.displayName}` : ""}
                    </p>
                  </div>
                  {entry.rankScore != null ? (
                    <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-secondary">
                      {Math.round(entry.rankScore)} pts
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function UpsellCard({ texto }: { texto: string }) {
  return (
    <div className="rounded-xl border border-dashed border-brand-500/40 bg-brand-500/12 p-5 text-center">
      <p className="text-sm text-ink">{texto}</p>
    </div>
  );
}
