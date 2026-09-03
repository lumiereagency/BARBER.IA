# BARBER SaaS

SaaS multi-tenant para pequenas barbearias. Ver `docs/product-scope-part1.md`
(produto, escopo, jornadas e decisões de negócio) e `docs/architecture.md`
(stack e arquitetura técnica) antes de mexer no código.

## Setup local

```bash
cp .env.example .env   # ajuste DATABASE_URL se necessário
npm install
npm run db:migrate     # aplica prisma/migrations em um Postgres local
npm run dev
```

Para o worker de jobs assíncronos (WhatsApp, Google Calendar, lembretes):

```bash
npm run worker
```

## Estrutura

- `app/` — Next.js App Router, organizado por área: `(public)` (página da
  barbearia, gestão sem conta, vaga), `(customer)` (área do cliente logado),
  `(dashboard)` (painel da barbearia), `(superadmin)`.
- `prisma/schema.prisma` — modelo de dados. A constraint que impede
  sobreposição de horários confirmados do mesmo profissional é adicionada
  manualmente na migration inicial (não é expressável em Prisma puro).
- `lib/` — motor de disponibilidade, Agenda Inteligente, adapters
  (notificações, calendário, cobrança).
- `worker/` — processa a fila de efeitos colaterais assíncronos (outbox).

## Status

Fundação técnica (Parte 2): stack definida, schema de dados modelado e
validado contra Postgres real (incluindo a constraint anti-conflito de
horário), scaffold do projeto com build e typecheck passando. Telas e regras
de negócio ainda não implementadas — ver TODOs nos placeholders de `app/`.
