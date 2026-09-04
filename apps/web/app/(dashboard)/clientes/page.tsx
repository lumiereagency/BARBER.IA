import Link from "next/link";
import { Users } from "lucide-react";
import { prisma } from "@barber/db";
import { formatPhoneBR, instantToLocalDate } from "@barber/domain";
import { requirePermission } from "@/lib/auth";
import { ClientesSearch } from "@/components/clientes-search";

export const dynamic = "force-dynamic";

// instantToLocalDate devolve a data-chave (YYYY-MM-DD) — reembrulhar ao
// meio-dia UTC evita o dia rolar errado ao formatar (mesmo truque de
// apps/web/app/(dashboard)/agenda/page.tsx).
function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: { q?: string; retorno?: string };
}) {
  const session = await requirePermission("customers.read");
  const query = (searchParams.q ?? "").trim();
  const soRetorno = searchParams.retorno === "1";

  const shop = await prisma.barbershop.findUniqueOrThrow({
    where: { id: session.barbershopId },
    select: { timezone: true },
  });

  const relations = await prisma.barbershopCustomer.findMany({
    where: {
      barbershopId: session.barbershopId,
      ...(query
        ? {
            OR: [
              { currentName: { contains: query, mode: "insensitive" } },
              { normalizedPhone: { contains: query.replace(/\D/g, "") || query } },
            ],
          }
        : {}),
      ...(soRetorno ? { completedVisitsCount: { gte: 2 } } : {}),
    },
    orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { currentName: "asc" }],
    take: 100,
  });

  const totalClientes = await prisma.barbershopCustomer.count({
    where: { barbershopId: session.barbershopId },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Clientes</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Construído sozinho pelo histórico de agendamentos — nada aqui foi digitado à mão.
        </p>
      </header>

      {totalClientes === 0 ? (
        <div className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-6 text-center">
          <Users size={28} strokeWidth={1.5} className="mx-auto text-ink-muted" />
          <p className="mt-3 font-medium text-ink">Nenhum cliente ainda</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Assim que alguém agendar pela sua página, a relação aparece aqui.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <ClientesSearch initialQuery={query} />
            </div>
            <Link
              href={soRetorno ? "/clientes" : "/clientes?retorno=1"}
              className={`inline-flex shrink-0 items-center justify-center rounded-xl border px-3 py-2.5 text-sm font-medium ${
                soRetorno
                  ? "border-brand-500 bg-brand-soft text-brand-400"
                  : "border-line-subtle text-ink-secondary"
              }`}
            >
              Já voltaram
            </Link>
          </div>

          {relations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-6 text-center text-sm text-ink-secondary">
              Nenhum cliente encontrado{query ? ` para "${query}"` : ""}.
            </p>
          ) : (
            <ul className="space-y-2">
              {relations.map((cliente) => {
                const retorna = cliente.completedVisitsCount >= 2;
                return (
                  <li key={cliente.id}>
                    <Link
                      href={`/clientes/${cliente.id}`}
                      className="flex items-center gap-3 rounded-xl border border-line-subtle bg-surface-1 p-4 hover:bg-surface-2"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink-secondary">
                        {iniciais(cliente.currentName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{cliente.currentName}</p>
                        <p className="text-sm text-ink-secondary">{formatPhoneBR(cliente.normalizedPhone)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        {retorna ? (
                          <span className="inline-block rounded-full bg-success/12 px-2.5 py-1 text-xs font-semibold text-success">
                            Retorna
                          </span>
                        ) : (
                          <span className="inline-block rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">
                            1ª visita
                          </span>
                        )}
                        <p className="mt-1 text-xs text-ink-muted">
                          {cliente.lastVisitAt
                            ? `Última em ${shortDate(instantToLocalDate(cliente.lastVisitAt, shop.timezone))}`
                            : "Sem visita concluída"}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes.at(-1)?.[0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
}
