import { addMinutes } from "@barber/domain";
import { findByManagementToken } from "@/lib/booking";
import { summarize } from "@/lib/appointment-view";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const appointment = await findByManagementToken(params.token);

  // Token inexistente e token expirado dão a mesma resposta: distinguir os dois
  // ajudaria quem estivesse tentando adivinhar links (Parte 2 §4).
  if (!appointment) return fail("NOT_FOUND", "Link inválido ou expirado");
  if (appointment.managementTokenExpiresAt && appointment.managementTokenExpiresAt < new Date()) {
    return fail("NOT_FOUND", "Link inválido ou expirado");
  }

  const shop = appointment.barbershop;
  const active = appointment.status === "CONFIRMED";
  const noticeLimit = addMinutes(new Date(), shop.cancellationNoticeMinutes);
  const withinNotice = appointment.startsAt > noticeLimit;

  let blockedReason: string | null = null;
  if (!active) blockedReason = "Este agendamento não está mais ativo.";
  else if (!withinNotice) blockedReason = "Passou do prazo para alterar pelo link. Fale com a barbearia.";

  return Response.json({
    appointment: summarize(appointment, shop),
    shop: {
      name: shop.name,
      slug: shop.slug,
      phone: shop.phone,
      cancellationPolicy: shop.cancellationPolicy,
    },
    // Quem decide o que é permitido é o servidor; a tela apenas reflete.
    permissions: {
      canCancel: active && withinNotice,
      canReschedule: active && withinNotice,
      blockedReason,
    },
  });
}
