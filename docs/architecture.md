# BARBER SaaS — Arquitetura técnica

Estado após a reconciliação com a Parte 2. Substitui a versão anterior deste
documento, que refletia decisões tomadas antes da Parte 2 chegar. Leia junto de
`docs/product-scope-part1.md` (produto e decisões de negócio) e
`docs/tech-review-part2.md` (confronto técnico e decisões #11–#15).

## 1. Stack

| Camada | Escolha | Observação |
|---|---|---|
| Aplicação web | Next.js (App Router) + TypeScript | Um deploy cobre página pública, painel, área do cliente e superadmin. |
| Estilo | Tailwind CSS | |
| Banco | PostgreSQL 16 | Fonte de verdade. Constraints de exclusão e advisory locks fazem a garantia anti-conflito. |
| ORM | Prisma | Migrations versionadas; o que Prisma não expressa vai em SQL na própria migration. |
| Cache, locks, rate limit e fila | Redis | Exigido pela Parte 2 §2. |
| Jobs | Worker separado consumindo `outbox_events` | Outbox transacional no Postgres; Redis é o transporte da fila, não a fonte de verdade. |
| Autenticação da equipe | E-mail + senha ou magic link, sessão em cookie | `users` global + `barbershop_memberships`. |
| Autenticação do consumidor | Telefone + OTP por SMS (adapter), magic link por e-mail como fallback | Nunca por WhatsApp — senão o WhatsApp viraria requisito de ação crítica. |
| WhatsApp | Serviço isolado atrás de `MessagingProvider` | Fora do lançamento (decisão §19 #9). Links `wa.me` manuais são função independente e sempre disponíveis. |
| Google Calendar | Adapter chamado pelo worker, idempotente por `external_event_id` | Só saída na V1. |
| Cobrança | Adapter plugável | Provedor pendente (decisão §19 #3). |
| Armazenamento | Compatível com S3 | Prefixo separado por barbearia. |

Multi-tenancy: schema único isolado por `barbershop_id`, resolvido sempre no
servidor a partir da sessão ou da rota pública — nunca aceito do cliente.

## 2. Estrutura do repositório

```
apps/
  web/                 Next.js: público, cliente, painel, superadmin
  worker/              consumidor do outbox
packages/
  db/                  schema Prisma, migrations, cliente, testes de garantia
  domain/              regras puras (sem React, sem SDK, sem Prisma)
  api-contracts/       contratos zod compartilhados entre front e back
  config/              variáveis de ambiente validadas
infra/docker/          Postgres + Redis para desenvolvimento
docs/
```

## 3. Garantias que vivem no banco

Estão em `packages/db/prisma/migrations/*/migration.sql` e são verificadas por
`pnpm --filter @barber/db test:guarantees` (14 asserções, todas contra um
Postgres real).

- **Anti-conflito de agenda**: `EXCLUDE USING gist (professional_id, tstzrange(starts_at, ends_at))`
  em `appointments`, restrita aos status que ocupam agenda — `CONFIRMED`,
  `COMPLETED` e `NO_SHOW`. Cancelado e remarcado liberam o horário. Testado com
  duas transações concorrentes: exatamente uma sobrevive.
- **Holds sem sobreposição entre si**: mesma constraint em `appointment_holds`.
- **Hold × agendamento**: constraint de exclusão não cruza tabelas, e o
  predicado não pode usar `now()` (o Postgres exige expressão imutável). A
  coordenação é feita com `pg_advisory_xact_lock(hashtext(professional_id))` na
  criação de hold e na confirmação, validando as duas tabelas dentro da mesma
  transação (decisão #12). Hold expirado deixa de bloquear na consulta; a
  remoção física fica com o job de limpeza.
- **Deduplicação de cliente**: `UNIQUE (barbershop_id, normalized_phone)` — sem
  isso, cada agendamento anônimo criava uma relação nova e corrompia o CRM.
- **Telefone global**: índice único parcial em `customers.normalized_phone`
  apenas quando `phone_verified_at` não é nulo.
- **Coerência de intervalo**: `CHECK (ends_at > starts_at)`.

## 4. Decisões estruturais

- **Snapshots no agendamento** (`price_snapshot_minor`, nomes de serviço,
  profissional e cliente): o histórico não pode mudar quando o catálogo muda.
- **Tokens nunca em texto puro**: `management_token_hash`, `session_token_hash` e
  `share_token_hash` guardam HMAC-SHA256 com segredo da aplicação. Hash
  determinístico (não bcrypt) para permitir busca; a entropia do token é o que
  resiste a força bruta. Trocar `TOKEN_HMAC_SECRET` invalida todos os links já
  enviados.
- **`RESCHEDULED` como status próprio**: sem ele, toda remarcação apareceria
  como cancelamento nos relatórios do dono.
- **`organization_id` nulo em `barbershops`**: o MVP opera uma unidade por
  tenant, mas a coluna já existe para que multiunidade não exija migrar todas as
  tabelas depois (decisão §19 #8).
- **Idempotência** (`idempotency_keys`): exigida em confirmação, cancelamento,
  remarcação, webhooks, sincronização e cobrança.
- **CRM materializado × leitura ao vivo**: os contadores de
  `barbershop_customers` são atualizados por job e servem a perfil e relatórios
  de período. A tela "Hoje" lê agendamentos ao vivo, senão o faturamento
  realizado só mudaria quando o job rodasse.
- **Auditoria de qualquer ator**: `audit_logs` com `actor_type` polimórfico
  (equipe, cliente, sistema, superadmin), não só do superadmin.

## 5. O que ainda não existe

Motor de disponibilidade, regras da Agenda Inteligente, autenticação,
implementação dos endpoints, telas e adapters de integração. Os contratos
públicos já estão tipados em `packages/api-contracts`.
