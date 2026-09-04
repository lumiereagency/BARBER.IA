import { createWaitlistRequest } from "@barber/api-contracts";
import { InvalidPhoneError } from "@barber/domain";
import { joinWaitlist } from "@/lib/waitlist";
import { fail, failFrom, parseBody, resolveShopBySlug } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const shop = await resolveShopBySlug(params.slug);
  if (!shop) return fail("NOT_FOUND", "Barbearia não encontrada");

  const parsed = await parseBody(request, createWaitlistRequest);
  if (!parsed.ok) return parsed.response;

  try {
    const { id, status } = await joinWaitlist({
      barbershopId: shop.id,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      serviceId: parsed.data.serviceId,
      professionalId: parsed.data.professionalId,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      timeRangeStart: parsed.data.timeRangeStart,
      timeRangeEnd: parsed.data.timeRangeEnd,
      acceptedTermsVersion: parsed.data.acceptedTermsVersion,
      contactConsentTextVersion: parsed.data.contactConsentTextVersion,
    });

    return Response.json({ id, status }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidPhoneError) return fail("VALIDATION_ERROR", "Telefone inválido");
    return failFrom(error);
  }
}
