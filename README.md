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

## Testes das garantias do banco

As regras que impedem conflito de agenda e duplicação de cliente vivem no
PostgreSQL, não na aplicação. Elas têm teste próprio, executado contra um banco
real:

```bash
pnpm --filter @barber/db test:guarantees
```

Cobre agendamento duplo sob concorrência real, semântica de ocupação por status,
coordenação hold × confirmação por advisory lock, deduplicação de cliente por
telefone e isolamento entre barbearias.

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

Fundação reconciliada com a Parte 2: monorepo, schema completo migrado e
validado, contratos públicos tipados. Motor de disponibilidade, autenticação,
endpoints e telas ainda não implementados.
