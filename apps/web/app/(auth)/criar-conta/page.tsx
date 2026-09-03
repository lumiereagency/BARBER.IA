"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { signUp, type FormState } from "../actions";

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
      className="w-full rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white disabled:opacity-50"
    >
      {pending ? "Criando…" : "Criar minha barbearia"}
    </button>
  );
}

export default function SignUpPage() {
  const [state, formAction] = useFormState(signUp, initialState);

  return (
    <main className="mx-auto max-w-sm px-5 py-10">
      <h1 className="text-2xl font-semibold text-neutral-900">Cadastre sua barbearia</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Leva um minuto. Depois você configura serviços e horários.
      </p>

      <form action={formAction} className="mt-8 space-y-4">
        {state.error ? (
          <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-900">
            {state.error}
          </p>
        ) : null}

        <div>
          <label htmlFor="barbershopName" className="mb-1 block text-sm font-medium text-neutral-900">
            Nome da barbearia
          </label>
          <input
            id="barbershopName"
            name="barbershopName"
            required
            className="w-full rounded-lg border border-neutral-300 px-3 py-3 text-base"
          />
          <p className="mt-1 text-xs text-neutral-500">
            É o nome que aparece na sua página de agendamento.
          </p>
        </div>

        <div>
          <label htmlFor="timezone" className="mb-1 block text-sm font-medium text-neutral-900">
            Onde fica sua barbearia
          </label>
          <select
            id="timezone"
            name="timezone"
            defaultValue="America/Sao_Paulo"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-3 text-base"
          >
            {TIMEZONES.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </select>
        </div>

        <hr className="border-neutral-200" />

        <div>
          <label htmlFor="ownerName" className="mb-1 block text-sm font-medium text-neutral-900">
            Seu nome
          </label>
          <input
            id="ownerName"
            name="ownerName"
            required
            autoComplete="name"
            className="w-full rounded-lg border border-neutral-300 px-3 py-3 text-base"
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-900">
            Seu e-mail
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
            minLength={10}
            autoComplete="new-password"
            className="w-full rounded-lg border border-neutral-300 px-3 py-3 text-base"
          />
          <p className="mt-1 text-xs text-neutral-500">Pelo menos 10 caracteres.</p>
        </div>

        <SubmitButton />
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Já tem conta?{" "}
        <Link href="/entrar" className="font-medium text-neutral-900 underline">
          Entrar
        </Link>
      </p>
    </main>
  );
}
