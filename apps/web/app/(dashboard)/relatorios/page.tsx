import Link from "next/link";
import { barbershopFeatures } from "@barber/entitlements";
import { requirePermission } from "@/lib/auth";
import { computeSmartAgendaReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

const formatPrice = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function RelatoriosPage() {
  const session = await requirePermission("reports.advanced.read");
  const features = await barbershopFeatures(session.barbershopId);

  if (!features.advancedReports) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-ink">Relatórios avançados</h1>
        </header>
        <div className="rounded-xl border border-dashed border-brand-500/40 bg-brand-500/12 p-6 text-center">
          <p className="text-sm text-ink">
            Relatórios avançados da Agenda Inteligente estão disponíveis no plano Pro.
          </p>
        </div>
      </div>
    );
  }

  const report = await computeSmartAgendaReport(session.barbershopId);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold text-ink">Relatórios avançados</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Últimos {report.periodo.dias} dias.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          Vagas por cancelamento
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric rotulo="Detectadas" valor={String(report.vagas.detectadas)} />
          <Metric rotulo="Preenchidas" valor={String(report.vagas.preenchidas)} />
          <Metric rotulo="Expiradas" valor={String(report.vagas.expiradas)} />
          <Metric
            rotulo="Taxa de aproveitamento"
            valor={
              report.vagas.taxaPreenchimento === null
                ? "—"
                : `${Math.round(report.vagas.taxaPreenchimento * 100)}%`
            }
          />
        </div>
        <div className="mt-3 rounded-xl border border-line-subtle bg-surface-1 p-4">
          <p className="text-sm text-ink-secondary">Receita recuperada no período</p>
          <p className="mt-1 text-2xl font-semibold text-ink">
            {formatPrice(report.vagas.receitaRecuperadaMinor)}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Soma do valor real dos agendamentos criados a partir de uma vaga preenchida.
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          Lista de espera
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Metric rotulo="Esperando agora" valor={String(report.listaEspera.esperandoAgora)} />
          <Metric rotulo="Entradas no período" valor={String(report.listaEspera.entradasNoPeriodo)} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          Clientes atrasados para voltar
        </h2>
        {report.clientesAtrasados.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-6 text-center text-sm text-ink-secondary">
            Ninguém passou do próprio período de retorno agora.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.clientesAtrasados.map((cliente) => (
              <li key={cliente.barbershopCustomerId}>
                <Link
                  href={`/clientes/${cliente.barbershopCustomerId}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line-subtle bg-surface-1 p-3 hover:bg-surface-2"
                >
                  <span className="font-medium text-ink">{cliente.nome}</span>
                  <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-secondary">
                    {Math.round(cliente.score)} pts
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-line-subtle bg-surface-1 p-4">
      <p className="text-xs text-ink-secondary">{rotulo}</p>
      <p className="mt-1 text-xl font-semibold text-ink">{valor}</p>
    </div>
  );
}
