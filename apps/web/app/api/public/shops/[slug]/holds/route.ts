import { prisma } from "@barber/db";
import { createHoldRequest } from "@barber/api-contracts";
import { addMinutes } from "@barber/domain";
import { createHold } from "@/lib/booking";
import { fail, failFrom, parseBody, resolveShopBySlug } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const shop = await resolveShopBySlug(params.slug);
  if (!shop) return fail("NOT_FOUND", "Barbearia não encontrada");

  const parsed = await parseBody(request, createHoldRequest);
  if (!parsed.ok) return parsed.response;

  const { serviceId, professionalId, startsAt } = parsed.data;

  // Duração e buffers vêm do servidor, nunca do corpo da requisição: aceitar
  // do cliente deixaria alguém reservar 5 minutos de um serviço de uma hora.
  const [service, link] = await Promise.all([
    prisma.service.findFirst({
      where: { id: serviceId, barbershopId: shop.id, active: true },
    }),
    prisma.professionalService.findFirst({
      where: {
        serviceId,
        professionalId,
        barbershopId: shop.id,
        active: true,
        professional: { active: true },
      },
    }),
  ]);

  if (!service) return fail("NOT_FOUND", "Serviço não encontrado");
  if (!link) return fail("VALIDATION_ERROR", "Este profissional não realiza esse serviço");

  const start = new Date(startsAt);
  const duration = link.customDurationMinutes ?? service.durationMinutes;
  const end = addMinutes(start, duration);

  try {
    const { holdToken, expiresAt } = await createHold({
      barbershopId: shop.id,
      professionalId,
      serviceId,
      startsAt: start,
      endsAt: end,
      occupiesFrom: addMinutes(start, -service.bufferBeforeMinutes),
      occupiesTo: addMinutes(end, service.bufferAfterMinutes),
      holdDurationMinutes: shop.holdDurationMinutes,
    });

    return Response.json(
      {
        holdToken,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        professionalId,
        expiresAt: expiresAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    return failFrom(error);
  }
}
