import { prisma } from "@barber/db";
import { createAppointmentRequest } from "@barber/api-contracts";
import { InvalidPhoneError } from "@barber/domain";
import { confirmAppointment } from "@/lib/booking";
import { loadAvailability } from "@/lib/availability-service";
import {
  fail,
  failFrom,
  hashRequest,
  parseBody,
  resolveShopBySlug,
  withIdempotency,
} from "@/lib/http";
import { buildAppointmentPayload } from "@/lib/appointment-view";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const shop = await resolveShopBySlug(params.slug);
  if (!shop) return fail("NOT_FOUND", "Barbearia não encontrada");

  const parsed = await parseBody(request, createAppointmentRequest);
  if (!parsed.ok) return parsed.response;

  const idempotencyKey = request.headers.get("idempotency-key");
  const requestHash = await hashRequest(parsed.data);

  try {
    return await withIdempotency(
      `public.appointment.create:${shop.id}`,
      idempotencyKey,
      requestHash,
      async () => {
        const { appointmentId, managementToken } = await confirmAppointment({
          barbershopId: shop.id,
          holdToken: parsed.data.holdToken,
          customerName: parsed.data.customerName,
          customerPhone: parsed.data.customerPhone,
          acceptedTermsVersion: parsed.data.acceptedTermsVersion,
          marketingConsent: parsed.data.marketingConsent,
        });

        const appointment = await prisma.appointment.findUniqueOrThrow({
          where: { id: appointmentId },
        });

        return {
          status: 201,
          body: buildAppointmentPayload(appointment, shop, managementToken),
        };
      }
    );
  } catch (error) {
    if (error instanceof InvalidPhoneError) {
      return fail("VALIDATION_ERROR", "Telefone inválido");
    }

    // Horário perdido durante o preenchimento: em vez de só recusar, o cliente
    // recebe os horários mais próximos (Parte 1 §8).
    if ((error as Error)?.name === "SlotUnavailableError") {
      const today = new Date().toISOString().slice(0, 10);
      const inTwoWeeks = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

      const hold = await prisma.appointmentHold.findFirst({
        where: { barbershopId: shop.id },
        select: { serviceId: true },
      });

      let nearest: unknown[] = [];
      if (hold) {
        const { days } = await loadAvailability({
          barbershopId: shop.id,
          serviceId: hold.serviceId,
          from: today,
          to: inTwoWeeks,
        });
        nearest = days
          .flatMap((day) => day.slots)
          .slice(0, 3)
          .map((slot) => ({
            startsAt: slot.startsAt.toISOString(),
            endsAt: slot.endsAt.toISOString(),
            professionalId: slot.professionalId,
            professionalName: slot.professionalName,
            priceMinor: slot.priceMinor,
          }));
      }

      return Response.json(
        {
          error: {
            code: "SLOT_UNAVAILABLE",
            message: "Este horário acabou de ser preenchido.",
            details: { nearestSlots: nearest },
          },
        },
        { status: 409 }
      );
    }

    return failFrom(error);
  }
}
