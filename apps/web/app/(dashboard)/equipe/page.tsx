import { prisma } from "@barber/db";
import { requirePermission } from "@/lib/auth";
import { ProfessionalForm } from "@/components/professional-form";
import { WorkingHoursForm } from "@/components/working-hours-form";
import { ProfessionalServicesForm } from "@/components/professional-services-form";
import { addScheduleException, deleteScheduleException } from "../gestao/actions";

export const dynamic = "force-dynamic";

const DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export default async function TeamPage() {
  const session = await requirePermission("professionals.read");

  const [professionals, services] = await Promise.all([
    prisma.professional.findMany({
      where: { barbershopId: session.barbershopId },
      orderBy: [{ active: "desc" }, { bookingPriority: "asc" }, { displayName: "asc" }],
      include: {
        services: { select: { serviceId: true } },
        workingHours: { orderBy: { weekday: "asc" } },
        scheduleExceptions: { orderBy: { startDate: "asc" } },
      },
    }),
    prisma.service.findMany({
      where: { barbershopId: session.barbershopId, active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-900">Equipe</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Quem atende, o que cada um faz e em quais horários.
        </p>
      </header>

      {services.length === 0 ? (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          Cadastre pelo menos um serviço antes: sem serviço, ninguém aparece na página de
          agendamento.
        </p>
      ) : null}

      {professionals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center">
          <p className="font-medium text-neutral-900">Nenhum profissional cadastrado</p>
          <p className="mt-1 text-sm text-neutral-500">
            Cadastre você mesmo, se atende, ou os barbeiros da sua equipe.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {professionals.map((professional) => {
            const semServico = professional.services.length === 0;
            const semJornada = professional.workingHours.length === 0;

            return (
              <li key={professional.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-neutral-900">
                      {professional.displayName}
                      {!professional.active ? (
                        <span className="ml-2 rounded bg-neutral-200 px-2 py-0.5 text-xs font-normal">
                          inativo
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-neutral-500">
                      {professional.services.length} serviço(s) ·{" "}
                      {professional.workingHours.length} dia(s) de trabalho
                    </p>
                  </div>
                </div>

                {/* Estado vazio com a próxima ação clara (Parte 3 §13) */}
                {professional.active && (semServico || semJornada) ? (
                  <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                    {semServico && semJornada
                      ? "Ainda não aparece na agenda: falta escolher os serviços e os horários."
                      : semServico
                        ? "Ainda não aparece na agenda: falta escolher quais serviços realiza."
                        : "Ainda não aparece na agenda: falta definir os horários de trabalho."}
                  </p>
                ) : null}

                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-neutral-600">Dados</summary>
                  <div className="mt-3">
                    <ProfessionalForm professional={professional} />
                  </div>
                </details>

                <details className="mt-2" open={semServico && services.length > 0}>
                  <summary className="cursor-pointer text-sm text-neutral-600">
                    Serviços que realiza
                  </summary>
                  <div className="mt-3">
                    <ProfessionalServicesForm
                      professionalId={professional.id}
                      services={services.map((s) => ({ id: s.id, name: s.name }))}
                      selectedIds={professional.services.map((s) => s.serviceId)}
                    />
                  </div>
                </details>

                <details className="mt-2" open={semJornada && !semServico}>
                  <summary className="cursor-pointer text-sm text-neutral-600">
                    Horários de trabalho
                  </summary>
                  <div className="mt-3">
                    <WorkingHoursForm
                      professionalId={professional.id}
                      rows={professional.workingHours.map((row) => ({
                        weekday: row.weekday,
                        startLocalTime: row.startLocalTime,
                        endLocalTime: row.endLocalTime,
                      }))}
                    />
                  </div>
                </details>

                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-neutral-600">
                    Folgas e férias
                  </summary>
                  <div className="mt-3 space-y-3">
                    {professional.scheduleExceptions.length > 0 ? (
                      <ul className="space-y-2">
                        {professional.scheduleExceptions.map((exception) => (
                          <li
                            key={exception.id}
                            className="flex items-center justify-between rounded-lg bg-neutral-50 p-3 text-sm"
                          >
                            <span>
                              {exception.type === "VACATION" ? "Férias" : "Folga"} ·{" "}
                              {exception.startDate.toISOString().slice(0, 10)}
                              {exception.endDate.toISOString().slice(0, 10) !==
                              exception.startDate.toISOString().slice(0, 10)
                                ? ` até ${exception.endDate.toISOString().slice(0, 10)}`
                                : null}
                              {exception.reason ? ` · ${exception.reason}` : null}
                            </span>
                            <form action={deleteScheduleException}>
                              <input type="hidden" name="id" value={exception.id} />
                              <button type="submit" className="text-neutral-500 underline">
                                Remover
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-neutral-500">Nenhuma folga registrada.</p>
                    )}

                    <form action={addScheduleException} className="grid grid-cols-2 gap-2">
                      <input type="hidden" name="professionalId" value={professional.id} />
                      <label className="text-xs text-neutral-600">
                        De
                        <input
                          type="date"
                          name="startDate"
                          required
                          className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-neutral-600">
                        Até (opcional)
                        <input
                          type="date"
                          name="endDate"
                          className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-neutral-600">
                        Tipo
                        <select
                          name="type"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm"
                        >
                          <option value="UNAVAILABLE">Folga</option>
                          <option value="VACATION">Férias</option>
                        </select>
                      </label>
                      <label className="text-xs text-neutral-600">
                        Motivo (opcional)
                        <input
                          name="reason"
                          className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        className="col-span-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium"
                      >
                        Adicionar folga
                      </button>
                    </form>
                  </div>
                </details>

                {professional.workingHours.length > 0 ? (
                  <p className="mt-3 text-xs text-neutral-500">
                    {professional.workingHours
                      .map((row) => `${DIA[row.weekday]} ${row.startLocalTime}–${row.endLocalTime}`)
                      .join(" · ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-neutral-900">Novo profissional</h2>
        <ProfessionalForm />
      </section>
    </div>
  );
}
