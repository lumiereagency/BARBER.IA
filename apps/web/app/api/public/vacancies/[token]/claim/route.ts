import { prisma } from "@barber/db";
import { claimVacancyRequest } from "@barber/api-contracts";
import { InvalidPhoneError } from "@barber/domain";
import { claimSmartOpportunity } from "@/lib/smart-opportunity";
import { buildAppointmentPayload } from "@/lib/appointment-view";
import { fail, failFrom, hashRequest, parseBody, withIdempotency } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const parsed = await parseBody(request, claimVacancyRequest);
  if (!parsed.ok) return parsed.response;

  const idempotencyKey = request.headers.get("idempotency-key");
  const requestHash = await hashRequest(parsed.data);

  try {
    return await withIdempotency(
      `public.vacancy.claim:${params.token}`,
      idempotencyKey,
      requestHash,
      async () => {
        const { appointmentId, managementToken } = await claimSmartOpportunity({
          token: params.token,
          serviceId: parsed.data.serviceId,
          customerName: parsed.data.customerName,
          customerPhone: parsed.data.customerPhone,
          acceptedTermsVersion: parsed.data.acceptedTermsVersion,
        });

        const appointment = await prisma.appointment.findUniqueOrThrow({
          where: { id: appointmentId },
        });
        const shop = await prisma.barbershop.findUniqueOrThrow({
          where: { id: appointment.barbershopId },
        });

        return { status: 201, body: buildAppointmentPayload(appointment, shop, managementToken) };
      }
    );
  } catch (error) {
    if (error instanceof InvalidPhoneError) return fail("VALIDATION_ERROR", "Telefone inválido");
    return failFrom(error);
  }
}
