"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveService, type ActionState } from "@/app/(dashboard)/gestao/actions";
import { CheckboxField, Field, inputClass } from "./field";

interface ServiceValues {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  active: boolean;
}

const initialState: ActionState = {};

function Submit({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? "Salvando…" : isNew ? "Adicionar serviço" : "Salvar"}
    </button>
  );
}

export function ServiceForm({ service }: { service?: ServiceValues }) {
  const [state, formAction] = useFormState(saveService, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {service ? <input type="hidden" name="id" value={service.id} /> : null}

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {state.error}
        </p>
      ) : null}

      <Field label="Nome do serviço">
        <input
          name="name"
          required
          defaultValue={service?.name}
          placeholder="Corte + Barba"
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Preço">
          <input
            name="price"
            required
            inputMode="decimal"
            defaultValue={service ? (service.priceMinor / 100).toFixed(2).replace(".", ",") : ""}
            placeholder="80,00"
            className={inputClass}
          />
        </Field>
        <Field label="Duração em minutos">
          <input
            name="duration"
            required
            type="number"
            min={5}
            step={5}
            defaultValue={service?.durationMinutes ?? 30}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Preparo antes">
          <input
            name="bufferBefore"
            type="number"
            min={0}
            step={5}
            defaultValue={service?.bufferBeforeMinutes ?? 0}
            className={inputClass}
          />
        </Field>
        <Field label="Limpeza depois">
          <input
            name="bufferAfter"
            type="number"
            min={0}
            step={5}
            defaultValue={service?.bufferAfterMinutes ?? 0}
            className={inputClass}
          />
        </Field>
      </div>
      <p className="text-xs text-neutral-500">
        O tempo de preparo e limpeza fica reservado na agenda, mas não aparece para o cliente.
      </p>

      <CheckboxField
        name="active"
        label="Mostrar na página de agendamento"
        defaultChecked={service?.active ?? true}
      />

      <Submit isNew={!service} />
    </form>
  );
}
