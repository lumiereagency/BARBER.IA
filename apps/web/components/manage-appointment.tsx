"use client";

// Ações da página /a/{token}. Quem decide o que é permitido é o servidor —
// esta tela só reflete `permissions` e nunca reimplementa a política.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ManageActions({
  token,
  canCancel,
  blockedReason,
  shopPhone,
  whatsappText,
}: {
  token: string;
  canCancel: boolean;
  blockedReason: string | null;
  shopPhone: string | null;
  whatsappText: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setWorking(true);
    setError(null);

    try {
      const response = await fetch(`/api/public/appointments/${token}/cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `${token}:cancel`,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const body = await response.json();
        setError(body?.error?.message ?? "Não foi possível cancelar.");
        return;
      }
      router.refresh();
    } finally {
      setWorking(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      ) : null}

      {blockedReason ? (
        <p className="rounded-lg bg-neutral-50 p-4 text-sm text-neutral-700">{blockedReason}</p>
      ) : null}

      {canCancel ? (
        confirming ? (
          // Ação destrutiva confirma antes de acontecer (Parte 3 §13)
          <div className="rounded-lg border border-red-200 p-4">
            <p className="text-sm text-neutral-900">
              Tem certeza que quer cancelar? O horário volta a ficar disponível para outras pessoas.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={working}
                className="flex-1 rounded-lg bg-red-600 px-4 py-3 font-medium text-white disabled:opacity-50"
              >
                {working ? "Cancelando…" : "Sim, cancelar"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-lg border border-neutral-300 px-4 py-3 font-medium"
              >
                Manter
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-full rounded-lg border border-neutral-300 px-4 py-3 font-medium text-neutral-900"
          >
            Cancelar agendamento
          </button>
        )
      ) : null}

      {shopPhone ? (
        <a
          href={`https://wa.me/${shopPhone.replace(/\D/g, "")}?text=${encodeURIComponent(whatsappText)}`}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg border border-neutral-300 px-4 py-3 text-center font-medium text-neutral-900"
        >
          Falar com a barbearia
        </a>
      ) : null}
    </div>
  );
}
