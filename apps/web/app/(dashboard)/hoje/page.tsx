import Link from "next/link";
import { prisma } from "@barber/db";
import { instantToLocalDate, instantToLocalTime, localDateTimeToInstant } from "@barber/domain";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const money = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function TodayPage() {
  const session = await requireSession();

  const shop = await prisma.barbershop.findUniqueOrThrow({
    where: { id: session.barbershopId },
  });

  const today = instantToLocalDate(new Date(), shop.timezone);
  const dayStart = localDateTimeToInstant(today, "00:00", shop.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  // O barbeiro sem permissão ampla vê apenas a própria agenda
  const scopedProfessional =
    session.membership.role === "PROFESSIONAL" &&
    !session.membership.extraPermissions?.includes("appointments.read.all")
      ? session.membership.professionalId
      : undefined;

  const [appointments, servicesCount, professionalsReady] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barbershopId: session.barbershopId,
        startsAt: { gte: dayStart, lt: dayEnd },
        status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] },
        ...(scopedProfessional ? { professionalId: scopedProfessional } : {}),
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.service.count({ where: { barbershopId: session.barbershopId, active: true } }),
    prisma.professional.count({
      where: {
        barbershopId: session.barbershopId,
        active: true,
        services: { some: {} },
        workingHours: { some: {} },
      },
    }),
  ]);

  // Números do dia lidos ao vivo dos agendamentos, não de contador
  // materializado: o dono marca "concluído" e espera ver mudar na hora.
  const confirmados = appointments.filter((item) => item.status === "CONFIRMED");
  const concluidos = appointments.filter((item) => item.status === "COMPLETED");
  const previsto = confirmados.reduce((total, item) => total + item.priceSnapshotMinor, 0);
  const realizado = concluidos.reduce((total, item) => total + item.priceSnapshotMinor, 0);
  const proximo = confirmados.find((item) => item.startsAt > new Date());

  const configuracaoPendente = servicesCount === 0 || professionalsReady === 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-900">Hoje</h1>
        <p className="mt-1 text-sm capitalize text-neutral-500">
          {new Date(`${today}T12:00:00Z`).toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      </header>

      {configuracaoPendente ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Sua página ainda não recebe agendamentos</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {servicesCount === 0 ? (
              <li>
                •{" "}
                <Link href="/gestao/servicos" className="underline">
                  Cadastre seus serviços
                </Link>
              </li>
            ) : null}
            {professionalsReady === 0 ? (
              <li>
                •{" "}
                <Link href="/equipe" className="underline">
                  Cadastre quem atende, com serviços e horários
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Agendamentos</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{appointments.length}</p>
        </div>
        <div className="rounded-xl bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Concluídos</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{concluidos.length}</p>
        </div>
        <div className="rounded-xl bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Previsto</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">{money(previsto)}</p>
        </div>
        <div className="rounded-xl bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Realizado</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">{money(realizado)}</p>
        </div>
      </section>

      {proximo ? (
        <section className="rounded-xl border border-neutral-900 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Próximo cliente</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">
            {instantToLocalTime(proximo.startsAt, shop.timezone)} · {proximo.customerNameSnapshot}
          </p>
          <p className="text-sm text-neutral-600">
            {proximo.serviceNameSnapshot} com {proximo.professionalNameSnapshot}
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Agenda do dia
        </h2>

        {appointments.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-neutral-500">
            Nenhum agendamento para hoje.
          </p>
        ) : (
          <ul className="space-y-2">
            {appointments.map((appointment) => (
              <li
                key={appointment.id}
                className="flex items-center justify-between gap-4 rounded-xl bg-white p-4"
              >
                <div>
                  <p className="font-medium text-neutral-900">
                    {instantToLocalTime(appointment.startsAt, shop.timezone)} ·{" "}
                    {appointment.customerNameSnapshot}
                  </p>
                  <p className="text-sm text-neutral-500">
                    {appointment.serviceNameSnapshot} com {appointment.professionalNameSnapshot}
                  </p>
                </div>
                <span className="whitespace-nowrap text-sm text-neutral-600">
                  {money(appointment.priceSnapshotMinor)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
