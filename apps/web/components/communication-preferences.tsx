"use client";

import { useFormStatus } from "react-dom";
import { updateCommunicationPreferences } from "@/app/(customer)/actions";
import { CheckboxField } from "./field";

const CANAIS = [
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "SMS", label: "SMS" },
  { value: "EMAIL", label: "E-mail" },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Salvando…" : "Salvar"}
    </button>
  );
}

export function CommunicationPreferences({
  relationId,
  barbershopName,
  granted,
}: {
  relationId: string;
  barbershopName: string;
  granted: string[];
}) {
  return (
    <form
      action={updateCommunicationPreferences}
      className="rounded-xl border border-neutral-200 p-4"
    >
      <input type="hidden" name="relationId" value={relationId} />
      <p className="mb-3 font-medium text-neutral-900">{barbershopName}</p>

      <div className="space-y-2">
        {CANAIS.map((canal) => (
          <CheckboxField
            key={canal.value}
            name="channels"
            value={canal.value}
            label={`Receber promoções por ${canal.label}`}
            defaultChecked={granted.includes(canal.value)}
          />
        ))}
      </div>

      <div className="mt-3">
        <Submit />
      </div>
    </form>
  );
}
