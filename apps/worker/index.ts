// Worker de efeitos assíncronos (Parte 2 §10).
//
// Consome outbox_events, escrito na MESMA transação da mudança de domínio —
// por isso um efeito nunca se perde se o worker cair, e a reserva nunca depende
// dele para ser válida (Parte 1 §3).
//
// Cada handler precisa ser idempotente: o outbox garante entrega ao menos uma
// vez, não exatamente uma vez.

import { prisma } from "@barber/db";
import { recomputeCustomerCrm } from "./handlers/crm";

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  RECOMPUTE_CUSTOMER_CRM: (payload) =>
    recomputeCustomerCrm({ barbershopCustomerId: String(payload.barbershopCustomerId) }),

  // Efeitos que dependem de integração externa entram nos marcos seguintes.
  // Até lá são reconhecidos e descartados em vez de acumular como falha.
  APPOINTMENT_CONFIRMED: async () => {},
  APPOINTMENT_CANCELLED: async () => {},
  APPOINTMENT_RESCHEDULED: async () => {},
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

async function tick(): Promise<void> {
  const liberados = await purgeExpiredHolds();
  const { processados, falhas } = await processBatch();

  if (liberados || processados || falhas) {
    console.info(
      `[worker] holds liberados: ${liberados}, eventos: ${processados}, falhas: ${falhas}`
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
if (process.argv[1]?.includes("worker")) {
  main().catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
}
