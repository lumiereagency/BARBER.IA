"use client";

import { useFormState, useFormStatus } from "react-dom";
import { saveProfessional, type ActionState } from "@/app/(dashboard)/gestao/actions";
import { CheckboxField, Field, inputClass } from "./field";

interface ProfessionalValues {
  id: string;
  displayName: string;
  bio: string | null;
  phone: string | null;
  bookingPriority: number;
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
      {pending ? "Salvando…" : isNew ? "Adicionar profissional" : "Salvar"}
    </button>
  );
}

export function ProfessionalForm({ professional }: { professional?: ProfessionalValues }) {
  const [state, formAction] = useFormState(saveProfessional, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {professional ? <input type="hidden" name="id" value={professional.id} /> : null}

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {state.error}
        </p>
      ) : null}

      <Field label="Nome do profissional">
        <input
          name="displayName"
          required
          defaultValue={professional?.displayName}
          placeholder="Matheus"
          className={inputClass}
        />
      </Field>

      <Field label="Telefone (opcional)">
        <input
          name="phone"
          inputMode="tel"
          defaultValue={professional?.phone ?? ""}
          className={inputClass}
        />
      </Field>

      <Field
        label="Ordem de preferência"
        hint='Quando o cliente escolhe "qualquer profissional", quem tem o número menor é oferecido primeiro.'
      >
        <input
          name="bookingPriority"
          type="number"
          defaultValue={professional?.bookingPriority ?? 0}
          className={inputClass}
        />
      </Field>

      <CheckboxField
        name="active"
        label="Atendendo"
        defaultChecked={professional?.active ?? true}
      />

      <Submit isNew={!professional} />
    </form>
  );
}
