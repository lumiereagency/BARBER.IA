// Worker de efeitos assíncronos (Parte 2 §10).
//
// Consome outbox_events, escrito na MESMA transação da mudança de domínio —
// por isso um efeito nunca se perde se o worker cair, e a reserva nunca depende
// dele para ser válida (Parte 1 §3).
//
// Cada handler precisa ser idempotente: o outbox garante entrega ao menos uma
// vez, não exatamente uma vez.

import { pathToFileURL } from "node:url";

import { prisma } from "@barber/db";
import {
  reconcileCalendar,
  syncAppointmentToCalendar,
  syncRescheduledAppointment,
} from "@barber/integrations";
import { recomputeCustomerCrm } from "./handlers/crm.ts";
import { detectSmartOpportunity } from "./handlers/smart-opportunity.ts";

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  RECOMPUTE_CUSTOMER_CRM: (payload) =>
    recomputeCustomerCrm({ barbershopCustomerId: String(payload.barbershopCustomerId) }),

  // A sincronização é convergente: lê o estado atual do agendamento e faz o
  // calendário refletir. Por isso os três eventos chamam a mesma coisa — o que
  // decide criar ou remover é o banco, não o nome do evento.
  APPOINTMENT_CONFIRMED: (payload) =>
    syncAppointmentToCalendar({ appointmentId: String(payload.appointmentId) }),
  APPOINTMENT_CANCELLED: (payload) =>
    syncAppointmentToCalendar({ appointmentId: String(payload.appointmentId) }),
  APPOINTMENT_RESCHEDULED: (payload) =>
    syncRescheduledAppointment({
      appointmentId: String(payload.appointmentId),
      previousAppointmentId: payload.previousAppointmentId
        ? String(payload.previousAppointmentId)
        : null,
    }),
  /// Enfileirado pela reconciliação, não por uma mudança de domínio
  SYNC_CALENDAR: (payload) =>
    syncAppointmentToCalendar({ appointmentId: String(payload.appointmentId) }),

  DETECT_SMART_OPPORTUNITY: (payload) =>
    detectSmartOpportunity({ appointmentId: String(payload.appointmentId) }),
};

/// Espera exponencial: 1min, 2min, 4min… Falha transitória de rede não deve
/// virar tempestade de retentativa.
function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 60);
}

export async function processBatch(): Promise<{ processados: number; falhas: number }> {
  const events = await prisma.outboxEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    orderBy: { availableAt: "asc" },
    take: BATCH_SIZE,
  });

  let processados = 0;
  let falhas = 0;

  for (const event of events) {
    // Marcar como PROCESSING antes de agir: se o worker morrer no meio, o
    // evento não é reprocessado em paralelo por outra instância.
    const reservado = await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });
    if (reservado.count === 0) continue;

    const handler = HANDLERS[event.type];

    const attempt = await prisma.jobAttempt.create({
      data: {
        outboxEventId: event.id,
        jobKey: `${event.type}:${event.id}`,
        attempt: event.attempts + 1,
        status: "RUNNING",
      },
    });

    try {
      if (!handler) throw new Error(`Nenhum handler para ${event.type}`);

      await handler((event.payload ?? {}) as Record<string, unknown>);

      await prisma.$transaction([
        prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: "DONE", processedAt: new Date(), lastError: null },
        }),
        prisma.jobAttempt.update({
          where: { id: attempt.id },
          data: { status: "SUCCEEDED", finishedAt: new Date() },
        }),
      ]);

      processados++;
    } catch (error) {
      const mensagem = (error as Error).message;
      const tentativas = event.attempts + 1;
      // Esgotadas as tentativas, vai para dead-letter em vez de girar para
      // sempre — e fica visível para o admin (Parte 2 §10).
      const esgotou = tentativas >= MAX_ATTEMPTS;

      await prisma.$transaction([
        prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: esgotou ? "DEAD_LETTER" : "PENDING",
            lastError: mensagem,
            availableAt: new Date(Date.now() + backoffMinutes(tentativas) * 60000),
          },
        }),
        prisma.jobAttempt.update({
          where: { id: attempt.id },
          data: { status: "FAILED", error: mensagem, finishedAt: new Date() },
        }),
      ]);

      console.error(`[outbox] ${event.type} ${event.id} falhou:`, mensagem);
      falhas++;
    }
  }

  return { processados, falhas };
}

/// Holds vencidos precisam sair da tabela: a constraint de exclusão não
/// distingue expirado de ativo, então um hold morto continuaria bloqueando o
/// horário até ser removido (docs/architecture.md §3).
export async function purgeExpiredHolds(): Promise<number> {
  const { count } = await prisma.appointmentHold.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}

/// Vaga vencida (o horário chegou e ninguém confirmou) sai do estado OPEN —
/// nunca é apagada, para o histórico de oportunidades continuar consultável.
export async function expireSmartOpportunities(): Promise<number> {
  const { count } = await prisma.smartOpportunity.updateMany({
    where: { status: "OPEN", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  return count;
}

/// Reconciliação é varredura, não reação: roda em intervalo próprio para não
/// consultar todas as conexões a cada ciclo de 5 segundos.
const RECONCILE_INTERVAL_MS = 5 * 60_000;
let proximaReconciliacao = 0;

async function tick(): Promise<void> {
  const liberados = await purgeExpiredHolds();
  const vagasExpiradas = await expireSmartOpportunities();
  const { processados, falhas } = await processBatch();

  let reconciliados = 0;
  if (Date.now() >= proximaReconciliacao) {
    proximaReconciliacao = Date.now() + RECONCILE_INTERVAL_MS;
    // Falha aqui não pode derrubar o ciclo: o processamento do outbox é mais
    // importante que a varredura, e ela tenta de novo em cinco minutos.
    reconciliados = await reconcileCalendar().catch((error: unknown) => {
      console.error("[worker] reconciliação falhou:", error);
      return 0;
    });
  }

  if (liberados || vagasExpiradas || processados || falhas || reconciliados) {
    console.info(
      `[worker] holds liberados: ${liberados}, vagas expiradas: ${vagasExpiradas}, ` +
        `eventos: ${processados}, falhas: ${falhas}, reconciliados: ${reconciliados}`
    );
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");

  if (once) {
    await tick();
    await prisma.$disconnect();
    return;
  }

  console.info("[worker] iniciado");
  let parando = false;

  for (const sinal of ["SIGINT", "SIGTERM"]) {
    process.on(sinal, () => {
      console.info(`[worker] ${sinal} recebido, encerrando após o ciclo atual`);
      parando = true;
    });
  }

  while (!parando) {
    try {
      await tick();
    } catch (error) {
      console.error("[worker] ciclo falhou:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  await prisma.$disconnect();
}

// Só roda o laço quando executado direto; importar para teste não dispara nada.
// Comparar a URL do módulo com a do processo é o único jeito exato: casar o
// caminho por substring faria o arquivo de teste, que também vive em `worker/`,
// levantar o laço infinito.
const executadoDireto =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDireto) {
  main().catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
}
