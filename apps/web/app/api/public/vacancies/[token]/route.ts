import { prisma } from "@barber/db";
import { findOpenOpportunityByToken } from "@/lib/smart-opportunity";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const opportunity = await findOpenOpportunityByToken(params.token);
  if (!opportunity) return fail("NOT_FOUND", "Vaga não encontrada");

  const available = opportunity.status === "OPEN" && opportunity.expiresAt > new Date();

  const services = await prisma.service.findMany({
    where: {
      id: { in: opportunity.compatibleServiceIds },
      barbershopId: opportunity.barbershopId,
      active: true,
    },
    orderBy: { publicOrder: "asc" },
  });

  return Response.json({
    shop: {
      name: opportunity.barbershop.name,
      slug: opportunity.barbershop.slug,
      timezone: opportunity.barbershop.timezone,
    },
    startsAt: opportunity.startsAt.toISOString(),
    endsAt: opportunity.endsAt.toISOString(),
    professionalName: opportunity.professional.displayName,
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      priceMinor: service.priceMinor,
      durationMinutes: service.durationMinutes,
    })),
    expiresAt: opportunity.expiresAt.toISOString(),
    available,
  });
}
