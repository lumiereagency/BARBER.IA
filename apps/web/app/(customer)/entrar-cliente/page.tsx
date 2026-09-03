"use client";

// Entrada do consumidor: telefone e código, sem senha (Parte 1 §3).

import { useFormState, useFormStatus } from "react-dom";
import { confirmCode, sendCode, type CustomerFormState } from "../actions";
import { Field, inputClass } from "@/components/field";

const initialState: CustomerFormState = {};

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export default function CustomerSignInPage() {
  const [phoneState, sendAction] = useFormState(sendCode, initialState);
  const [codeState, confirmAction] = useFormState(confirmCode, initialState);

  const naEtapaDoCodigo = phoneState.codeSent || codeState.codeSent;
  const telefone = codeState.phone ?? phoneState.phone ?? "";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">Meus agendamentos</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {naEtapaDoCodigo
          ? "Enviamos um código para o seu WhatsApp."
          : "Entre com o telefone que você usou para agendar."}
      </p>

      {naEtapaDoCodigo ? (
        <form action={confirmAction} className="mt-8 space-y-4">
          <input type="hidden" name="phone" value={telefone} />

          {codeState.error ? (
            <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-900">
              {codeState.error}
            </p>
          ) : null}

          <Field label="Código de 6 dígitos">
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className={`${inputClass} text-center text-2xl tracking-widest`}
            />
          </Field>

          <Submit label="Entrar" pendingLabel="Conferindo…" />

          <p className="text-center text-sm text-neutral-500">
            Não recebeu?{" "}
            <a href="/entrar-cliente" className="font-medium text-neutral-900 underline">
              Tentar de novo
            </a>
          </p>
        </form>
      ) : (
        <form action={sendAction} className="mt-8 space-y-4">
          {phoneState.error ? (
            <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-900">
              {phoneState.error}
            </p>
          ) : null}

          <Field label="Seu WhatsApp">
            <input
              name="phone"
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 99999-0000"
              className={inputClass}
            />
          </Field>

          <Submit label="Receber código" pendingLabel="Enviando…" />
        </form>
      )}

      <p className="mt-6 text-center text-xs text-neutral-400">
        Você não precisa de conta para agendar. Ela serve para acompanhar seus horários.
      </p>
    </main>
  );
}
