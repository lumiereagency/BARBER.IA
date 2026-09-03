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
        <h1 className="text-xl font-semibold text-neutral-900">Serviços</h1>
        <p className="mt-1 text-sm text-neutral-500">
          O que aparece na sua página de agendamento, com preço e duração.
        </p>
      </header>

      {services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center">
          <p className="font-medium text-neutral-900">Nenhum serviço cadastrado</p>
          <p className="mt-1 text-sm text-neutral-500">
            Cadastre o primeiro para sua página começar a receber agendamentos.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {services.map((service) => (
            <li
              key={service.id}
              className={`rounded-xl border bg-white p-4 ${
                service.active ? "border-neutral-200" : "border-neutral-200 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-neutral-900">
                    {service.name}
                    {!service.active ? (
                      <span className="ml-2 rounded bg-neutral-200 px-2 py-0.5 text-xs font-normal">
                        inativo
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-neutral-500">
                    {service.durationMinutes} min · {money(service.priceMinor)}
                    {service.bufferBeforeMinutes || service.bufferAfterMinutes
                      ? ` · intervalo ${service.bufferBeforeMinutes}/${service.bufferAfterMinutes} min`
                      : null}
                  </p>
                </div>
                <form action={deleteService}>
                  <input type="hidden" name="id" value={service.id} />
                  <button type="submit" className="text-sm text-neutral-500 underline">
                    Remover
                  </button>
                </form>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-neutral-600">Editar</summary>
                <div className="mt-3">
                  <ServiceForm service={service} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-neutral-900">Novo serviço</h2>
        <ServiceForm />
      </section>
    </div>
  );
}
