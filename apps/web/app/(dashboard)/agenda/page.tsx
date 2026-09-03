import Link from "next/link";
import { prisma } from "@barber/db";
import {
  can,
  confirmationMessage,
  instantToLocalDate,
  instantToLocalTime,
  localDateRange,
  localDateTimeToInstant,
  runningLateMessage,
} from "@barber/domain";
import { requirePermission } from "@/lib/auth";
import { AppointmentActions } from "@/components/appointment-actions";
import { ManualBookingForm } from "@/components/manual-booking-form";
import { BlockPeriodForm } from "@/components/block-period-form";
import { removeBlock } from "./actions";

export const dynamic = "force-dynamic";

const money = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dayLabel = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const shortDayLabel = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "numeric",
  });

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  CONFIRMED: { label: "Confirmado", className: "bg-neutral-100 text-neutral-700" },
  COMPLETED: { label: "Concluído", className: "bg-emerald-100 text-emerald-800" },
  NO_SHOW: { label: "Não veio", className: "bg-amber-100 text-amber-800" },
  CANCELLED_BY_CUSTOMER: { label: "Cancelado pelo cliente", className: "bg-neutral-100 text-neutral-500" },
  CANCELLED_BY_SHOP: { label: "Cancelado pela barbearia", className: "bg-neutral-100 text-neutral-500" },
  RESCHEDULED: { label: "Remarcado", className: "bg-neutral-100 text-neutral-500" },
};

