# BARBER SaaS

SaaS multi-tenant para pequenas barbearias: página pública, agendamento online
sem login obrigatório, agenda, clientes e CRM automático.

Leia antes de mexer no código:

- `docs/product-scope-part1.md` — produto, jornadas e decisões de negócio
- `docs/tech-review-part2.md` — confronto técnico, defeitos encontrados e decisões pendentes
- `docs/architecture.md` — stack, estrutura e garantias do banco

## Setup local

```bash
cp .env.example .env          # preencha AUTH_SECRET e TOKEN_HMAC_SECRET
pnpm install
pnpm infra:up                 # Postgres + Redis via docker compose
pnpm db:migrate
pnpm dev
```

Worker de jobs assíncronos:

```bash
pnpm worker
```

## Primeiro uso

Depois de subir o servidor, acesse `/criar-conta`: o proprietário cria a conta e
a barbearia, cadastra serviços e equipe, e a página pública passa a receber
agendamentos em `/b/{slug}`. Não é necessário semear o banco.

## Testes das garantias do banco

As regras que impedem conflito de agenda e duplicação de cliente vivem no
PostgreSQL, não na aplicação. Elas têm teste próprio, executado contra um banco
real:

```bash
pnpm --filter @barber/db test:guarantees
```

Cobre agendamento duplo sob concorrência real, semântica de ocupação por status,
coordenação hold × confirmação por advisory lock, buffers protegidos pela
constraint, deduplicação de cliente por telefone e isolamento entre barbearias.

Suítes de interface e fluxo completo (precisam do servidor de pé):

```bash
pnpm --filter @barber/web exec playwright install chromium   # uma vez
pnpm --filter @barber/web test:ui
BASE_URL=http://localhost:3000 pnpm --filter @barber/web test:e2e
```

## Estrutura

```
apps/web        Next.js: público, cliente, painel, superadmin
apps/worker     consumidor do outbox transacional
packages/db     schema Prisma, migrations, testes de garantia
packages/domain regras puras, sem dependência de framework
packages/api-contracts  contratos zod compartilhados
packages/config validação das variáveis de ambiente
infra/docker    Postgres + Redis para desenvolvimento
```

## Status

Marcos 0, 1 e 2 concluídos: autenticação da equipe com sessão revogável e RBAC,
onboarding do proprietário, configuração de serviços, equipe e jornada, e o
motor de agendamento com fluxo público ponta a ponta.

A seguir, Marco 3 (painel diário: agenda semanal, reserva manual, concluído e
no-show). Pendências de lançamento seguem em `docs/delivery-part3.md` §10 —
a mais urgente são os textos legais, que o consentimento grava por versão.
