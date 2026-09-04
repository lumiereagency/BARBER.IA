import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@barber/db";
import { instantToLocalDate, instantToLocalTime } from "@barber/domain";
import { getCustomerSession } from "@/lib/customer-session";

export const dynamic = "force-dynamic";

const money = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Atendido",
  NO_SHOW: "Não compareceu",
  CANCELLED_BY_CUSTOMER: "Cancelado por você",
  CANCELLED_BY_SHOP: "Cancelado pela barbearia",
  RESCHEDULED: "Remarcado",
  CONFIRMED: "Confirmado",
};

export default async function CustomerHistoryPage() {
  const session = await getCustomerSession();
  if (!session) redirect("/entrar-cliente");

  const relations = await prisma.barbershopCustomer.findMany({
    where: { customerId: session.customerId },
    include: {
      barbershop: true,
      preferredProfessional: true,
      preferredService: true,
    },
  });

  const appointments = await prisma.appointment.findMany({
    where: {
      barbershopCustomerId: { in: relations.map((relation) => relation.id) },
      startsAt: { lt: new Date() },
    },
    orderBy: { startsAt: "desc" },
    include: { barbershop: true },
    take: 50,
  });

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-surface-1 px-5 py-8">
      <header className="mb-6">
        <Link href="/minha-conta" className="text-sm text-ink-secondary">
          ← Meus agendamentos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Histórico</h1>
      </header>

      {/* O resumo por barbearia sai do CRM automático. Onde o dado não existe,
          a tela não mostra número inventado — simplesmente não mostra. */}
      {relations.map((relation) => (
        <section key={relation.id} className="mb-6 rounded-xl bg-canvas p-4">
          <p className="font-medium text-ink">{relation.barbershop.name}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-ink-secondary">Atendimentos</dt>
              <dd className="font-medium text-ink">{relation.completedVisitsCount}</dd>
            </div>
            {relation.averageTicketMinor !== null ? (
              <div>
                <dt className="text-ink-secondary">Ticket médio</dt>
                <dd className="font-medium text-ink">
                  {money(relation.averageTicketMinor)}
                </dd>
              </div>
            ) : null}
            {relation.preferredProfessional ? (
              <div>
                <dt className="text-ink-secondary">Costuma cortar com</dt>
                <dd className="font-medium text-ink">
                  {relation.preferredProfessional.displayName}
                </dd>
              </div>
            ) : null}
            {relation.preferredService ? (
              <div>
                <dt className="text-ink-secondary">Serviço mais pedido</dt>
                <dd className="font-medium text-ink">
                  {relation.preferredService.name}
                </dd>
              </div>
            ) : null}
          </dl>

          <Link
            href={
              relation.preferredServiceId
                ? `/b/${relation.barbershop.slug}/agendar?servico=${relation.preferredServiceId}`
                : `/b/${relation.barbershop.slug}`
            }
            className="mt-3 inline-block rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-ink-inverse"
          >
            Agendar de novo
          </Link>
        </section>
      ))}

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-secondary">
          Atendimentos
        </h2>

        {appointments.length === 0 ? (
          <p className="rounded-xl bg-canvas p-5 text-sm text-ink-secondary">
            Você ainda não tem atendimentos anteriores por aqui.
          </p>
        ) : (
          <ul className="space-y-2">
            {appointments.map((appointment) => (
              <li
                key={appointment.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-line-subtle p-4"
              >
                <div>
                  <p className="font-medium text-ink">
                    {instantToLocalDate(appointment.startsAt, appointment.barbershop.timezone)
                      .split("-")
                      .reverse()
                      .join("/")}{" "}
                    às {instantToLocalTime(appointment.startsAt, appointment.barbershop.timezone)}
                  </p>
                  <p className="text-sm text-ink-secondary">
                    {appointment.serviceNameSnapshot} com {appointment.professionalNameSnapshot}
                  </p>
                  <p className="text-xs text-ink-secondary">{appointment.barbershop.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-ink-secondary">
                    {STATUS_LABEL[appointment.status] ?? appointment.status}
                  </p>
                  {appointment.status === "COMPLETED" ? (
                    <p className="text-sm text-ink">
                      {money(appointment.priceSnapshotMinor)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