/// Segunda-feira da semana que contém a data.
function weekStart(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: { dia?: string; visao?: string; profissional?: string };
}) {
  const session = await requirePermission("appointments.read.own");

  const shop = await prisma.barbershop.findUniqueOrThrow({
    where: { id: session.barbershopId },
  });

  const hoje = instantToLocalDate(new Date(), shop.timezone);
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dia ?? "") ? searchParams.dia! : hoje;
  const visaoSemanal = searchParams.visao === "semana";

  const inicio = visaoSemanal ? weekStart(dia) : dia;
  const fim = visaoSemanal ? shiftDate(inicio, 6) : dia;

  // Barbeiro sem permissão ampla vê apenas a própria agenda, e nem recebe o
  // filtro de profissional na tela.
  const escopoProprio = !can(session.membership, "appointments.read.all")
    ? (session.membership.professionalId ?? "sem-vinculo")
    : null;

  const profissionalFiltrado = escopoProprio ?? searchParams.profissional ?? null;

  const [professionals, services] = await Promise.all([
    prisma.professional.findMany({
      where: {
        barbershopId: session.barbershopId,
        active: true,
        ...(escopoProprio ? { id: escopoProprio } : {}),
      },
      orderBy: [{ bookingPriority: "asc" }, { displayName: "asc" }],
    }),
    prisma.service.findMany({
      where: { barbershopId: session.barbershopId, active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const janelaInicio = localDateTimeToInstant(inicio, "00:00", shop.timezone);
  const janelaFim = localDateTimeToInstant(shiftDate(fim, 1), "00:00", shop.timezone);

  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barbershopId: session.barbershopId,
        startsAt: { gte: janelaInicio, lt: janelaFim },
        ...(profissionalFiltrado ? { professionalId: profissionalFiltrado } : {}),
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.scheduleBlock.findMany({
      where: {
        barbershopId: session.barbershopId,
        startsAt: { lt: janelaFim },
        endsAt: { gt: janelaInicio },
        ...(profissionalFiltrado ? { professionalId: profissionalFiltrado } : {}),
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const podeEscrever = can(session.membership, "appointments.write.own");
  const dias = localDateRange(inicio, fim);

  const porDia = new Map(
    dias.map((data) => [
      data,
      {
        agendamentos: appointments.filter(
          (item) => instantToLocalDate(item.startsAt, shop.timezone) === data
        ),
        bloqueios: blocks.filter(
          (item) => instantToLocalDate(item.startsAt, shop.timezone) === data
        ),
      },
    ])
  );

  const linkPara = (params: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = {
      dia,
      visao: visaoSemanal ? "semana" : undefined,
      profissional: searchParams.profissional,
      ...params,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) query.set(key, value);
    }
    const s = query.toString();
    return s ? `/agenda?${s}` : "/agenda";
  };

  const ativosNoPeriodo = appointments.filter((item) =>
    ["CONFIRMED", "COMPLETED", "NO_SHOW"].includes(item.status)
  );
  const concluidos = ativosNoPeriodo.filter((item) => item.status === "COMPLETED");
  const previsto = ativosNoPeriodo
    .filter((item) => item.status === "CONFIRMED")
    .reduce((total, item) => total + item.priceSnapshotMinor, 0);
  const realizado = concluidos.reduce((total, item) => total + item.priceSnapshotMinor, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Agenda</h1>
          <p className="mt-1 text-sm text-neutral-500 first-letter:uppercase">
            {visaoSemanal ? `${shortDayLabel(inicio)} a ${shortDayLabel(fim)}` : dayLabel(dia)}
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 text-sm">
          <Link
            href={linkPara({ visao: undefined })}
            className={`rounded px-3 py-1.5 ${!visaoSemanal ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
          >
            Dia
          </Link>
          <Link
            href={linkPara({ visao: "semana" })}
            className={`rounded px-3 py-1.5 ${visaoSemanal ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
          >
            Semana
          </Link>
        </div>
      </header>

      <nav className="flex items-center justify-between gap-2 text-sm">
        <Link
          href={linkPara({ dia: shiftDate(dia, visaoSemanal ? -7 : -1) })}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2"
        >
          ← Anterior
        </Link>
        <Link
          href={linkPara({ dia: hoje })}
          aria-label="Ir para hoje na agenda"
          className="text-neutral-600 underline"
        >
          Hoje
        </Link>
        <Link
          href={linkPara({ dia: shiftDate(dia, visaoSemanal ? 7 : 1) })}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2"
        >
          Próximo →
        </Link>
      </nav>

      {/* O barbeiro com escopo próprio não vê filtro: só existe a agenda dele */}
      {!escopoProprio && professionals.length > 1 ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={linkPara({ profissional: undefined })}
            className={`rounded-full px-3 py-1.5 ${
              !searchParams.profissional ? "bg-neutral-900 text-white" : "bg-white text-neutral-700"
            }`}
          >
            Equipe toda
          </Link>
          {professionals.map((professional) => (
            <Link
              key={professional.id}
              href={linkPara({ profissional: professional.id })}
              className={`rounded-full px-3 py-1.5 ${
                searchParams.profissional === professional.id
                  ? "bg-neutral-900 text-white"
                  : "bg-white text-neutral-700"
              }`}
            >
              {professional.displayName}
            </Link>
          ))}
        </div>
      ) : null}

      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Atendimentos</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{ativosNoPeriodo.length}</p>
        </div>
        <div className="rounded-xl bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Previsto</p>
          <p className="mt-1 text-base font-semibold text-neutral-900">{money(previsto)}</p>
        </div>
        <div className="rounded-xl bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Realizado</p>
          <p className="mt-1 text-base font-semibold text-neutral-900">{money(realizado)}</p>
        </div>
      </section>

      {dias.map((data) => {
        const conteudo = porDia.get(data);
        if (!conteudo) return null;
        const { agendamentos, bloqueios } = conteudo;

        return (
          <section key={data}>
            <h2 className="mb-2 text-sm font-medium text-neutral-700 first-letter:uppercase">
              {visaoSemanal ? dayLabel(data) : "Atendimentos"}
            </h2>

            {bloqueios.map((bloqueio) => (
              <div
                key={bloqueio.id}
                className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3 text-sm"
              >
                <span className="text-neutral-600">
                  {instantToLocalTime(bloqueio.startsAt, shop.timezone)}–
                  {instantToLocalTime(bloqueio.endsAt, shop.timezone)} · bloqueado
                  {bloqueio.reason ? ` · ${bloqueio.reason}` : null}
                </span>
                {podeEscrever ? (
                  <form action={removeBlock}>
                    <input type="hidden" name="id" value={bloqueio.id} />
                    <button type="submit" className="text-neutral-500 underline">
                      Liberar
                    </button>
                  </form>
                ) : null}
              </div>
            ))}

            {agendamentos.length === 0 && bloqueios.length === 0 ? (
              <p className="rounded-xl bg-white p-4 text-sm text-neutral-500">
                Nenhum atendimento.
              </p>
            ) : (
              <ul className="space-y-2">
                {agendamentos.map((appointment) => {
                  const badge = STATUS_BADGE[appointment.status] ?? {
                    label: appointment.status,
                    className: "bg-neutral-100 text-neutral-700",
                  };
                  const encerrado = ["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SHOP", "RESCHEDULED"]
                    .includes(appointment.status);

                  const contexto = {
                    customerPhone: appointment.customerPhoneSnapshot,
                    customerName: appointment.customerNameSnapshot,
                    serviceName: appointment.serviceNameSnapshot,
                    professionalName: appointment.professionalNameSnapshot,
                    dayLabel: dayLabel(instantToLocalDate(appointment.startsAt, shop.timezone)),
                    timeLabel: instantToLocalTime(appointment.startsAt, shop.timezone),
                    shopName: shop.name,
                  };

                  return (
                    <li
                      key={appointment.id}
                      className={`rounded-xl bg-white p-4 ${encerrado ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-neutral-900">
                            {instantToLocalTime(appointment.startsAt, shop.timezone)}–
                            {instantToLocalTime(appointment.endsAt, shop.timezone)} ·{" "}
                            {appointment.customerNameSnapshot}
                          </p>
                          <p className="text-sm text-neutral-500">
                            {appointment.serviceNameSnapshot} com{" "}
                            {appointment.professionalNameSnapshot}
                          </p>
                          <p className="mt-1 text-sm text-neutral-600">
                            {money(appointment.priceSnapshotMinor)}
                            {appointment.source === "MANUAL" ? " · balcão" : null}
                          </p>
                        </div>
                        <span
                          className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>

                      {podeEscrever && !encerrado ? (
                        <AppointmentActions
                          appointmentId={appointment.id}
                          status={appointment.status}
                          confirmUrl={confirmationMessage(contexto)}
                          lateUrl={runningLateMessage(contexto)}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {podeEscrever ? (
        <div className="space-y-4">
          <details className="rounded-xl border border-neutral-200 bg-white p-4">
            <summary className="cursor-pointer font-medium text-neutral-900">
              Encaixar atendimento
            </summary>
            <p className="mt-2 text-sm text-neutral-500">
              Para quem chegou sem agendar. O horário não precisa estar na grade, mas não pode
              conflitar com outro atendimento do mesmo profissional.
            </p>
            <div className="mt-3">
              <ManualBookingForm
                date={dia}
                professionals={professionals.map((p) => ({ id: p.id, name: p.displayName }))}
                services={services.map((s) => ({
                  id: s.id,
                  name: s.name,
                  durationMinutes: s.durationMinutes,
                }))}
              />
            </div>
          </details>

          <details className="rounded-xl border border-neutral-200 bg-white p-4">
            <summary className="cursor-pointer font-medium text-neutral-900">
              Bloquear um período
            </summary>
            <p className="mt-2 text-sm text-neutral-500">
              Almoço, compromisso pessoal, manutenção. O horário para de ser oferecido na página
              pública.
            </p>
            <div className="mt-3">
              <BlockPeriodForm
                date={dia}
                professionals={professionals.map((p) => ({ id: p.id, name: p.displayName }))}
              />
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
