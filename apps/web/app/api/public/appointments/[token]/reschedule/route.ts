import { prisma } from "@barber/db";
import { rescheduleAppointmentRequest } from "@barber/api-contracts";
import { findByManagementToken, rescheduleAppointment } from "@/lib/booking";
import { buildAppointmentPayload } from "@/lib/appointment-view";
import { fail, failFrom, hashRequest, parseBody, withIdempotency } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const appointment = await findByManagementToken(params.token);
  if (!appointment) return fail("NOT_FOUND", "Link inválido ou expirado");

  const parsed = await parseBody(request, rescheduleAppointmentRequest);
  if (!parsed.ok) return parsed.response;

  const requestHash = await hashRequest(parsed.data);

  try {
    return await withIdempotency(
      `public.appointment.reschedule:${appointment.id}`,
      request.headers.get("idempotency-key"),
      requestHash,
      async () => {
        const { appointmentId, managementToken } = await rescheduleAppointment({
          appointmentId: appointment.id,
          holdToken: parsed.data.holdToken,
          actorType: "CUSTOMER",
        });

        const created = await prisma.appointment.findUniqueOrThrow({
          where: { id: appointmentId },
        });

        const payload = buildAppointmentPayload(created, appointment.barbershop, managementToken);
        // Remarcar emite link novo; o anterior deixa de dar acesso de escrita.
        return { status: 200, body: { appointment: payload.appointment, manageUrl: payload.manageUrl } };
      }
    );
  } catch (error) {
    return failFrom(error);
  }
}
