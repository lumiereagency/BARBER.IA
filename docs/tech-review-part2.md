# BARBER SaaS — Parte 2: confronto técnico com as jornadas e decisões pendentes

Conforme a instrução da seção 1 da Parte 2, este documento vem **antes de codificar**.
Confronta o modelo técnico proposto com todas as jornadas da Parte 1, aponta onde ele
diverge da fundação já commitada (`prisma/schema.prisma`, `docs/architecture.md`,
commit `4491c3c`), onde a própria Parte 2 deixa pontas soltas, e lista as decisões
pendentes com recomendação.

---

## 1. Resumo executivo

- A Parte 2 é compatível com as jornadas da Parte 1, **com três exceções estruturais**
  que precisam de decisão (holds em tabela separada vs. constraint de exclusão;
  telefone "protegido" vs. indexável; remarcação vs. métrica de cancelamento).
- A Parte 2 **revoga duas decisões** que eu havia assumido por conta própria na rodada
  anterior (identidade da equipe e ausência de Redis). Estou tratando a Parte 2 como
  autoritativa.
- Encontrei **dois defeitos reais no schema já commitado** que causariam corrupção de
  CRM e risco de segurança. Ambos precisam ser corrigidos independentemente do resto.
- Há **15 decisões pendentes** (as 10 da seção 19 da Parte 2 + 5 que emergiram do
  confronto). Todas têm recomendação abaixo.

---

## 2. Defeitos no que já foi commitado

Estes não são divergências de estilo — são erros que quebram requisitos da Parte 1.

### 2.1 Duplicação de cliente destrói o CRM (crítico)

`BarbershopCustomer` hoje tem `@@unique([barbershopId, customerId])`, com `customerId`
nulo enquanto o cliente não cria conta. Em PostgreSQL, `NULL` nunca conflita com `NULL`
em índice único — então **cada agendamento anônimo do mesmo telefone cria uma relação
nova**. O cliente que agenda 5 vezes sem conta vira 5 clientes distintos, e todo o
CRM automático da seção 14 da Parte 1 (frequência, ticket médio, primeira/última visita,
próximo retorno) fica errado desde o primeiro dia.

Verificado no Postgres 16 contra o schema commitado: três inserções do mesmo telefone na
mesma barbearia passaram sem erro, gerando 3 relações distintas.

