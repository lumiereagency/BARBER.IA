import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@barber/db";

export const dynamic = "force-dynamic";

function formatPrice(minor: number): string {
  return (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function BarbershopPublicPage({ params }: { params: { slug: string } }) {
  const shop = await prisma.barbershop.findUnique({
    where: { slug: params.slug },
    include: {
      services: { where: { active: true }, orderBy: { publicOrder: "asc" } },
      professionals: { where: { active: true }, orderBy: { bookingPriority: "asc" } },
    },
  });

  if (!shop || shop.status === "SUSPENDED") notFound();

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-white px-5 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-neutral-900">{shop.name}</h1>
        {shop.address ? (
          <p className="mt-1 text-sm text-neutral-500">
            {(shop.address as { district?: string; city?: string }).district}
            {(shop.address as { city?: string }).city
              ? ` · ${(shop.address as { city?: string }).city}`
              : null}
          </p>
        ) : null}
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Serviços
        </h2>

        {shop.services.length === 0 ? (
          <p className="rounded-lg bg-neutral-50 p-4 text-sm text-neutral-600">
            Esta barbearia ainda não publicou seus serviços.
          </p>
        ) : (
          <ul className="space-y-3">
            {shop.services.map((service) => (
              <li key={service.id}>
                <Link
                  href={`/b/${shop.slug}/agendar?servico=${service.id}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                >
                  <span>
                    <span className="block font-medium text-neutral-900">{service.name}</span>
                    <span className="block text-sm text-neutral-500">
                      {service.durationMinutes} min
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-medium text-neutral-900">
                    {formatPrice(service.priceMinor)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {shop.professionals.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
            Profissionais
          </h2>
          <ul className="flex flex-wrap gap-2">
            {shop.professionals.map((professional) => (
              <li
                key={professional.id}
                className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-700"
              >
                {professional.displayName}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
