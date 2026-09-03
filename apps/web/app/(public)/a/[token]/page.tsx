import { notFound } from "next/navigation";
import { instantToLocalDate, instantToLocalTime } from "@barber/domain";
import { findByManagementToken } from "@/lib/booking";
import { ManageActions } from "@/components/manage-appointment";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "Confirmado",
  CANCELLED_BY_CUSTOMER: "Cancelado por você",
  CANCELLED_BY_SHOP: "Cancelado pela barbearia",
  COMPLETED: "Atendimento concluído",
  NO_SHOW: "Você não compareceu",
  RESCHEDULED: "Remarcado",
};

export default async function ManageAppointmentPage({ params }: { params: { token: string } }) {
  const appointment = await findByManagementToken(params.token);

  // Link inválido e link expirado levam à mesma página: distinguir os dois
  // ajudaria quem estivesse tentando adivinhar links.
  if (
    !appointment ||
    (appointment.managementTokenExpiresAt && appointment.managementTokenExpiresAt < new Date())
  ) {
    notFound();
  }

  const shop = appointment.barbershop;
  const active = appointment.status === "CONFIRMED";
  const noticeLimit = new Date(Date.now() + shop.cancellationNoticeMinutes * 60000);
  const withinNotice = appointment.startsAt > noticeLimit;

  const localDate = instantToLocalDate(appointment.startsAt, shop.timezone);
  const localTime = instantToLocalTime(appointment.startsAt, shop.timezone);
  const dayLabel = new Date(`${localDate}T12:00:00Z`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  let blockedReason: string | null = null;
  if (!active) blockedReason = "Este agendamento não está mais ativo.";
  else if (!withinNotice) {
    blockedReason = "Passou do prazo para alterar pelo link. Fale direto com a barbearia.";
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-white px-5 py-8">
      <header className="mb-6">
        <p className="text-sm text-neutral-500">{shop.name}</p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">Seu agendamento</h1>
      </header>

      <section
        className={`rounded-xl p-5 ${active ? "bg-emerald-50" : "bg-neutral-100"}`}
      >
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-600">
          {STATUS_LABEL[appointment.status] ?? appointment.status}
        </p>
        <p className="mt-2 text-lg font-semibold text-neutral-900">
          {appointment.serviceNameSnapshot}
        </p>
        <p className="text-neutral-800">com {appointment.professionalNameSnapshot}</p>
        <p className="mt-1 text-neutral-800 first-letter:uppercase">
          {dayLabel}, {localTime}
        </p>
        <p className="mt-2 text-neutral-700">
          {(appointment.priceSnapshotMinor / 100).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })}
        </p>
      </section>

      {shop.cancellationPolicy ? (
        <p className="mt-4 text-sm text-neutral-500">{shop.cancellationPolicy}</p>
      ) : null}

      <p className="mt-4 text-sm text-neutral-500">
        Quer ver todos os seus horários num lugar só?{" "}
        <a href="/entrar-cliente" className="font-medium text-neutral-900 underline">
          Criar conta
        </a>
      </p>

      <div className="mt-6">
        <ManageActions
          token={params.token}
          canCancel={active && withinNotice}
          blockedReason={blockedReason}
          shopPhone={shop.phone}
          whatsappText={`Olá! Sobre meu agendamento de ${appointment.serviceNameSnapshot} em ${dayLabel} às ${localTime}.`}
        />
      </div>
    </main>
  );
}