A Parte 2 já corrige isso na seção 5.3: *"Aplicar chave/índice que evite duplicidade da
mesma relação por telefone normalizado"*. Correção: `UNIQUE (barbershop_id,
normalized_phone)`, com normalização E.164 no servidor antes de gravar.

### 2.2 Token de gestão em texto puro (segurança)

`Appointment.manageToken` está gravado em claro. A Parte 2 exige
`management_token_hash` (seção 5.4) e *"hash de tokens de gestão"* (seção 14). Hoje,
qualquer leitura do banco (dump, backup, log de query, acesso de suporte) entrega
acesso de cancelamento/remarcação a todas as reservas.

Correção: gerar token aleatório de 128+ bits, entregar só no link, e gravar
`HMAC-SHA256(token, APP_SECRET)`. Precisa ser hash **determinístico** (não bcrypt/argon),
senão não dá para buscar por ele; a entropia do token é o que resiste a força bruta, e
o HMAC com segredo fora do banco garante que um vazamento do banco sozinho não gera
tokens válidos.

### 2.3 Sem snapshots, a receita histórica muda sozinha

`Appointment` referencia `Service` por FK e não guarda preço. Quando o dono reajusta o
preço do corte, **todo o histórico de receita realizada é reescrito retroativamente** —
os relatórios de meses fechados mudam. A Parte 2 resolve com
`price_snapshot_minor`, `service_name_snapshot`, `professional_name_snapshot`,
`customer_name_snapshot` (seção 5.4). Obrigatório adotar.

---

## 3. Confronto: modelo técnico × jornadas da Parte 1

### 3.1 Agendamento público (Parte 1 §7)

Coberto por `POST /holds` + `POST /appointments` com chave de idempotência. Pontos que
o modelo ainda não resolve:

- **"Qualquer profissional"**: `appointment_holds.professional_id` é obrigatório, então
  a escolha determinística (via `professionals.booking_priority`) precisa acontecer **no
  momento do hold**, não da confirmação. Consequência de produto: a tela de sucesso da
  Parte 1 §7 mostra "com Matheus", ou seja, o cliente descobre o profissional só ao
  confirmar. Isso é aceitável, mas é uma decisão de UX que precisa ser explícita.
- **Consentimento no passo 6**: a Parte 2 §5.3 exige `text_version` no consentimento e
  proíbe inferir marketing do agendamento. Como o cliente ainda é anônimo, o consentimento
  tem que ser gravado na **mesma transação** que cria a relação e a reserva. Isso torna os
  textos legais (§19 #10) uma **dependência bloqueante da primeira jornada** — sem texto
  versionado, não dá para gravar consentimento válido.

### 3.2 Gestão sem conta `/a/{token}` (Parte 1 §9)

Funciona com token hasheado (busca por HMAC indexado). **Conflito**: a Parte 2 §14 pede
*"tokens de curta duração quando possível"* e a §10 tem job de *"limpeza de tokens"*,
mas a decisão #6 da Parte 1 (que eu assumi) manteve o link válido indefinidamente para
consulta. Reconciliação proposta: escrita (cancelar/remarcar) só enquanto `CONFIRMED`;
leitura até 90 dias após o atendimento; depois disso o link expira e o histórico fica
acessível apenas via conta. Precisa de confirmação.

### 3.3 Remarcação (Parte 1 §9 e §11)

`previous_appointment_id` cobre a rastreabilidade. **Mas há um furo de métrica**: a
Parte 1 §11 só oferece `CANCELLED_BY_CUSTOMER` / `CANCELLED_BY_SHOP` como estados de
saída. Se a remarcação cancela o agendamento antigo, **toda remarcação vira um
cancelamento nos relatórios** (Parte 1 §19 lista "cancelamentos" como métrica do
dashboard). O dono vê cancelamentos inflados e conclui coisa errada sobre o próprio
negócio.

Duas saídas: (a) adicionar o estado `RESCHEDULED`; ou (b) manter o cancelamento e excluir
das métricas todo agendamento que tenha sucessor. Recomendo **(a)** — é explícito no
banco, não depende de todo relatório futuro lembrar de aplicar o filtro.

### 3.4 Conta do consumidor e vinculação de histórico (Parte 1 §10)

A vinculação por telefone verificado é **cross-tenant por natureza**: verificar o número
uma vez vincula as relações desse telefone em todas as barbearias onde ele agendou. Isso
está correto conforme a Parte 1 §10.2 (identidade global, dados isolados).

**Risco real**: reciclagem de número de celular é comum no Brasil. Quem receber um número
reaproveitado e verificá-lo herda o histórico do dono anterior — inclusive nome e
atendimentos em barbearias que nunca visitou. Mitigação recomendada: vincular
automaticamente apenas relações com atividade nos últimos ~12 meses, e exigir o token de
gestão da reserva específica para vincular relações mais antigas.

Também vale notar: a Parte 2 §4 pede *"impedir enumeração de telefone"*, então o fluxo de
OTP não pode revelar, antes da verificação concluída, se o número já tem histórico.

### 3.5 Agenda Inteligente (Parte 1 §13)

`smart_opportunities` + `customer_return_scores` cobrem a detecção e o ranking. Pendências:

- A Parte 2 não modela o **token do link `/vaga/{token}`** — a seção 8 expõe o endpoint
  `GET/POST /public/vacancies/{token}` mas a entidade da §5.5 não tem campo de token.
  Precisa entrar (hasheado, como o de gestão).
- **Abrir o link não pode criar hold.** Se criasse, o primeiro dos 8 clientes a clicar
  travaria a vaga por 5 minutos sem ter reservado. O hold deve nascer só quando a pessoa
  avança para confirmar — coerente com "o primeiro cliente que concluir a reserva fica
  com o horário" (Parte 1 §13.3).
- **`estimated_revenue_minor` precisa de fórmula definida.** Com 8 clientes candidatos e
  1 vaga, a receita potencial é o valor de **uma** reserva, não de oito. O exemplo da
  Parte 1 §13.1 ("8 clientes... R$ 325") sugere soma, o que superestimaria em 8×.
  Recomendo: preço do serviço compatível mais provável para aquela janela, exibido como
  estimativa de **uma** vaga preenchida.

### 3.6 Lista de espera (Parte 1 §16)

A Parte 1 §16.3 diz que *"cancelamento cria oportunidade compatível"*, mas a lista de jobs
da Parte 2 §10 só prevê "expiração da lista de espera". Falta o job de **matching
disparado por cancelamento/bloqueio**. Mesmo caso para recalcular `smart_opportunities`
quando a agenda muda.

### 3.7 Painel "Hoje" e relatórios (Parte 1 §6.1 e §19)

A Parte 2 materializa contadores de CRM em `barbershop_customers`, atualizados por job
(§10). Isso é bom para relatórios pesados, mas **não pode alimentar a tela "Hoje"**: o
barbeiro marca um atendimento como concluído e espera ver o faturamento realizado mudar
na hora, não quando o job rodar.

Recomendação: números operacionais do dia calculados ao vivo sobre `appointments`
(janela de um dia, índice por tenant+data — é barato); campos materializados só para
agregados por cliente e relatórios de período.

### 3.8 Google Calendar (Parte 1 §18, Parte 2 §11)

**Lacuna no schema atual**: não existe onde guardar `external_event_id`. Sem isso, não há
create/update/delete idempotente — cada sincronização duplicaria eventos. Recomendo tabela
`appointment_calendar_syncs (appointment_id, connection_id, external_event_id, status,
last_synced_at)`, não uma coluna, para sobreviver a reconexão em outra conta Google.

Continua **em aberto** desde a Parte 1 §18: política para evento criado direto no Google.
Com sincronização só de saída (V1), se o barbeiro marcar um compromisso pessoal no Google,
a plataforma não enxerga e vai oferecer aquele horário. Recomendo assumir isso
explicitamente na V1 e orientar o bloqueio pela plataforma; importar "busy" já é
bidirecional na prática e a Parte 1 §21 tirou isso do MVP.

### 3.9 WhatsApp (Parte 1 §17, Parte 2 §12)

A interface `MessagingProvider` está correta como desacoplamento, mas **esconde uma
diferença semântica relevante** — e a Parte 2 §1 pede justamente que eu não troque
requisito por biblioteca sem explicar impacto:

`sendTemplateLikeMessage` funciona com Baileys (texto livre), mas numa futura API oficial
(Cloud API), mensagem iniciada pelo negócio fora da janela de 24h **exige template
aprovado pela Meta**. O lembrete da Parte 1 §17.2 cai exatamente nesse caso. Ou seja: a
troca de provedor não é transparente — ela exige aprovação prévia de template e pode ser
recusada. Isso não impede a interface, mas precisa estar documentado para não virar
surpresa na migração.

### 3.10 Super Admin e auditoria (Parte 1 §20, decisão #9)

`audit_logs` da Parte 2 prevê ator + tenant. O schema atual amarra `AuditLog` só a
`PlatformAdminUser`, então **ações da equipe da barbearia não são auditáveis** — o que
contradiz a Parte 2 §14 ("logs de auditoria") e a §5.6. Precisa de ator polimórfico
(`actor_type` + `actor_id`), cobrindo superadmin, equipe, cliente e sistema.

---

## 4. Divergências entre a Parte 2 e a fundação já commitada

Tratando a Parte 2 como autoritativa. "Impacto" = o que muda no que já existe.

| # | Tema | Já commitado | Parte 2 exige | Impacto |
|---|---|---|---|---|
| A | Identidade da equipe | `StaffUser` por barbearia (minha decisão #3) | `users` + `barbershop_memberships` | **Revoga minha decisão #3**: um login passa a servir várias barbearias. Reescrita de Identity/Tenancy. |
| B | Papéis | 3 (`OWNER`, `RECEPTION`, `PROFESSIONAL`) | 4 (`OWNER`, `ADMIN`, `RECEPTIONIST`, `PROFESSIONAL`) | Falta definir o que separa OWNER de ADMIN (ver decisão #11). |
| C | Profissional sem login | Impossível (`staffUserId` obrigatório) | `memberships.professional_id` opcional | Permite cadastrar barbeiro que não usa o sistema — caso comum e hoje bloqueado. |
| D | Holds | Status `HOLD` em `appointments` | Tabela `appointment_holds` | Estrutural. Ver decisão #12 — afeta a constraint que já está implementada e testada. |
| E | Fila/cache | Só Postgres (recusei Redis) | Redis obrigatório (§2) | **Revoga minha decisão**: Redis entra para rate limit, locks e fila. Outbox continua no Postgres. |
| F | Repositório | App Next.js único na raiz | Monorepo `apps/` + `packages/` | Reestruturar agora é barato (só scaffold); depois é caro. |
| G | Tokens | `manageToken` em claro | `management_token_hash` | Ver §2.2. |
| H | Snapshots | Nenhum | 5 campos de snapshot | Ver §2.3. |
| I | Consentimento | 3 booleanos | Tabela `consents` versionada | Booleano não guarda versão do texto, evidência nem revogação — não atende a §13. |
| J | Dedupe de cliente | `unique(shop, customer_id)` | Índice por telefone normalizado | Ver §2.1. |
| K | IDs | `cuid()` | UUID/ULID | Baixo impacto se decidido agora. |
| L | Buffers | `bufferMinutes` único | `buffer_before` + `buffer_after` | Muda o motor de disponibilidade. |
| M | Preço por profissional | Não existe | `custom_price_minor`, `custom_duration_minutes` | Muda snapshot **e** cálculo de slot (barbeiro sênior pode demorar mais). |
| N | Exceções de agenda | 1 tabela | `schedule_exceptions` + `schedule_blocks` | Separa folga/férias recorrente de bloqueio pontual. |
| O | Jornada semanal | Sem vigência | `effective_from/to` | Permite mudar horário de trabalho sem reescrever histórico. |
| P | Concorrência | Sem `version` | `version` em appointments | Necessário para edição simultânea no painel. |
| Q | Faltantes | — | `promotion_redemptions`, `usage_counters`, `job_attempts`, `integration_connections` com credenciais cifradas, `external_event_id` | Sem `usage_counters` não há entitlement server-side dos planos. |

Alinhado e sem mudança: UTC + timezone IANA (§7) — já implementado com `timestamptz` e
horários semanais como hora local; multi-tenancy por `barbershop_id` (§3); outbox
transacional (§10); constraint de exclusão como mecanismo anti-conflito (§6).

---

## 5. Decisões pendentes

### Da seção 19 da Parte 2

| # | Decisão | Recomendação | Por que importa agora |
|---|---|---|---|
| 1 | Nome final e domínio | — (só você decide) | Define `/b/{slug}` vs. subdomínio, e o domínio remetente dos magic links (afeta entregabilidade). |
| 2 | Provedor de autenticação/OTP | SMS transacional nacional; OTP **só na criação de conta e em novo dispositivo**, não a cada login | Custo por SMS entra no custo variável por barbearia. |
| 3 | Provedor de cobrança | Se quiser Pix/boleto no lançamento: gateway nacional (Asaas/Pagar.me/Iugu). Se cartão só: Stripe | Stripe não cobre Pix/boleto bem no Brasil — e boleto/Pix reduz atrito com dono de pequeno negócio. |
| 4 | Google Calendar só saída na V1 | **Sim**, confirmar | Já era o previsto na Parte 1 §18/§21. |
| 5 | Política de cancelamento configurável | Sim, por barbearia, padrão sem restrição | Já modelado como `min_notice_cancel_minutes`. |
| 6 | Duração do hold | 5 min, configurável | Já implementado assim. |
| 7 | Limites dos planos | Precisa dos números | Sem eles, `usage_counters` não tem o que aplicar. |
| 8 | Uma ou múltiplas unidades por tenant | **Uma unidade agora, com `organization_id` nulo já previsto** | Decisão estrutural: introduzir uma camada acima de `barbershops` depois exige migrar todas as tabelas. Barato agora, caro depois. |
| 9 | Baileys no lançamento | **Não** — incremento posterior | É a peça de maior risco operacional (banimento, queda de sessão) e a Parte 1 §17.1 já torna os links manuais suficientes para validar. |
| 10 | Textos legais e processo de consentimento | Precisa antes da primeira reserva real | Bloqueia `consents.text_version` (ver §3.1). |

### Que emergiram deste confronto

| # | Decisão | Recomendação |
|---|---|---|
| 11 | O que separa `OWNER` de `ADMIN` | OWNER: assinatura, cobrança, transferir/encerrar a barbearia. ADMIN: todo o resto operacional. |
| 12 | Holds em tabela separada × constraint de exclusão | Ver análise abaixo — recomendo **holds em tabela separada + advisory lock**, mantendo a constraint em `appointments` como garantia final. |
| 13 | `customer_phone_snapshot` "protegido" | Telefone normalizado **em claro e indexado** na relação (necessário para busca e dedupe); "protegido" = controle de acesso por papel + redação em log/exportação. Cifrar a coluna inviabilizaria a busca exigida pela §16. |
| 14 | Validade do token de gestão | Escrita enquanto `CONFIRMED`; leitura até 90 dias após o atendimento. |
| 15 | Estado `RESCHEDULED` | Adicionar (ver §3.3). |

### Sobre a decisão #12 (a mais delicada)

A Parte 2 §6 prefere constraint de exclusão, e a §5.4 coloca holds em tabela separada.
**As duas coisas juntas não fecham**: constraint de exclusão vale dentro de uma tabela, então
com holds separados nada impede, no nível do banco, que um hold cubra um agendamento
confirmado. E não dá para escrever `WHERE expires_at > now()` numa constraint — testado no
Postgres 16, a criação falha com *"functions in index predicate must be marked IMMUTABLE"* —
então holds expirados continuariam bloqueando a agenda até o job de limpeza rodar.

Duas arquiteturas coerentes:

- **(a) Tabela única, `HOLD` e `CONFIRMED` na mesma constraint** — é o que já está
  implementado e testado. Uma única garantia cobre tudo. Custo: holds expirados só param de
  bloquear depois do job de expiração, e a linha de reserva nasce antes de existir cliente.
- **(b) Tabela separada + `pg_advisory_xact_lock(professional_id)`** na confirmação e na
  criação de hold, validando as duas tabelas dentro da transação, com a constraint de
  exclusão em `appointments` como rede de segurança final. É a opção listada na própria
  Parte 2 §6.

Recomendo **(b)**, alinhado à Parte 2: o hold é por natureza consultivo — a Parte 1 §8 já
diz que *"a disponibilidade exibida não garante posse definitiva do slot"*. O que precisa de
garantia dura é a confirmação, e essa continua protegida pela constraint no banco. Perder
uma corrida de hold é um caso previsto no produto ("informar claramente e oferecer os
horários mais próximos").

---

## 6. Plano de reconciliação proposto

Nenhuma linha de código de produto até a confirmação das decisões acima. Depois:

1. **Reestruturar para monorepo** (`apps/web`, `apps/worker`, `packages/db|domain|api-contracts`)
   enquanto ainda é só scaffold.
2. **Reescrever o schema** com todas as divergências da §4 — inclusive os três defeitos da §2.
   O schema atual foi validado contra Postgres real (a constraint de exclusão funciona), então
   a base do mecanismo se aproveita; o que muda é a modelagem em volta.
3. **Contratos de API tipados** antes das telas, conforme a §8 da Parte 2.
4. **Motor de disponibilidade + confirmação transacional**, com teste de concorrência real
   (duas confirmações simultâneas no mesmo slot) e teste de isolamento entre tenants.
5. Só então as telas, na ordem das jornadas: agendamento público → gestão sem conta → painel.

Infra (Redis, S3, proxy TLS, observabilidade) entra no passo 1 como docker-compose de
desenvolvimento, sem provisionar nada em produção antes das decisões #1/#2/#3.
