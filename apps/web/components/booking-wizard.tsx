"use client";

// Wizard público de agendamento (Parte 1 §7).
//
// Princípios que a tela precisa honrar:
// - nada de conta para agendar;
// - a agenda vem sempre do servidor, o front nunca recalcula horário;
// - o hold tem contagem regressiva visível, e expirar não é erro feio: é
//   "escolha de novo", com a agenda já atualizada;
// - perder o horário para outra pessoa mostra alternativas, não um beco.

import { useCallback, useEffect, useMemo, useState } from "react";

interface Service {
  id: string;
  name: string;
  durationMinutes: number;
  priceMinor: number;
}

interface Professional {
  id: string;
  displayName: string;
}

interface Slot {
  startsAt: string;
  endsAt: string;
  professionalId: string;
  professionalName: string;
  priceMinor: number;
}

interface Confirmation {
  appointment: {
    localDate: string;
    localTime: string;
    serviceName: string;
    professionalName: string;
    priceMinor: number;
  };
  manageUrl: string;
  whatsappShareUrl: string | null;
  calendarUrl: string | null;
}

type Step = "servico" | "profissional" | "horario" | "dados" | "sucesso" | "espera" | "espera_ok";

const formatPrice = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDayLabel = (isoDate: string) => {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return date.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
};

const formatTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });

