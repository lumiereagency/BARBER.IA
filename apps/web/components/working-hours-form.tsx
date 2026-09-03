"use client";

import { useFormStatus } from "react-dom";
import { saveWorkingHours } from "@/app/(dashboard)/gestao/actions";

const DIAS = [
  { weekday: 1, label: "Segunda" },
  { weekday: 2, label: "Terça" },
  { weekday: 3, label: "Quarta" },
  { weekday: 4, label: "Quinta" },
  { weekday: 5, label: "Sexta" },
  { weekday: 6, label: "Sábado" },
  { weekday: 0, label: "Domingo" },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? "Salvando…" : "Salvar horários"}
    </button>
  );
}

export function WorkingHoursForm({
  professionalId,
  rows,
}: {
  professionalId: string;
  rows: Array<{ weekday: number; startLocalTime: string; endLocalTime: string }>;
}) {
  const byWeekday = new Map(rows.map((row) => [row.weekday, row]));

  return (
    <form action={saveWorkingHours} className="space-y-3">
      <input type="hidden" name="professionalId" value={professionalId} />

      <ul className="space-y-2">
        {DIAS.map((dia) => {
          const atual = byWeekday.get(dia.weekday);
          return (
            <li key={dia.weekday} className="flex items-center gap-3">
              <label className="flex w-28 items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  name={`day-${dia.weekday}`}
                  defaultChecked={Boolean(atual)}
                  className="h-4 w-4"
                />
                {dia.label}
              </label>
              <input
                type="time"
                name={`start-${dia.weekday}`}
                defaultValue={atual?.startLocalTime ?? "09:00"}
                className="rounded-lg border border-neutral-300 px-2 py-2 text-sm"
                aria-label={`${dia.label}: abre`}
              />
              <span className="text-neutral-400">até</span>
              <input
                type="time"
                name={`end-${dia.weekday}`}
                defaultValue={atual?.endLocalTime ?? "18:00"}
                className="rounded-lg border border-neutral-300 px-2 py-2 text-sm"
                aria-label={`${dia.label}: fecha`}
              />
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-neutral-500">
        Estes são os horários em que este profissional atende. A agenda pública é montada a
        partir daqui.
      </p>

      <Submit />
    </form>
  );
}
