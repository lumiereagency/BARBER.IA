import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { prisma } from "@barber/db";
import { can, formatPhoneBR } from "@barber/domain";
import { requirePermission } from "@/lib/auth";
import { saveCustomerNotes } from "../actions";

export const dynamic = "force-dynamic";

const money = (minor: number) =>
  (minor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fullDate = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });

const CONSENT_PURPOSE: Record<string, string> = {
  OPERATIONAL: "Operacional",
  MARKETING: "Marketing",
};

const CONSENT_CHANNEL: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "E-mail",
};

export default async function CustomerProfilePage({ params }: { params: { id: string } }) {
  const session = await requirePermission("customers.read");
  const podeVerNotas = can(session.membership, "customers.notes.read");
  const podeEditar = can(session.membership, "customers.write");

  const cliente = await prisma.barbershopCustomer.findFirst({
    where: { id: params.id, barbershopId: session.barbershopId },
    include: {
      preferredProfessional: { select: { displayName: true } },
      preferredService: { select: { name: true } },
      consents: { orderBy: { capturedAt: "desc" } },
    },
  });

  if (!cliente) notFound();

  const stats = [
    { label: "Primeira visita", value: cliente.firstVisitAt ? fullDate(cliente.firstVisitAt) : "—" },
    { label: "Última visita", value: cliente.lastVisitAt ? fullDate(cliente.lastVisitAt) : "—" },
    { label: "Atendimentos concluídos", value: String(cliente.completedVisitsCount) },
    { label: "Cancelamentos", value: String(cliente.cancelledCount) },
    { label: "Não compareceu", value: String(cliente.noShowCount) },
    { label: "Total gasto", value: money(cliente.totalSpentMinor) },
    {
      label: "Ticket médio",
      value: cliente.averageTicketMinor !== null ? money(cliente.averageTicketMinor) : "—",
    },
    {
      label: "Retorna em média a cada",
      value: cliente.averageReturnDays !== null ? `${Math.round(cliente.averageReturnDays)} dias` : "—",
    },
    { label: "Profissional preferido", value: cliente.preferredProfessional?.displayName ?? "—" },
    { label: "Serviço preferido", value: cliente.preferredService?.name ?? "—" },
  ];

  const whatsappUrl = `https://wa.me/${cliente.normalizedPhone.replace(/\D/g, "")}`;

  return (
    <div className="space-y-6">
      <Link href="/clientes" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink">
        <ArrowLeft size={16} strokeWidth={1.9} />
        Clientes
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">{cliente.currentName}</h1>
          <p className="mt-1 text-sm text-ink-secondary">{formatPhoneBR(cliente.normalizedPhone)}</p>
          {cliente.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cliente.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-ink-secondary">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* Ação sempre manual — é a pessoa que decide enviar (Parte 1 §17.1) */}
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-line-subtle px-4 py-2.5 text-sm font-medium text-ink"
        >
          <MessageCircle size={16} strokeWidth={1.9} />
          Abrir WhatsApp
        </a>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-line-subtle bg-surface-1 p-4">
            <p className="text-xs text-ink-muted">{stat.label}</p>
            <p className="mt-1 font-medium text-ink">{stat.value}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-2 font-medium text-ink">Consentimento</h2>
        {cliente.consents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-4 text-sm text-ink-secondary">
            Nenhum consentimento registrado ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {cliente.consents.map((consent) => (
              <li
                key={consent.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line-subtle bg-surface-1 p-3 text-sm"
              >
                <span className="text-ink">
                  {CONSENT_PURPOSE[consent.purpose] ?? consent.purpose} por{" "}
                  {CONSENT_CHANNEL[consent.channel] ?? consent.channel}
                </span>
                {consent.status === "GRANTED" ? (
                  <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-xs font-medium text-success">
                    Concedido
                  </span>
                ) : (
                  <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                    Revogado
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          Só o cliente concede ou revoga — a equipe apenas confere antes de qualquer contato
          promocional.
        </p>
      </section>

      {podeVerNotas ? (
        <section>
          <h2 className="mb-2 font-medium text-ink">Notas</h2>
          {podeEditar ? (
            <form action={saveCustomerNotes} className="space-y-2">
              <input type="hidden" name="id" value={cliente.id} />
              <textarea
                name="notes"
                rows={4}
                defaultValue={cliente.notes ?? ""}
                placeholder="Preferências, observações do atendimento — visível só para a equipe."
                className="w-full rounded-xl border border-line-subtle bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
              />
              <button
                type="submit"
                className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-ink-inverse transition-colors hover:bg-brand-400 active:bg-brand-600"
              >
                Salvar nota
              </button>
            </form>
          ) : (
            <p className="rounded-xl border border-line-subtle bg-surface-1 p-4 text-sm text-ink">
              {cliente.notes || "Nenhuma nota registrada."}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
