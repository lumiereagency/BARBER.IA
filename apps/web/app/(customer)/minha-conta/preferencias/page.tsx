import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@barber/db";
import { getCustomerSession } from "@/lib/customer-session";
import { CommunicationPreferences } from "@/components/communication-preferences";
import { CloseAccount } from "@/components/close-account";

export const dynamic = "force-dynamic";

export default async function CustomerPreferencesPage() {
  const session = await getCustomerSession();
  if (!session) redirect("/entrar-cliente");

  const relations = await prisma.barbershopCustomer.findMany({
    where: { customerId: session.customerId },
    include: {
      barbershop: true,
      consents: {
        where: { purpose: "MARKETING", status: "GRANTED" },
        select: { channel: true },
      },
    },
  });

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-surface-1 px-5 py-8">
      <header className="mb-6">
        <Link href="/minha-conta" className="text-sm text-ink-secondary">
          ← Meus agendamentos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">
          Preferências e privacidade
        </h1>
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-secondary">
          Promoções
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Cada barbearia é separada: aceitar em uma não vale para as outras. Avisos sobre seus
          próprios horários continuam chegando, independentemente disso.
        </p>

        {relations.length === 0 ? (
          <p className="mt-4 rounded-lg bg-canvas p-4 text-sm text-ink-secondary">
            Você ainda não tem relação com nenhuma barbearia por aqui.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {relations.map((relation) => (
              <CommunicationPreferences
                key={relation.id}
                relationId={relation.id}
                barbershopName={relation.barbershop.name}
                granted={relation.consents.map((consent) => consent.channel)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10 border-t border-line-subtle pt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-secondary">
          Encerrar conta
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Seus dados pessoais são removidos. Cada barbearia mantém o registro dos atendimentos
          que realizou, sem identificar você.
        </p>
        <div className="mt-4">
          <CloseAccount />
        </div>
      </section>
    </main>
  );
}