function nextDates(count: number): { from: string; to: string } {
  const today = new Date();
  const to = new Date(today.getTime() + count * 864e5);
  return { from: today.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function BookingWizard({
  slug,
  services,
  professionals,
  initialServiceId,
  termsVersion,
}: {
  slug: string;
  services: Service[];
  professionals: Professional[];
  initialServiceId?: string;
  termsVersion: string;
}) {
  const [step, setStep] = useState<Step>(initialServiceId ? "profissional" : "servico");
  const [serviceId, setServiceId] = useState(initialServiceId ?? "");
  const [professionalId, setProfessionalId] = useState<string | null>(null);

  const [days, setDays] = useState<Array<{ date: string; slots: Slot[] }>>([]);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [hold, setHold] = useState<{ token: string; slot: Slot; expiresAt: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [wantsPromotions, setWantsPromotions] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<Slot[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const service = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);

  const loadSlots = useCallback(async () => {
    if (!serviceId) return;
    setLoadingSlots(true);
    setMessage(null);

    const { from, to } = nextDates(21);
    const query = new URLSearchParams({ serviceId, from, to });
    if (professionalId) query.set("professionalId", professionalId);

    try {
      const response = await fetch(`/api/public/shops/${slug}/availability?${query}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Não foi possível carregar a agenda");
      setTimezone(body.timezone);
      setDays(body.days.filter((day: { slots: Slot[] }) => day.slots.length > 0));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoadingSlots(false);
    }
  }, [serviceId, professionalId, slug]);

  useEffect(() => {
    if (step === "horario") void loadSlots();
  }, [step, loadSlots]);

  // Contagem regressiva do hold. Ao zerar, o cliente volta para a agenda já
  // recarregada — o horário pode ter sido de outra pessoa nesse meio-tempo.
  useEffect(() => {
    if (!hold) return;

    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setHold(null);
        setStep("horario");
        setMessage("Sua reserva temporária expirou. Escolha o horário de novo.");
        void loadSlots();
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [hold, loadSlots]);

  async function selectSlot(slot: Slot) {
    setSubmitting(true);
    setMessage(null);
    setAlternatives([]);

    try {
      const response = await fetch(`/api/public/shops/${slug}/holds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceId,
          professionalId: slot.professionalId,
          startsAt: slot.startsAt,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setMessage(body?.error?.message ?? "Este horário não está mais disponível.");
        await loadSlots();
        return;
      }

      setHold({ token: body.holdToken, slot, expiresAt: body.expiresAt });
      setStep("dados");
    } finally {
      setSubmitting(false);
    }
  }

  async function joinWaitlist(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/public/shops/${slug}/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          customerPhone: phone,
          serviceId: serviceId || undefined,
          professionalId: professionalId ?? undefined,
          acceptedTermsVersion: termsVersion,
          contactConsentTextVersion: termsVersion,
        }),
      });

      if (!response.ok) {
        const body = await response.json();
        setMessage(body?.error?.message ?? "Não foi possível entrar na lista de espera.");
        return;
      }

      setStep("espera_ok");
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!hold) return;

    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/public/shops/${slug}/appointments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Reenvio pela rede ou duplo toque não pode virar duas reservas
          "idempotency-key": `${hold.token}:confirm`,
        },
        body: JSON.stringify({
          holdToken: hold.token,
          customerName: name,
          customerPhone: phone,
          acceptedTermsVersion: termsVersion,
          marketingConsent: wantsPromotions
            ? { channels: ["WHATSAPP"], textVersion: termsVersion }
            : undefined,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setMessage(body?.error?.message ?? "Não foi possível concluir.");
        if (body?.error?.details?.nearestSlots?.length) {
          setAlternatives(body.error.details.nearestSlots);
        }
        if (body?.error?.code === "HOLD_EXPIRED" || body?.error?.code === "SLOT_UNAVAILABLE") {
          setHold(null);
          setStep("horario");
          await loadSlots();
        }
        return;
      }

      setConfirmation(body);
      setStep("sucesso");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "sucesso" && confirmation) {
    return (
      <div className="animate-celebrate space-y-6">
        <div className="rounded-xl bg-success/12 p-5">
          <h2 className="text-lg font-semibold text-success">Horário reservado!</h2>
          <p className="mt-2 text-success">
            {confirmation.appointment.serviceName} com {confirmation.appointment.professionalName}
          </p>
          <p className="text-success">
            {formatDayLabel(confirmation.appointment.localDate)}, {confirmation.appointment.localTime}
          </p>
        </div>

        <div className="space-y-3">
          <a
            href={confirmation.manageUrl}
            className="block rounded-lg bg-brand-500 px-4 py-3 text-center font-medium text-ink-inverse"
          >
            Gerenciar meu agendamento
          </a>
          {confirmation.calendarUrl ? (
            <a
              href={confirmation.calendarUrl}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border border-line-subtle px-4 py-3 text-center font-medium text-ink"
            >
              Adicionar ao calendário
            </a>
          ) : null}
          {confirmation.whatsappShareUrl ? (
            <a
              href={confirmation.whatsappShareUrl}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border border-line-subtle px-4 py-3 text-center font-medium text-ink"
            >
              Enviar confirmação no WhatsApp
            </a>
          ) : null}
        </div>

        {/* Convite de conta (Parte 1 §10): vem DEPOIS do valor entregue,
            nunca como requisito para agendar. */}
        <div className="rounded-xl border border-line-subtle p-5 text-center">
          <p className="font-medium text-ink">Fique conectado com sua barbearia</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Crie sua conta gratuitamente para acompanhar seus horários, marcar de novo com
            poucos toques e receber promoções em primeira mão.
          </p>
          <a
            href="/entrar-cliente"
            className="mt-3 inline-block rounded-lg border border-line-strong px-4 py-2.5 text-sm font-medium text-ink"
          >
            Criar minha conta
          </a>
        </div>

        <p className="text-center text-sm text-ink-secondary">
          Guarde o link de gerenciamento: é por ele que você cancela ou remarca.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message ? (
        <p role="status" className="rounded-lg bg-warning/12 p-4 text-sm text-warning">
          {message}
        </p>
      ) : null}

      {alternatives.length > 0 ? (
        <div className="rounded-lg border border-line-subtle p-4">
          <p className="mb-3 text-sm font-medium text-ink">Horários próximos:</p>
          <div className="flex flex-wrap gap-2">
            {alternatives.map((slot) => (
              <button
                key={slot.startsAt}
                type="button"
                onClick={() => void selectSlot(slot)}
                className="rounded-lg border border-line-subtle px-3 py-2 text-sm"
              >
                {formatTime(slot.startsAt, timezone)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === "servico" ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-ink">Escolha o serviço</h2>
          <ul className="space-y-3">
            {services.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setServiceId(item.id);
                    setStep("profissional");
                  }}
                  className="flex w-full items-center justify-between gap-4 rounded-xl border border-line-subtle p-4 text-left"
                >
                  <span>
                    <span className="block font-medium text-ink">{item.name}</span>
                    <span className="block text-sm text-ink-secondary">{item.durationMinutes} min</span>
                  </span>
                  <span className="font-medium">{formatPrice(item.priceMinor)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {step === "profissional" ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-ink">Com quem você quer cortar?</h2>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setProfessionalId(null);
                setStep("horario");
              }}
              className="w-full rounded-xl border border-line-subtle p-4 text-left font-medium"
            >
              Qualquer profissional
              <span className="block text-sm font-normal text-ink-secondary">
                Mostra todos os horários livres
              </span>
            </button>
            {professionals.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setProfessionalId(item.id);
                  setStep("horario");
                }}
                className="w-full rounded-xl border border-line-subtle p-4 text-left font-medium"
              >
                {item.displayName}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === "horario" ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-ink">Escolha o horário</h2>

          {loadingSlots ? (
            <p className="text-sm text-ink-secondary">Carregando horários…</p>
          ) : days.length === 0 ? (
            <div className="rounded-lg bg-canvas p-4">
              <p className="text-sm text-ink">
                Não há horários livres nos próximos dias.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => setStep("profissional")}
                  className="text-sm font-medium underline"
                >
                  Tentar com outro profissional
                </button>
                <button
                  type="button"
                  onClick={() => setStep("espera")}
                  className="rounded-lg border border-line-subtle px-3 py-2 text-sm font-medium text-ink sm:ml-auto"
                >
                  Entrar na lista de espera
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {days.map((day) => (
                <div key={day.date}>
                  <h3 className="mb-2 text-sm font-medium text-ink first-letter:uppercase">
                    {formatDayLabel(day.date)}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {day.slots.map((slot) => (
                      <button
                        key={`${slot.startsAt}-${slot.professionalId}`}
                        type="button"
                        disabled={submitting}
                        onClick={() => void selectSlot(slot)}
                        className="min-w-[76px] rounded-lg border border-line-subtle px-3 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        {formatTime(slot.startsAt, timezone)}
                        {!professionalId ? (
                          <span className="block text-xs font-normal text-ink-secondary">
                            {slot.professionalName}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {step === "dados" && hold ? (
        <section>
          <div className="mb-4 rounded-lg bg-canvas p-4">
            <p className="font-medium text-ink">
              {service?.name} com {hold.slot.professionalName}
            </p>
            <p className="text-sm text-ink-secondary">
              {formatTime(hold.slot.startsAt, timezone)} · {formatPrice(hold.slot.priceMinor)}
            </p>
            <p className="mt-2 text-sm text-ink-secondary">
              Guardamos este horário por mais{" "}
              <strong className="tabular-nums text-ink">
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </strong>
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="nome" className="mb-1 block text-sm font-medium text-ink">
                Seu nome
              </label>
              <input
                id="nome"
                required
                minLength={2}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg border border-line-subtle px-3 py-3 text-base"
                autoComplete="name"
              />
            </div>

            <div>
              <label htmlFor="telefone" className="mb-1 block text-sm font-medium text-ink">
                WhatsApp
              </label>
              <input
                id="telefone"
                required
                inputMode="tel"
                placeholder="(11) 99999-0000"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="w-full rounded-lg border border-line-subtle px-3 py-3 text-base"
                autoComplete="tel"
              />
            </div>

            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                required
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                className="mt-1 h-5 w-5"
              />
              <span>Aceito os termos de uso e a política de privacidade.</span>
            </label>

            {/* Promoção é escolha separada do aceite obrigatório: consentimento
                de marketing nunca é inferido do agendamento (Parte 2 §5.3). */}
            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={wantsPromotions}
                onChange={(event) => setWantsPromotions(event.target.checked)}
                className="mt-1 h-5 w-5"
              />
              <span>Quero receber promoções desta barbearia pelo WhatsApp.</span>
            </label>

            <button
              type="submit"
              disabled={submitting || secondsLeft === 0}
              className="w-full rounded-lg bg-brand-500 px-4 py-3 font-medium text-ink-inverse disabled:opacity-50"
            >
              {submitting ? "Confirmando…" : "Confirmar agendamento"}
            </button>
          </form>
        </section>
      ) : null}

      {step === "espera" ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-ink">Entrar na lista de espera</h2>
          <p className="mb-4 text-sm text-ink-secondary">
            Avisamos assim que abrir um horário compatível — o contato é sempre feito
            diretamente pela barbearia.
          </p>

          <form onSubmit={joinWaitlist} className="space-y-4">
            <div>
              <label htmlFor="espera-nome" className="mb-1 block text-sm font-medium text-ink">
                Seu nome
              </label>
              <input
                id="espera-nome"
                required
                minLength={2}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg border border-line-subtle px-3 py-3 text-base"
                autoComplete="name"
              />
            </div>

            <div>
              <label htmlFor="espera-telefone" className="mb-1 block text-sm font-medium text-ink">
                WhatsApp
              </label>
              <input
                id="espera-telefone"
                required
                inputMode="tel"
                placeholder="(11) 99999-0000"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="w-full rounded-lg border border-line-subtle px-3 py-3 text-base"
                autoComplete="tel"
              />
            </div>

            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                required
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                className="mt-1 h-5 w-5"
              />
              <span>
                Aceito os termos de uso e ser contatado(a) sobre esta lista de espera.
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-brand-500 px-4 py-3 font-medium text-ink-inverse disabled:opacity-50"
            >
              {submitting ? "Entrando…" : "Entrar na lista de espera"}
            </button>
          </form>
        </section>
      ) : null}

      {step === "espera_ok" ? (
        <div className="animate-celebrate rounded-xl bg-success/12 p-5">
          <h2 className="text-lg font-semibold text-success">Você está na lista!</h2>
          <p className="mt-2 text-success">
            Avisamos assim que abrir um horário compatível com o que você escolheu.
          </p>
        </div>
      ) : null}
    </div>
  );
}
