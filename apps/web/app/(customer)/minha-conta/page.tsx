import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@barber/db";
import { instantToLocalDate, instantToLocalTime } from "@barber/domain";
import { getCustomerSession } from "@/lib/customer-session";
import { signOutCustomer } from "../actions";

export const dynamic = "force-dynamic";

const money = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dayLabel = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

export default async function CustomerHomePage() {
  const session = await getCustomerSession();
  if (!session) redirect("/entrar-cliente");

  const relations = await prisma.barbershopCustomer.findMany({
    where: { customerId: session.customerId },
    include: { barbershop: true },
  });

  const relationIds = relations.map((relation) => relation.id);

  const [proximos, promocoes] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barbershopCustomerId: { in: relationIds },
        status: "CONFIRMED",
        startsAt: { gte: new Date() },
      },
      orderBy: { startsAt: "asc" },
      include: { barbershop: true },
    }),
    // Promoções da barbearia com quem o cliente já tem relação. Uma barbearia
    // nunca aparece para quem não é cliente dela.
    prisma.promotion.findMany({
      where: {
        barbershopId: { in: relations.map((r) => r.barbershopId) },
        status: "ACTIVE",
        startsAt: { lte: new Date() },
        endsAt: { gte: new Date() },
      },
      include: { barbershop: true },
      orderBy: { endsAt: "asc" },
      take: 10,
    }),
  ]);

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-surface-1 px-5 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            Olá, {session.displayName.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">Seus horários e histórico.</p>
        </div>
        <form action={signOutCustomer}>
          <button type="submit" className="text-sm text-ink-secondary underline">
            Sair
          </button>
        </form>
      </header>

      <nav className="mb-6 flex gap-4 text-sm">
        <Link href="/minha-conta/historico" className="text-ink-secondary underline">
          Histórico
        </Link>
        <Link href="/minha-conta/preferencias" className="text-ink-secondary underline">
          Preferências e privacidade
        </Link>
      </nav>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-secondary">
          Próximos horários
        </h2>

        {proximos.length === 0 ? (
          <div className="rounded-xl bg-canvas p-5 text-center">
            <p className="text-sm text-ink">Você não tem horário marcado.</p>
            {relations.length > 0 ? (
              <Link
                href={`/b/${relations[0]!.barbershop.slug}`}
                className="mt-3 inline-block rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-ink-inverse"
              >
                Agendar na {relations[0]!.barbershop.name}
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-3">
            {proximos.map((appointment) => (
              <li key={appointment.id} className="rounded-xl border border-line-subtle p-4">
                <p className="text-sm text-ink-secondary">{appointment.barbershop.name}</p>
                <p className="mt-1 font-medium text-ink first-letter:uppercase">
                  {dayLabel(instantToLocalDate(appointment.startsAt, appointment.barbershop.timezone))}
                  , {instantToLocalTime(appointment.startsAt, appointment.barbershop.timezone)}
                </p>
                <p className="text-sm text-ink-secondary">
                  {appointment.serviceNameSnapshot} com {appointment.professionalNameSnapshot}
                </p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {money(appointment.priceSnapshotMinor)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {promocoes.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-secondary">
            Promoções
          </h2>
          <ul className="space-y-3">
            {promocoes.map((promocao) => (
              <li key={promocao.id} className="rounded-xl bg-success/12 p-4">
                <p className="text-xs text-success">{promocao.barbershop.name}</p>
                <p className="mt-1 font-medium text-success">{promocao.title}</p>
                <p className="text-sm text-success">{promocao.description}</p>
                <Link
                  href={`/b/${promocao.barbershop.slug}`}
                  className="mt-2 inline-block text-sm font-medium text-success underline"
                >
                  Agendar
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {relations.length === 0 ? (
        <p className="mt-8 rounded-lg bg-canvas p-4 text-sm text-ink-secondary">
          Ainda não encontramos agendamentos ligados a este telefone. Se você agendou com outro
          número, use o link que recebeu na confirmação.
        </p>
      ) : null}
    </main>
  );
}
