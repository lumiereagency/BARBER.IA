"use client";

// Formulário de reivindicação da vaga (/vaga/{token}, Marco 6.4).
//
// A página nunca cria hold ao abrir — só este envio faz isso, no servidor,
// junto com a confirmação (docs/tech-review-part2.md §3.5). Perder a corrida
// para outra pessoa não é um erro feio: a mensagem é clara e não deixa a
// pessoa num beco.

import { useState } from "react";
import { Field, inputClass } from "./field";

const TERMS_VERSION = process.env.NEXT_PUBLIC_TERMS_VERSION ?? "dev-0";

interface VagaService {
  id: string;
  name: string;
  priceMinor: number;
  durationMinutes: number;
}

interface Confirmation {
  appointment: {
    localDate: string;
    localTime: string;
    serviceName: string;
    professionalName: string;
  };
  manageUrl: string;
  whatsappShareUrl: string | null;
  calendarUrl: string | null;
}

const formatPrice = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDayLabel = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

export function VagaClaimForm({ token, services }: { token: string; services: VagaService[] }) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/public/vacancies/${token}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `${token}:claim` },
        body: JSON.stringify({
          serviceId,
          customerName: name,
          customerPhone: phone,
          acceptedTermsVersion: TERMS_VERSION,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        if (body?.error?.code === "SLOT_UNAVAILABLE") {
          setTaken(true);
          return;
        }
        setError(body?.error?.message ?? "Não foi possível concluir.");
        return;
      }

      setConfirmation(body);
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div className="animate-celebrate space-y-6">
        <div className="rounded-xl bg-success/12 p-5">
          <h2 className="text-lg font-semibold text-success">Vaga garantida!</h2>
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
        </div>
      </div>
    );
  }

  if (taken) {
    return (
      <p className="rounded-lg bg-warning/12 p-4 text-sm text-warning">
        Essa vaga acabou de ser preenchida por outra pessoa. Você ainda pode ver os horários
        normais de agendamento com a barbearia.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-lg bg-error/12 p-4 text-sm text-error">
          {error}
        </p>
      ) : null}

      {services.length > 1 ? (
        <Field label="Serviço">
          <select
            required
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
            className={inputClass}
          >
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} · {service.durationMinutes} min · {formatPrice(service.priceMinor)}
              </option>
            ))}
          </select>
        </Field>
      ) : services.length === 1 && services[0] ? (
        <p className="text-sm text-ink-secondary">
          {services[0].name} · {services[0].durationMinutes} min ·{" "}
          {formatPrice(services[0].priceMinor)}
        </p>
      ) : null}

      <Field label="Seu nome">
        <input
          required
          minLength={2}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="WhatsApp">
        <input
          required
          inputMode="tel"
          placeholder="(11) 99999-0000"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className={inputClass}
        />
      </Field>

      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          required
          checked={acceptedTerms}
          onChange={(event) => setAcceptedTerms(event.target.checked)}
          className="mt-0.5 h-5 w-5"
        />
        <span>Aceito os termos de uso e a política de privacidade.</span>
      </label>

      <button
        type="submit"
        disabled={submitting || !serviceId}
        className="w-full rounded-lg bg-brand-500 px-4 py-3 font-medium text-ink-inverse disabled:opacity-50"
      >
        {submitting ? "Confirmando…" : "Garantir esta vaga"}
      </button>
    </form>
  );
}
