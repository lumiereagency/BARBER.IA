import { availabilityQuery } from "@barber/api-contracts";
import { loadAvailability } from "@/lib/availability-service";
import { fail, failFrom, resolveShopBySlug } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  const shop = await resolveShopBySlug(params.slug);
  if (!shop) return fail("NOT_FOUND", "Barbearia não encontrada");

  const url = new URL(request.url);
  const parsed = availabilityQuery.safeParse({
    serviceId: url.searchParams.get("serviceId") ?? undefined,
    professionalId: url.searchParams.get("professionalId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Parâmetros inválidos", parsed.error.flatten());
  }

  try {
    const { timeZone, days } = await loadAvailability({
      barbershopId: shop.id,
      serviceId: parsed.data.serviceId,
      professionalId: parsed.data.professionalId,
      from: parsed.data.from,
      to: parsed.data.to,
    });

    return Response.json({
      timezone: timeZone,
      days: days.map((day) => ({
        date: day.date,
        slots: day.slots.map((slot) => ({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          professionalId: slot.professionalId,
          professionalName: slot.professionalName,
          priceMinor: slot.priceMinor,
        })),
      })),
    });
  } catch (error) {
    return failFrom(error);
  }
}
