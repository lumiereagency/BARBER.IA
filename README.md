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

Marcos 0 a 4 concluídos: autenticação da equipe com sessão revogável e RBAC,
onboarding do proprietário, configuração de serviços, equipe e jornada, motor
de agendamento com fluxo público ponta a ponta, painel diário — agenda por dia
e semana, encaixe no balcão, concluído/não veio, bloqueio de período e atalhos
de WhatsApp manual — e a conta do consumidor com CRM automático.

O envio do código de acesso usa hoje um provedor de desenvolvimento que apenas
registra o código no log: o provedor de SMS ainda não foi decidido (pendência
§19 #2), e o código se recusa a rodar assim em produção.

A seguir, Marco 5 (Google Calendar e integrações resilientes). Pendências de
lançamento seguem em `docs/delivery-part3.md` §10 — a mais urgente são os
textos legais, que o consentimento grava por versão.
