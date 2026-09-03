import { cancelAppointmentRequest } from "@barber/api-contracts";
import { cancelAppointment, findByManagementToken } from "@/lib/booking";
import { fail, failFrom, hashRequest, parseBody, withIdempotency } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const appointment = await findByManagementToken(params.token);
  if (!appointment) return fail("NOT_FOUND", "Link inválido ou expirado");

  const parsed = await parseBody(request, cancelAppointmentRequest);
  if (!parsed.ok) return parsed.response;

  const requestHash = await hashRequest(parsed.data);

  try {
    return await withIdempotency(
      `public.appointment.cancel:${appointment.id}`,
      request.headers.get("idempotency-key"),
      requestHash,
      async () => {
        await cancelAppointment({
          appointmentId: appointment.id,
          actorType: "CUSTOMER",
          reason: parsed.data.reason,
        });
        return { status: 200, body: { status: "CANCELLED_BY_CUSTOMER" } };
      }
    );
  } catch (error) {
    return failFrom(error);
  }
}
