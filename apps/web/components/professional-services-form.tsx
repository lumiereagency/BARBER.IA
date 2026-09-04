"use client";

import { useFormStatus } from "react-dom";
import { setProfessionalServices } from "@/app/(dashboard)/gestao/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-ink-inverse disabled:opacity-50"
    >
      {pending ? "Salvando…" : "Salvar serviços"}
    </button>
  );
}

export function ProfessionalServicesForm({
  professionalId,
  services,
  selectedIds,
}: {
  professionalId: string;
  services: Array<{ id: string; name: string }>;
  selectedIds: string[];
}) {
  if (services.length === 0) {
    return <p className="text-sm text-ink-secondary">Cadastre um serviço primeiro.</p>;
  }

  return (
    <form action={setProfessionalServices} className="space-y-3">
      <input type="hidden" name="professionalId" value={professionalId} />

      <ul className="space-y-2">
        {services.map((service) => (
          <li key={service.id}>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="serviceIds"
                value={service.id}
                defaultChecked={selectedIds.includes(service.id)}
                className="h-4 w-4"
              />
              {service.name}
            </label>
          </li>
        ))}
      </ul>

      <Submit />
    </form>
  );
}
