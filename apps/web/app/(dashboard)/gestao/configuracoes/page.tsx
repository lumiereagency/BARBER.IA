import { prisma } from "@barber/db";
import { requirePermission } from "@/lib/auth";
import { BarbershopSettingsForm } from "@/components/barbershop-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requirePermission("barbershop.settings.read");

  const shop = await prisma.barbershop.findUniqueOrThrow({
    where: { id: session.barbershopId },
  });

  const canWrite = session.membership.role === "OWNER" || session.membership.role === "ADMIN";
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-900">Configurações</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Dados da barbearia, endereço da página e regras de agendamento.
        </p>
      </header>

      <div className="rounded-xl bg-white p-4">
        <p className="text-sm font-medium text-neutral-900">Sua página de agendamento</p>
        <p className="mt-1 break-all text-sm text-neutral-600">
          {baseUrl}/b/{shop.slug}
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          É este link que você divulga para os clientes agendarem.
        </p>
      </div>

      {canWrite ? (
        <BarbershopSettingsForm
          shop={{
            name: shop.name,
            slug: shop.slug,
            timezone: shop.timezone,
            phone: shop.phone,
            cancellationPolicy: shop.cancellationPolicy,
            holdDurationMinutes: shop.holdDurationMinutes,
            slotGranularityMinutes: shop.slotGranularityMinutes,
            minimumNoticeMinutes: shop.minimumNoticeMinutes,
            cancellationNoticeMinutes: shop.cancellationNoticeMinutes,
            bookingWindowDays: shop.bookingWindowDays,
          }}
        />
      ) : (
        <p className="rounded-lg bg-neutral-100 p-4 text-sm text-neutral-600">
          Só o proprietário e administradores alteram estas configurações.
        </p>
      )}
    </div>
  );
}
