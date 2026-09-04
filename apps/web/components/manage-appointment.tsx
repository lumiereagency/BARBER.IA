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
        <p role="alert" className="rounded-lg bg-error/12 p-4 text-sm text-error">
          {error}
        </p>
      ) : null}

      {blockedReason ? (
        <p className="rounded-lg bg-canvas p-4 text-sm text-ink">{blockedReason}</p>
      ) : null}

      {canCancel ? (
        confirming ? (
          // Ação destrutiva confirma antes de acontecer (Parte 3 §13)
          <div className="rounded-lg border border-error/35 p-4">
            <p className="text-sm text-ink">
              Tem certeza que quer cancelar? O horário volta a ficar disponível para outras pessoas.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={working}
                className="flex-1 rounded-lg bg-error px-4 py-3 font-medium text-ink-inverse disabled:opacity-50"
              >
                {working ? "Cancelando…" : "Sim, cancelar"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-lg border border-line-subtle px-4 py-3 font-medium"
              >
                Manter
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-full rounded-lg border border-line-subtle px-4 py-3 font-medium text-ink"
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
          className="block rounded-lg border border-line-subtle px-4 py-3 text-center font-medium text-ink"
        >
          Falar com a barbearia
        </a>
      ) : null}
    </div>
  );
}
