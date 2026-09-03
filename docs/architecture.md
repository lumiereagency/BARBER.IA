# BARBER SaaS — Arquitetura técnica (Parte 2)

Base técnica derivada das decisões de `docs/product-scope-part1.md`. Escolhas assumidas como padrão razoável para o MVP; qualquer uma pode ser trocada a pedido.

## 1. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Framework web | **Next.js (App Router) + TypeScript** | Um único deploy cobre página pública, painel e área do cliente; SSR ajuda SEO da página pública (`/b/{slug}`); mobile-first natural com React. |
| Estilo | **Tailwind CSS** | Consistência visual rápida, essencial para o princípio "interface simples". |
| Banco de dados | **PostgreSQL** | Suporta bem constraints de exclusão (necessárias para impedir conflito de horário do mesmo profissional — seção 8), transações atômicas, e índices por tenant. |
| ORM | **Prisma** | Migrations versionadas, schema único como fonte de verdade, tipagem ponta a ponta. |
| Autenticação da equipe | E-mail + senha (sessão via cookie assinado) | Decisão #2 da Parte 1. |
| Autenticação do consumidor | Telefone + OTP via provedor de SMS plugável (adapter), com magic link por e-mail como fallback | Decisão #1 da Parte 1; adapter para nunca acoplar no vendor. |
| Fila/jobs assíncronos | **Worker separado (mesmo repo, processo distinto)** consumindo uma tabela de jobs (outbox) no Postgres | Evita dependência de infra extra (ex.: Redis) no MVP; garante "se worker falhar, reserva continua válida no banco" (seção 3) porque a escrita do agendamento nunca depende do worker. |
| Integração WhatsApp (Baileys) | **Microserviço isolado**, comunicação por fila/outbox, nunca síncrono com o fluxo de reserva | Conforme seção 17.2: isolado, opcional, substituível por API oficial futuramente. |
| Google Calendar | Chamada de API feita pelo worker, idempotente, com retentativa | Unidirecional plataforma → Google (seção 18). |
| Cobrança da assinatura | Gateway de cartão recorrente (ex.: Stripe) atrás de uma interface de billing plugável | Decisão #8 da Parte 1. |
| Deploy | Aplicação web em plataforma gerenciada (ex.: Vercel/Railway/Fly.io) + Postgres gerenciado + worker como processo/serviço separado | Simplicidade operacional para MVP de uma pequena equipe. |

Multi-tenancy: **schema único, isolado por `barbershop_id`** em todas as tabelas operacionais (linha a linha), não schema-per-tenant nem banco-per-tenant — mais simples de operar e escalar para o volume esperado de pequenas barbearias, com todas as queries filtradas por tenant e testes de isolamento.

## 2. Estrutura de pastas (alto nível)

```
/app
  /(public)/b/[slug]/...        página pública + wizard de agendamento
  /(public)/a/[token]/...       gestão sem conta
  /(public)/vaga/[token]/...    link de vaga (Agenda Inteligente)
  /(customer)/...               área logada do cliente
  /(dashboard)/...              painel da barbearia (Hoje, Agenda, Clientes, Equipe, Gestão)
  /(superadmin)/...             painel do superadmin
  /api/...                      rotas de API/server actions
/prisma
  schema.prisma
/lib
  /availability                 motor de disponibilidade
  /smart-agenda                 motor de regras da Agenda Inteligente
  /notifications                adapters (SMS, WhatsApp link, Baileys, e-mail)
  /billing                      adapter de cobrança
  /calendar                     adapter Google Calendar
/worker
  index.ts                      processa outbox: WhatsApp, Google Calendar, lembretes
/docs
  product-scope-part1.md
  architecture.md
```

## 3. Decisões de arquitetura derivadas dos princípios de negócio

- **Reserva nunca depende de integração externa**: `Appointment` é escrito em uma transação Postgres própria; efeitos colaterais (WhatsApp, Google Calendar) são enfileirados via outbox e processados pelo worker de forma assíncrona e idempotente.
- **Anti-conflito de horário**: constraint de exclusão no Postgres (`EXCLUDE USING gist`) sobre `(professional_id, tstzrange(starts_at, ends_at))` para o estado `CONFIRMED`, garantindo no nível de banco que dois agendamentos confirmados do mesmo profissional nunca se sobrepõem — não depender só de lógica de aplicação.
- **HOLD com expiração**: linha de `Appointment` com `status = HOLD` e `expires_at`; um job periódico (ou verificação lazy na leitura) libera HOLDs expirados. Confirmação é um `UPDATE ... WHERE status = 'HOLD' AND expires_at > now()` dentro de transação, garantindo atomicidade.
- **Isolamento de tenant**: toda tabela operacional carrega `barbershop_id`; camada de acesso a dados sempre recebe o tenant do contexto de sessão/URL e filtra por ele — nunca uma query sem filtro de tenant nas tabelas operacionais.
- **Customer global vs. BarbershopCustomer**: duas tabelas separadas (`customers` sem `barbershop_id`, `barbershop_customers` com `barbershop_id` + FK para `customers`), conforme seção 10.2.
