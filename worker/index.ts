// Worker separado que processa a tabela OutboxJob (WhatsApp, Google Calendar,
// lembretes). Roda como processo independente do Next.js — ver docs/architecture.md §1.
//
// A reserva em si nunca depende deste worker: OutboxJob é apenas o mecanismo
// para efeitos colaterais assíncronos e idempotentes (seção 3 da Parte 1).

import { prisma } from "../lib/prisma";

async function processPendingJobs() {
  const jobs = await prisma.outboxJob.findMany({
    where: { status: "PENDING", runAfter: { lte: new Date() } },
    take: 20,
  });

  for (const job of jobs) {
    // TODO: despachar por job.type para os adapters em lib/notifications e lib/calendar.
    console.log(`Processando job ${job.id} (${job.type})`);
  }
}

async function main() {
  // TODO: substituir por um polling/loop de produção real com backoff.
  await processPendingJobs();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
