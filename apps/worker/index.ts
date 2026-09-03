// Worker de efeitos assíncronos (Parte 2 §10).
//
// Consome a tabela outbox_events, escrita na MESMA transação da mudança de
// domínio — por isso um efeito nunca se perde se o worker cair, e a reserva
// nunca depende dele para ser válida (Parte 1 §3).
//
// Próximas etapas: despacho por tipo para os adapters (Google Calendar,
// lembretes, matching de lista de espera, recálculo de CRM), retentativa
// exponencial e dead-letter visível no painel.

import { prisma } from "@barber/db";

const BATCH_SIZE = 20;

async function processPendingEvents() {
  const events = await prisma.outboxEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    orderBy: { availableAt: "asc" },
    take: BATCH_SIZE,
  });

  for (const event of events) {
    // TODO: despachar por event.type; cada handler é idempotente e registra
    // sua tentativa em job_attempts pela chave de idempotência.
    console.log(`outbox ${event.id} (${event.type}) pendente`);
  }

  return events.length;
}

async function main() {
  const processed = await processPendingEvents();
  console.log(`${processed} evento(s) lidos`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
