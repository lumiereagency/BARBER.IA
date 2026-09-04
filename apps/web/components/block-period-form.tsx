"use client";

// Bloqueio de período: almoço, compromisso, manutenção.
//
// O bloqueio não cancela reserva já confirmada por conta própria — quem decide
// isso é a barbearia. Quando há conflito, o servidor devolve um aviso dizendo
// quantos atendimentos ficaram no período.

import { useFormState, useFormStatus } from "react-dom";
import { blockPeriod, type ActionState } from "@/app/(dashboard)/agenda/actions";
import { Field, inputClass } from "./field";

const initialState: ActionState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-ink-inverse disabled:opacity-50"
    >
      {pending ? "Bloqueando…" : "Bloquear período"}
    </button>
  );
}

export function BlockPeriodForm({
  date,
  professionals,
}: {
  date: string;
  professionals: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useFormState(blockPeriod, initialState);

  if (professionals.length === 0) {
    return <p className="text-sm text-ink-secondary">Cadastre um profissional primeiro.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? (
        <p role="alert" className="rounded-lg bg-error/12 p-3 text-sm text-error">
          {state.error}
        </p>
      ) : null}
      {state.aviso ? (
        <p role="status" className="rounded-lg bg-warning/12 p-3 text-sm text-warning">
          {state.aviso}
        </p>
      ) : state.ok ? (
        <p role="status" className="rounded-lg bg-success/12 p-3 text-sm text-success">
          Período bloqueado.
        </p>
      ) : null}

      <Field label="Profissional">
        <select name="professionalId" required className={inputClass}>
          {professionals.map((professional) => (
            <option key={professional.id} value={professional.id}>
              {professional.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Data">
          <input type="date" name="date" required defaultValue={date} className={inputClass} />
        </Field>
        <Field label="Das">
          <input type="time" name="from" required className={inputClass} />
        </Field>
        <Field label="Até">
          <input type="time" name="to" required className={inputClass} />
        </Field>
      </div>

      <Field label="Motivo (opcional)">
        <input name="reason" placeholder="Almoço" className={inputClass} />
      </Field>

      <Submit />
    </form>
  );
}
