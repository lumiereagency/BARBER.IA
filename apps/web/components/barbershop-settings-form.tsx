"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveBarbershop, type ActionState } from "@/app/(dashboard)/gestao/actions";
import { Field, inputClass } from "./field";

const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília, São Paulo, Sul e Sudeste" },
  { value: "America/Manaus", label: "Manaus, Cuiabá, Porto Velho" },
  { value: "America/Belem", label: "Belém, Fortaleza, Recife, Salvador" },
  { value: "America/Rio_Branco", label: "Rio Branco" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
];

interface ShopValues {
  name: string;
  slug: string;
  timezone: string;
  phone: string | null;
  cancellationPolicy: string | null;
  holdDurationMinutes: number;
  slotGranularityMinutes: number;
  minimumNoticeMinutes: number;
  cancellationNoticeMinutes: number;
  bookingWindowDays: number;
}

const initialState: ActionState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-ink-inverse disabled:opacity-50"
    >
      {pending ? "Salvando…" : "Salvar configurações"}
    </button>
  );
}

export function BarbershopSettingsForm({ shop }: { shop: ShopValues }) {
  const [state, formAction] = useFormState(saveBarbershop, initialState);

  return (
    <form action={formAction} className="space-y-5 rounded-xl border border-line-subtle bg-surface-1 p-4">
      {state.error ? (
        <p role="alert" className="rounded-lg bg-error/12 p-3 text-sm text-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-lg bg-success/12 p-3 text-sm text-success">
          Configurações salvas.
        </p>
      ) : null}

      <Field label="Nome da barbearia">
        <input name="name" required defaultValue={shop.name} className={inputClass} />
      </Field>

      <Field
        label="Endereço da página"
        hint="Mudar isto quebra os links que você já divulgou."
      >
        <input name="slug" required defaultValue={shop.slug} className={inputClass} />
      </Field>

      <Field label="Fuso horário">
        <select name="timezone" defaultValue={shop.timezone} className={inputClass}>
          {TIMEZONES.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="WhatsApp da barbearia"
        hint="Usado nos botões de contato. As mensagens são sempre enviadas por você, nunca automaticamente."
      >
        <input
          name="phone"
          inputMode="tel"
          defaultValue={shop.phone ?? ""}
          placeholder="+55 11 98765-4321"
          className={inputClass}
        />
      </Field>

      <hr className="border-line-subtle" />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Intervalo entre horários">
          <select
            name="slotGranularityMinutes"
            defaultValue={shop.slotGranularityMinutes}
            className={inputClass}
          >
            <option value={10}>10 minutos</option>
            <option value={15}>15 minutos</option>
            <option value={20}>20 minutos</option>
            <option value={30}>30 minutos</option>
          </select>
        </Field>

        <Field label="Tempo para concluir">
          <select
            name="holdDurationMinutes"
            defaultValue={shop.holdDurationMinutes}
            className={inputClass}
          >
            <option value={3}>3 minutos</option>
            <option value={5}>5 minutos</option>
            <option value={10}>10 minutos</option>
          </select>
        </Field>
      </div>
      <p className="-mt-2 text-xs text-ink-secondary">
        Quanto tempo o horário fica guardado enquanto o cliente preenche os dados.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Antecedência mínima em minutos" hint="Para agendar.">
          <input
            name="minimumNoticeMinutes"
            type="number"
            min={0}
            defaultValue={shop.minimumNoticeMinutes}
            className={inputClass}
          />
        </Field>

        <Field
          label="Prazo para cancelar em minutos"
          hint="0 = pode cancelar a qualquer momento."
        >
          <input
            name="cancellationNoticeMinutes"
            type="number"
            min={0}
            defaultValue={shop.cancellationNoticeMinutes}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Agendar com até quantos dias de antecedência">
        <input
          name="bookingWindowDays"
          type="number"
          min={1}
          max={365}
          defaultValue={shop.bookingWindowDays}
          className={inputClass}
        />
      </Field>

      <Field label="Política de cancelamento" hint="Aparece para o cliente antes de confirmar.">
        <textarea
          name="cancellationPolicy"
          rows={2}
          defaultValue={shop.cancellationPolicy ?? ""}
          placeholder="Cancele com até 2 horas de antecedência."
          className={inputClass}
        />
      </Field>

      <Submit />
    </form>
  );
}
