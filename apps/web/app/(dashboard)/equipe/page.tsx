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
        <h1 className="text-xl font-semibold text-ink">Equipe</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Quem atende, o que cada um faz e em quais horários.
        </p>
      </header>

      {services.length === 0 ? (
        <p className="rounded-lg bg-warning/12 p-4 text-sm text-warning">
          Cadastre pelo menos um serviço antes: sem serviço, ninguém aparece na página de
          agendamento.
        </p>
      ) : null}

      {professionals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-6 text-center">
          <p className="font-medium text-ink">Nenhum profissional cadastrado</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Cadastre você mesmo, se atende, ou os barbeiros da sua equipe.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {professionals.map((professional) => {
            const semServico = professional.services.length === 0;
            const semJornada = professional.workingHours.length === 0;

            return (
              <li key={professional.id} className="rounded-xl border border-line-subtle bg-surface-1 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-ink">
                      {professional.displayName}
                      {!professional.active ? (
                        <span className="ml-2 rounded bg-surface-3 px-2 py-0.5 text-xs font-normal">
                          inativo
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-ink-secondary">
                      {professional.services.length} serviço(s) ·{" "}
                      {professional.workingHours.length} dia(s) de trabalho
                    </p>
                  </div>
                </div>

                {/* Estado vazio com a próxima ação clara (Parte 3 §13) */}
                {professional.active && (semServico || semJornada) ? (
                  <p className="mt-3 rounded-lg bg-warning/12 p-3 text-sm text-warning">
                    {semServico && semJornada
                      ? "Ainda não aparece na agenda: falta escolher os serviços e os horários."
                      : semServico
                        ? "Ainda não aparece na agenda: falta escolher quais serviços realiza."
                        : "Ainda não aparece na agenda: falta definir os horários de trabalho."}
                  </p>
                ) : null}

                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-ink-secondary">Dados</summary>
                  <div className="mt-3">
                    <ProfessionalForm professional={professional} />
                  </div>
                </details>

                <details className="mt-2" open={semServico && services.length > 0}>
                  <summary className="cursor-pointer text-sm text-ink-secondary">
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
                  <summary className="cursor-pointer text-sm text-ink-secondary">
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
                  <summary className="cursor-pointer text-sm text-ink-secondary">
                    Folgas e férias
                  </summary>
                  <div className="mt-3 space-y-3">
                    {professional.scheduleExceptions.length > 0 ? (
                      <ul className="space-y-2">
                        {professional.scheduleExceptions.map((exception) => (
                          <li
                            key={exception.id}
                            className="flex items-center justify-between rounded-lg bg-canvas p-3 text-sm"
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
                              <button type="submit" className="text-ink-secondary underline">
                                Remover
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-ink-secondary">Nenhuma folga registrada.</p>
                    )}

                    <form action={addScheduleException} className="grid grid-cols-2 gap-2">
                      <input type="hidden" name="professionalId" value={professional.id} />
                      <label className="text-xs text-ink-secondary">
                        De
                        <input
                          type="date"
                          name="startDate"
                          required
                          className="mt-1 w-full rounded-lg border border-line-subtle px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-ink-secondary">
                        Até (opcional)
                        <input
                          type="date"
                          name="endDate"
                          className="mt-1 w-full rounded-lg border border-line-subtle px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-ink-secondary">
                        Tipo
                        <select
                          name="type"
                          className="mt-1 w-full rounded-lg border border-line-subtle bg-surface-1 px-2 py-2 text-sm"
                        >
                          <option value="UNAVAILABLE">Folga</option>
                          <option value="VACATION">Férias</option>
                        </select>
                      </label>
                      <label className="text-xs text-ink-secondary">
                        Motivo (opcional)
                        <input
                          name="reason"
                          className="mt-1 w-full rounded-lg border border-line-subtle px-2 py-2 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        className="col-span-2 rounded-lg border border-line-subtle px-4 py-2 text-sm font-medium"
                      >
                        Adicionar folga
                      </button>
                    </form>
                  </div>
                </details>

                {professional.workingHours.length > 0 ? (
                  <p className="mt-3 text-xs text-ink-secondary">
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

      <section className="rounded-xl border border-line-subtle bg-surface-1 p-4">
        <h2 className="mb-3 font-medium text-ink">Novo profissional</h2>
        <ProfessionalForm />
      </section>
    </div>
  );
}
