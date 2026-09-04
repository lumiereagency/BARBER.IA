"use client";

// Ações de um atendimento na agenda.
//
// Só aparecem as transições que fazem sentido no estado atual — a validação
// real acontece no servidor, mas a tela não deve oferecer o que vai ser
// recusado. Cancelar pede confirmação porque é destrutivo.

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { cancelAsShop, markAbsent, markCompleted, undoStatus } from "@/app/(dashboard)/agenda/actions";

function ActionButton({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "primary" | "danger";
}) {
  const { pending } = useFormStatus();
  const classes = {
    default: "border border-line-subtle text-ink",
    primary: "bg-brand-500 text-ink-inverse",
    danger: "bg-error text-ink-inverse",
  }[variant];

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${classes}`}
    >
      {pending ? "…" : children}
    </button>
  );
}

export function AppointmentActions({
  appointmentId,
  status,
  confirmUrl,
  lateUrl,
}: {
  appointmentId: string;
  status: string;
  confirmUrl: string;
  lateUrl: string;
}) {
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  const hidden = <input type="hidden" name="appointmentId" value={appointmentId} />;

  if (confirmandoCancelamento) {
    return (
      <div className="mt-3 rounded-lg border border-error/35 p-3">
        <p className="text-sm text-ink">
          Cancelar este atendimento? O horário volta a ficar disponível.
        </p>
        <div className="mt-3 flex gap-2">
          <form action={cancelAsShop}>
            {hidden}
            <ActionButton variant="danger">Sim, cancelar</ActionButton>
          </form>
          <button
            type="button"
            onClick={() => setConfirmandoCancelamento(false)}
            className="rounded-lg border border-line-subtle px-3 py-2 text-sm font-medium"
          >
            Manter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {status === "CONFIRMED" ? (
        <>
          <form action={markCompleted}>
            {hidden}
            <ActionButton variant="primary">Concluir</ActionButton>
          </form>
          <form action={markAbsent}>
            {hidden}
            <ActionButton>Não veio</ActionButton>
          </form>
          <button
            type="button"
            onClick={() => setConfirmandoCancelamento(true)}
            className="rounded-lg border border-line-subtle px-3 py-2 text-sm font-medium text-ink"
          >
            Cancelar
          </button>
        </>
      ) : (
        <form action={undoStatus}>
          {hidden}
          <ActionButton>Desfazer</ActionButton>
        </form>
      )}

      {/* Mensagens prontas: quem envia é a pessoa, sempre (Parte 1 §17.1) */}
      <a
        href={confirmUrl}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-line-subtle px-3 py-2 text-sm font-medium text-ink"
      >
        Confirmar no WhatsApp
      </a>
      {status === "CONFIRMED" ? (
        <a
          href={lateUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-line-subtle px-3 py-2 text-sm font-medium text-ink"
        >
          Cliente atrasado
        </a>
      ) : null}
    </div>
  );
}
