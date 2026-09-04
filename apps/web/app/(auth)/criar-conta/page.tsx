"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { signUp, type FormState } from "../actions";
import { BrandMark } from "@/components/brand-mark";
import { Field, inputClass } from "@/components/field";
import { ThemeToggle } from "@/components/theme-toggle";
import { PRODUCT_NAME } from "@barber/config";

const initialState: FormState = {};

// Fusos do Brasil. O campo é obrigatório porque sem ele a agenda não existe,
// mas ninguém deveria precisar pensar nisso: o padrão cobre a maioria.
const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília, São Paulo, Sul e Sudeste" },
  { value: "America/Manaus", label: "Manaus, Cuiabá, Porto Velho" },
  { value: "America/Belem", label: "Belém, Fortaleza, Recife, Salvador" },
  { value: "America/Rio_Branco", label: "Rio Branco" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-ink-inverse transition-colors hover:bg-brand-400 active:bg-brand-600 disabled:opacity-50"
    >
      {pending ? "Criando…" : "Criar minha barbearia"}
    </button>
  );
}

export default function SignUpPage() {
  const [state, formAction] = useFormState(signUp, initialState);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-5 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(255,90,31,.28) 0%, rgba(255,90,31,.06) 45%, transparent 72%)" }}
      />

      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="h-10 w-10 text-brand-500" />
          <p className="mt-3 text-sm font-semibold tracking-wide text-ink-secondary">{PRODUCT_NAME}</p>
          <h1 className="mt-4 text-2xl font-semibold text-ink">Cadastre sua barbearia</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Leva um minuto. Depois você configura serviços e horários.
          </p>
        </div>

        <div className="rounded-2xl border border-line-subtle bg-surface-1 p-6">
          <form action={formAction} className="space-y-4">
            {state.error ? (
              <p role="alert" className="rounded-xl bg-error/12 p-4 text-sm text-error">
                {state.error}
              </p>
            ) : null}

            <Field label="Nome da barbearia" hint="É o nome que aparece na sua página de agendamento.">
              <input id="barbershopName" name="barbershopName" required className={inputClass} />
            </Field>

            <Field label="Onde fica sua barbearia">
              <select id="timezone" name="timezone" defaultValue="America/Sao_Paulo" className={inputClass}>
                {TIMEZONES.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </select>
            </Field>

            <hr className="border-line-subtle" />

            <Field label="Seu nome">
              <input id="ownerName" name="ownerName" required autoComplete="name" className={inputClass} />
            </Field>

            <Field label="Seu e-mail">
              <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
            </Field>

            <Field label="Senha" hint="Pelo menos 10 caracteres.">
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                className={inputClass}
              />
            </Field>

            <SubmitButton />
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-ink-secondary">
          Já tem conta?{" "}
          <Link href="/entrar" className="font-medium text-ink underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
