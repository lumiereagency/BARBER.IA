import { prisma } from "@barber/db";
import { requirePermission } from "@/lib/auth";
import { ServiceForm } from "@/components/service-form";
import { deleteService } from "../actions";

export const dynamic = "force-dynamic";

const money = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function ServicesPage() {
  const session = await requirePermission("services.read");

  const services = await prisma.service.findMany({
    where: { barbershopId: session.barbershopId },
    orderBy: [{ active: "desc" }, { publicOrder: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Serviços</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          O que aparece na sua página de agendamento, com preço e duração.
        </p>
      </header>

      {services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-6 text-center">
          <p className="font-medium text-ink">Nenhum serviço cadastrado</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Cadastre o primeiro para sua página começar a receber agendamentos.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {services.map((service) => (
            <li
              key={service.id}
              className={`rounded-xl border bg-surface-1 p-4 ${
                service.active ? "border-line-subtle" : "border-line-subtle opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-ink">
                    {service.name}
                    {!service.active ? (
                      <span className="ml-2 rounded bg-surface-3 px-2 py-0.5 text-xs font-normal">
                        inativo
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-ink-secondary">
                    {service.durationMinutes} min · {money(service.priceMinor)}
                    {service.bufferBeforeMinutes || service.bufferAfterMinutes
                      ? ` · intervalo ${service.bufferBeforeMinutes}/${service.bufferAfterMinutes} min`
                      : null}
                  </p>
                </div>
                <form action={deleteService}>
                  <input type="hidden" name="id" value={service.id} />
                  <button type="submit" className="text-sm text-ink-secondary underline">
                    Remover
                  </button>
                </form>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-ink-secondary">Editar</summary>
                <div className="mt-3">
                  <ServiceForm service={service} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border border-line-subtle bg-surface-1 p-4">
        <h2 className="mb-3 font-medium text-ink">Novo serviço</h2>
        <ServiceForm />
      </section>
    </div>
  );
}
