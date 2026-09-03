"use client";

// Encaixe no balcão: o cliente já está na barbearia.
//
// Diferente do fluxo público de propósito — sem hold e sem grade fixa, porque
// atendimento encaixado às 10h07 é rotina. O conflito real continua sendo
// recusado pelo servidor.

import { useFormState, useFormStatus } from "react-dom";
import { bookManually, type ActionState } from "@/app/(dashboard)/agenda/actions";
import { Field, inputClass } from "./field";

const initialState: ActionState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? "Encaixando…" : "Confirmar encaixe"}
    </button>
  );
}

export function ManualBookingForm({
  date,
  professionals,
  services,
}: {
  date: string;
  professionals: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string; durationMinutes: number }>;
}) {
  const [state, formAction] = useFormState(bookManually, initialState);

  if (professionals.length === 0 || services.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Cadastre ao menos um profissional e um serviço para encaixar atendimentos.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          Atendimento encaixado.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Profissional">
          <select name="professionalId" required className={`${inputClass} bg-white`}>
            {professionals.map((professional) => (
              <option key={professional.id} value={professional.id}>
                {professional.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Serviço">
          <select name="serviceId" required className={`${inputClass} bg-white`}>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} ({service.durationMinutes} min)
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Data">
          <input type="date" name="date" required defaultValue={date} className={inputClass} />
        </Field>
        <Field label="Hora">
          <input type="time" name="time" required className={inputClass} />
        </Field>
      </div>

      <Field label="Nome do cliente">
        <input name="customerName" required minLength={2} className={inputClass} />
      </Field>

      <Field label="WhatsApp do cliente" hint="Para o cliente receber o link de gerenciamento.">
        <input
          name="customerPhone"
          required
          inputMode="tel"
          placeholder="(11) 99999-0000"
          className={inputClass}
        />
      </Field>

      <Submit />
    </form>
  );
}
