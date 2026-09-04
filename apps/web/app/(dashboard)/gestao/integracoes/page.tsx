import { prisma } from "@barber/db";
import { canActOnProfessional } from "@barber/domain";
import { googleOAuthConfig } from "@barber/integrations";
import { requirePermission } from "@/lib/auth";
import { describeIntegration } from "@/lib/integrations";
import { connectGoogleCalendar, disconnectGoogleCalendar } from "./actions";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  ok: "bg-success/12 text-success",
  warn: "bg-warning/12 text-warning",
  bad: "bg-error/12 text-error",
  off: "bg-surface-3 text-ink",
};

const AVISOS: Record<string, string> = {
  ok: "Calendário conectado.",
  cancelado: "A conexão foi cancelada na tela do Google. Nada mudou por aqui.",
  invalido: "O retorno do Google não pôde ser conferido. Comece a conexão de novo.",
  sem_permissao: "Você não pode conectar o calendário desse profissional.",
  indisponivel: "A conexão com o Google Agenda ainda não está liberada nesta instalação.",
  falha_google: "O Google não concluiu a conexão. Tente de novo em alguns minutos.",
};

function quando(data: Date | null, timezone: string): string {
  if (!data) return "ainda não";
  return data.toLocaleString("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: { ok?: string; erro?: string };
}) {
  const session = await requirePermission("integrations.read");
  const disponivel = googleOAuthConfig() !== null;

  const [barbershop, professionals, connections] = await Promise.all([
    prisma.barbershop.findUniqueOrThrow({
      where: { id: session.barbershopId },
      select: { timezone: true },
    }),
    prisma.professional.findMany({
      where: { barbershopId: session.barbershopId, active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
    prisma.integrationConnection.findMany({
      where: { barbershopId: session.barbershopId, provider: "GOOGLE_CALENDAR" },
    }),
  ]);

  const porProfissional = new Map(connections.map((item) => [item.professionalId, item]));

  // Quantos compromissos futuros ainda não chegaram ao calendário. É o número
  // que diz se a integração está realmente entregando, e não só "conectada".
  const pendentesPorConexao = new Map<string, number>();
  for (const connection of connections) {
    if (connection.status === "DISCONNECTED" || !connection.professionalId) continue;
    pendentesPorConexao.set(
      connection.id,
      await prisma.appointment.count({
        where: {
          barbershopId: session.barbershopId,
          professionalId: connection.professionalId,
          status: "CONFIRMED",
          startsAt: { gte: new Date() },
          NOT: { calendarSyncs: { some: { connectionId: connection.id, status: "SYNCED" } } },
        },
      })
    );
  }

  const aviso = searchParams.ok ? AVISOS.ok : AVISOS[searchParams.erro ?? ""];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Google Agenda</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Envia os horários marcados para o Google Agenda de cada profissional. Os agendamentos
          continuam valendo aqui mesmo se o Google falhar.
        </p>
      </header>

      {aviso ? (
        <p
          className={`rounded-xl border p-3 text-sm ${
            searchParams.ok
              ? "border-success/35 bg-success/12 text-success"
              : "border-warning/35 bg-warning/12 text-warning"
          }`}
        >
          {aviso}
        </p>
      ) : null}

      {!disponivel ? (
        <p className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-4 text-sm text-ink-secondary">
          A conexão com o Google ainda não foi liberada nesta instalação. Enquanto isso, a agenda
          daqui continua sendo a fonte de verdade — nada se perde.
        </p>
      ) : null}

      {professionals.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-subtle bg-surface-1 p-6 text-center text-sm text-ink-secondary">
          Cadastre um profissional para conectar um calendário.
        </p>
      ) : (
        <ul className="space-y-3">
          {professionals.map((professional) => {
            const connection = porProfissional.get(professional.id) ?? null;
            const estado = describeIntegration(connection);
            const podeAgir = canActOnProfessional(
              session.membership,
              "integrations.write",
              professional.id
            );
            const pendentes = connection ? (pendentesPorConexao.get(connection.id) ?? 0) : 0;
            const conectado = connection?.status === "CONNECTED" || connection?.status === "UNSTABLE";

            return (
              <li
                key={professional.id}
                className="rounded-xl border border-line-subtle bg-surface-1 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{professional.displayName}</p>
                    {connection?.externalAccount ? (
                      <p className="text-sm text-ink-secondary">{connection.externalAccount}</p>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${TONE[estado.tone]}`}
                  >
                    {estado.label}
                  </span>
                </div>

                <p className="mt-2 text-sm text-ink-secondary">{estado.detail}</p>

                {conectado ? (
                  <p className="mt-1 text-xs text-ink-secondary">
                    Último envio: {quando(connection?.lastSyncAt ?? null, barbershop.timezone)}
                    {pendentes > 0
                      ? ` · ${pendentes} ${pendentes === 1 ? "horário ainda não foi enviado" : "horários ainda não foram enviados"}`
                      : null}
                  </p>
                ) : null}

                {podeAgir ? (
                  <div className="mt-3 flex gap-3">
                    {disponivel ? (
                      <form action={connectGoogleCalendar}>
                        <input type="hidden" name="professionalId" value={professional.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-ink-inverse"
                        >
                          {conectado
                            ? "Reconectar"
                            : estado.needsReconnect
                              ? "Reconectar"
                              : "Conectar"}
                        </button>
                      </form>
                    ) : null}

                    {connection && connection.status !== "DISCONNECTED" ? (
                      <form action={disconnectGoogleCalendar}>
                        <input type="hidden" name="professionalId" value={professional.id} />
                        <button type="submit" className="text-sm text-ink-secondary underline">
                          Desconectar
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-ink-secondary">
        Desconectar não apaga do Google os compromissos já enviados: eles são da agenda do
        profissional. Ao reconectar a mesma conta, eles são atualizados, não duplicados.
      </p>
    </div>
  );
}
