# BARBER SaaS — Estado do projeto

Fechamento da etapa que cobriu as Partes 1, 2 e 3 do documento de
especificação, e os Marcos 0 a 4 do roteiro da Parte 3 §8.

Atualizado em 2026-09-03. Branch: `claude/barber-saas-product-scope-vcp4q2`.

---

## 1. O que está pronto e verificado

| Marco | Escopo | Estado |
|---|---|---|
| 0 — Fundação | Monorepo, schema, migrações, multi-tenancy, RBAC, autenticação da equipe, CI, empacotamento Docker | Concluído, menos observabilidade e deploy de staging |
| 1 — Configuração | Onboarding do proprietário, serviços, profissionais, vínculo, jornada, exceções, dados e políticas | Concluído |
| 2 — Agendamento | Disponibilidade, holds, confirmação transacional, wizard público, link seguro, cancelamento, remarcação, trilha de eventos | Concluído |
| 3 — Painel diário | Agenda dia/semana, encaixe no balcão, concluído/falta, bloqueio de período, métricas ao vivo, WhatsApp manual | Concluído |
| 4 — Consumidor e CRM | Conta por OTP, vinculação segura, área do cliente, CRM automático, consentimentos, encerramento de conta | Concluído, com a ressalva do provedor de SMS (§3) |

**Critério de sucesso do produto (Parte 1 §22)**: uma barbearia consegue
configurar a operação, publicar seu link, receber reservas sem conflito,
gerenciar o dia, cancelar e remarcar, e construir histórico de clientes — tudo
sem depender do WhatsApp. Isso está funcionando e verificado no navegador.

Falta do critério: identificar vagas e retornos, que é o Marco 6.

## 2. Cobertura de testes

Todos executados contra Postgres real; nenhum mock nas garantias centrais.

| Suíte | Testes | O que protege |
|---|---:|---|
| Domínio (`@barber/domain`) | 67 | Fuso e horário de verão, disponibilidade, buffers, RBAC, CRM, telefone, slug |
| Garantias do banco (`@barber/db`) | 17 | Conflito sob concorrência real, ocupação por status, advisory lock, buffers na constraint, dedupe de cliente, isolamento |
| Integração (`@barber/web`) | 88 | Agendamento, tenancy e autorização, operação do dia, conta do consumidor e CRM |
| Navegador (Playwright, viewport de celular) | 45 | Onboarding, agendamento público, agenda operacional, conta do consumidor |

Comandos: `pnpm test` (unitários e integração), `pnpm --filter @barber/db
test:guarantees`, `pnpm --filter @barber/web test:ui`.

## 3. Pendências que dependem de decisão sua

Nenhuma bloqueia o desenvolvimento dos próximos marcos. As três primeiras
bloqueiam operação com cliente real.

1. **Textos legais versionados** — o mais urgente. O consentimento grava a
   versão do texto aceito, e hoje roda com `dev-0`. Nenhuma barbearia real pode
   receber cliente antes do texto definitivo.
2. **Provedor de SMS** — o envio do código de acesso está atrás de um adapter;
   o provedor de desenvolvimento apenas registra no log e **se recusa a rodar em
   produção**. Bloqueia o Marco 4 em produção, não o desenvolvimento.
3. **Nome e domínio** — bloqueia TLS, o domínio remetente e o formato final do
   link público.
4. **Provedor de cobrança** — bloqueia o Marco 7. Se Pix ou boleto entrarem, o
   provedor precisa ser nacional; Stripe cobre bem apenas cartão no Brasil.
5. **Limites numéricos dos planos** — bloqueia os entitlements do Marco 6.

## 4. Riscos registrados

Detalhados em `docs/delivery-part3.md` §10.

- **RPO do banco na VPS.** Recomendei WAL arquivado desde o piloto, com RPO ≤ 5
  min e RTO ≤ 2 h declarados em `docs/runbook-operacao.md`. Com backup apenas
  diário, a barbearia perderia a informação de quem chega no dia seguinte.
- **VPS única é ponto único de falha.** Mitigação para o piloto: backup externo,
  runbook e ensaio mensal de restauração.
- **Restauração ainda não testada.** A Parte 3 §16 proíbe declarar produção
  pronta sem isso. Isolamento e disputa de slot **já estão testados**;
  restauração depende da VPS real e é item de bloqueio do lançamento.
- **Imagens Docker não construídas.** Não há daemon Docker no ambiente de
  desenvolvimento usado; os Dockerfiles e o compose de produção estão escritos
  mas não foram validados por build.

## 5. Decisões que revi durante a implementação

Registradas aqui porque mudaram o que já estava escrito:

- **Buffers passaram a ser garantidos pelo banco.** `timestamptz ± interval` é
  STABLE no Postgres e não entra em índice, então o footprint ocupado virou
  coluna própria. Sem isso, uma corrida encaixaria um corte dentro do intervalo
  de preparo de outro.
- **`RESCHEDULED` virou status próprio.** Sem ele, toda remarcação apareceria
  como cancelamento nos relatórios do dono.
- **O contrato público aceita telefone como a pessoa digita.** Exigir E.164
  obrigaria o front a replicar a normalização, que é a chave de deduplicação do
  cliente e precisa viver só no servidor.
- **Vinculação de histórico não herda relação com mais de 12 meses.** Número de
  celular é reciclado no Brasil; sem o corte, quem recebesse um número
  reaproveitado herdaria o histórico do dono anterior.
- **A constraint anti-conflito cobre `CONFIRMED`, `COMPLETED` e `NO_SHOW`.**
  Restringir a `CONFIRMED` permitiria gravar um atendimento retroativo por cima
  de outro já realizado.

## 6. Próximo passo

Marco 5 — integrações resilientes: Google Calendar unidirecional com
`external_event_id` idempotente, reconciliação, status de integração no painel.
O outbox e o worker que ele exige já estão prontos e processando.

Depois: Marco 6 (Pro — Agenda Inteligente, lista de espera, relatórios),
Marco 7 (cobrança e Super Admin) e Marco 8 (Baileys, adiável sem impedir
lançamento).
