import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@barber/db";
import { BookingWizard } from "@/components/booking-wizard";

export const dynamic = "force-dynamic";

/// Versão do texto aceito. Enquanto os textos jurídicos definitivos não
/// existem (decisão §19 #10, ainda pendente), o fluxo roda com uma versão de
/// desenvolvimento — nenhuma barbearia real pode receber cliente antes disso.
const TERMS_VERSION = process.env.TERMS_VERSION ?? "dev-0";

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { servico?: string };
}) {
  const shop = await prisma.barbershop.findUnique({
    where: { slug: params.slug },
    include: {
      services: { where: { active: true }, orderBy: { publicOrder: "asc" } },
      professionals: { where: { active: true }, orderBy: { bookingPriority: "asc" } },
    },
  });

  if (!shop || shop.status === "SUSPENDED") notFound();

  const initialServiceId = shop.services.some((service) => service.id === searchParams.servico)
    ? searchParams.servico
    : undefined;

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-white px-5 py-8">
      <header className="mb-6">
        <Link href={`/b/${shop.slug}`} className="text-sm text-neutral-500">
          ← {shop.name}
        </Link>
      </header>

      <BookingWizard
        slug={shop.slug}
        services={shop.services.map((service) => ({
          id: service.id,
          name: service.name,
          durationMinutes: service.durationMinutes,
          priceMinor: service.priceMinor,
        }))}
        professionals={shop.professionals.map((professional) => ({
          id: professional.id,
          displayName: professional.displayName,
        }))}
        initialServiceId={initialServiceId}
        termsVersion={TERMS_VERSION}
      />
    </main>
  );
}
