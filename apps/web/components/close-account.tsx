"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { closeAccount } from "@/app/(customer)/actions";

function Confirmar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 rounded-lg bg-error px-4 py-3 font-medium text-ink-inverse disabled:opacity-50"
    >
      {pending ? "Encerrando…" : "Sim, encerrar minha conta"}
    </button>
  );
}

export function CloseAccount() {
  const [confirmando, setConfirmando] = useState(false);

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="rounded-lg border border-line-subtle px-4 py-2.5 text-sm font-medium text-ink"
      >
        Encerrar minha conta
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-error/35 p-4">
      {/* Ação destrutiva e irreversível: a confirmação diz o que acontece */}
      <p className="text-sm text-ink">
        Isto não pode ser desfeito. Seu nome e telefone são removidos, e você perde o acesso ao
        histórico por aqui.
      </p>
      <div className="mt-3 flex gap-2">
        <form action={closeAccount} className="flex-1">
          <Confirmar />
        </form>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          className="flex-1 rounded-lg border border-line-subtle px-4 py-3 font-medium"
        >
          Manter conta
        </button>
      </div>
    </div>
  );
}
