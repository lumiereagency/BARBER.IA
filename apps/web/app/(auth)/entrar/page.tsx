"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { signIn, type FormState } from "../actions";

const initialState: FormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white disabled:opacity-50"
    >
      {pending ? "Entrando…" : "Entrar"}
    </button>
  );
}

export default function SignInPage() {
  const [state, formAction] = useFormState(signIn, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">Entrar</h1>
      <p className="mt-1 text-sm text-neutral-500">Acesse o painel da sua barbearia.</p>

      <form action={formAction} className="mt-8 space-y-4">
        {state.error ? (
          <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-900">
            {state.error}
          </p>
        ) : null}

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-900">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-neutral-300 px-3 py-3 text-base"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-900">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-neutral-300 px-3 py-3 text-base"
          />
        </div>

        <SubmitButton />
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Ainda não tem conta?{" "}
        <Link href="/criar-conta" className="font-medium text-neutral-900 underline">
          Cadastre sua barbearia
        </Link>
      </p>
    </main>
  );
}
