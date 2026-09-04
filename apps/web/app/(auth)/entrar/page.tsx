"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { signIn, type FormState } from "../actions";
import { BrandMark } from "@/components/brand-mark";
import { Field, inputClass } from "@/components/field";
import { ThemeToggle } from "@/components/theme-toggle";
import { PRODUCT_NAME } from "@barber/config";

const initialState: FormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-ink-inverse transition-colors hover:bg-brand-400 active:bg-brand-600 disabled:opacity-50"
    >
      {pending ? "Entrando…" : "Entrar"}
    </button>
  );
}

export default function SignInPage() {
  const [state, formAction] = useFormState(signIn, initialState);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-5 py-10">
      {/* Brilho ambiental, muito sutil — só aqui e no onboarding (§7) */}
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
          <h1 className="mt-4 text-2xl font-semibold text-ink">Entrar</h1>
          <p className="mt-1 text-sm text-ink-secondary">Acesse o painel da sua barbearia.</p>
        </div>

        <div className="rounded-2xl border border-line-subtle bg-surface-1 p-6">
          <form action={formAction} className="space-y-4">
            {state.error ? (
              <p role="alert" className="rounded-xl bg-error/12 p-4 text-sm text-error">
                {state.error}
              </p>
            ) : null}

            <Field label="E-mail">
              <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
            </Field>

            <Field label="Senha">
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className={inputClass}
              />
            </Field>

            <SubmitButton />
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-ink-secondary">
          Ainda não tem conta?{" "}
          <Link href="/criar-conta" className="font-medium text-ink underline">
            Cadastre sua barbearia
          </Link>
        </p>
      </div>
    </main>
  );
}
