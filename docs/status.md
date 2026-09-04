# BARBER SaaS — Estado do projeto

Cobre as Partes 1, 2 e 3 do documento de especificação, e os Marcos 0 a 5 do
roteiro da Parte 3 §8.

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
| 5 — Integrações resilientes | Google Agenda unidirecional, credenciais cifradas, reconciliação, painel com status e erro acionável | Concluído, com a ressalva das credenciais OAuth (§3) |

**Critério de sucesso do produto (Parte 1 §22)**: uma barbearia consegue
configurar a operação, publicar seu link, receber reservas sem conflito,
gerenciar o dia, cancelar e remarcar, e construir histórico de clientes — tudo
sem depender do WhatsApp. Isso está funcionando e verificado no navegador.

Falta do critério: identificar vagas e retornos, que é o Marco 6.

## 2. Cobertura de testes

Todos executados contra Postgres real; nenhum mock nas garantias centrais.

| Suíte | Testes | O que protege |
|---|---:|---|
| Domínio (`@barber/domain`) | 76 | Fuso e horário de verão, disponibilidade, buffers, RBAC, CRM, telefone, slug, cifra de credencial |
| Garantias do banco (`@barber/db`) | 17 | Conflito sob concorrência real, ocupação por status, advisory lock, buffers na constraint, dedupe de cliente, isolamento |
| Integração (`@barber/web`) | 96 | Agendamento, tenancy e autorização, operação do dia, conta do consumidor e CRM, estado legível da integração |
| Integração externa (`@barber/worker`) | 20 | Reserva intacta sob falha do Google, idempotência, limite de retentativa, revogação, reconciliação, reconexão sem duplicar |
| Navegador (Playwright, viewport de celular) | 50 | Onboarding, agendamento público, agenda operacional, conta do consumidor, painel de integrações |

Comandos: `pnpm test` (unitários e integração), `pnpm --filter @barber/db
test:guarantees`, `pnpm --filter @barber/worker test`, `pnpm --filter
@barber/web test:ui`.

Os testes de navegador precisam ser executados **um arquivo por vez**: eles
compartilham o mesmo servidor e o mesmo banco, e `node --test` com vários
arquivos os roda em paralelo, fazendo um derrubar o outro. O CI já faz assim.

## 3. Pendências que dependem de decisão sua

Nenhuma bloqueia o desenvolvimento dos próximos marcos. As duas primeiras
bloqueiam operação com cliente real.

1. **Textos legais versionados** — o mais urgente. O consentimento grava a
   versão do texto aceito, e hoje roda com `dev-0`. Nenhuma barbearia real pode
   receber cliente antes do texto definitivo.
2. **Provedor de SMS** — o envio do código de acesso está atrás de um adapter.
   Sem `SMS_PROVIDER` configurado, a aplicação **se recusa a rodar esse caminho
   em produção** em vez de fingir que enviou. Bloqueia o Marco 4 em produção,
   não o desenvolvimento.
3. **Credenciais OAuth do Google** — o adapter, a cifra, a sincronização e o
   painel estão prontos e testados, mas conectar de verdade exige um projeto no
   Google Cloud com `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` e
   `GOOGLE_OAUTH_REDIRECT_URI`. Sem elas, o painel diz honestamente que a
   conexão não está liberada em vez de oferecer um botão quebrado. Não bloqueia
   nada além da própria integração.
4. **Nome e domínio** — bloqueia TLS, o domínio remetente e o formato final do
   link público.
5. **Provedor de cobrança** — bloqueia o Marco 7. Se Pix ou boleto entrarem, o
   provedor precisa ser nacional; Stripe cobre bem apenas cartão no Brasil.
6. **Limites numéricos dos planos** — bloqueia os entitlements do Marco 6.

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
- **Um erro de console do roteador deixou de reprovar os testes.** Quando uma
  navegação cancela um prefetch em voo, o Next registra "Failed to fetch RSC
  payload" e refaz a navegação normalmente. A asserção de "nenhum erro no
  console" reprovava por isso de forma intermitente; agora ela ignora
  exatamente essa mensagem e continua valendo para todo o resto.
- **`SMS_PROVIDER=log` virou opt-in explícito.** O provedor de log recusava
  rodar sempre que `NODE_ENV=production`, e como CI e homologação servem o build
  de produção, o fluxo de código de acesso não podia ser exercitado onde ele de
  fato roda. Agora: sem `SMS_PROVIDER`, produção continua recusando (esquecer de
  configurar não pode virar um sistema que parece enviar e não envia); com
  `SMS_PROVIDER=log`, alguém pediu por isso, e a aplicação avisa alto a cada
  inicialização se estiver em produção.
- **Tirei "Clientes" do menu do painel, depois trouxe de volta.** O item
  apontava para uma tela que ainda não existia; o Next faz prefetch de todo
  `Link` visível, e a requisição pendente para a rota inexistente segurava a
  navegação em todas as páginas do painel. A tela (`/clientes`) foi construída
  fora da ordem dos marcos — não dependia de nenhuma decisão do Marco 6, só do
  CRM que já existia desde o Marco 4 — e o item voltou ao menu.
- **A constraint anti-conflito cobre `CONFIRMED`, `COMPLETED` e `NO_SHOW`.**
  Restringir a `CONFIRMED` permitiria gravar um atendimento retroativo por cima
  de outro já realizado.
- **A sincronização com o calendário virou convergente.** A primeira versão
  reproduzia o evento ("confirmou", "cancelou"); como o outbox entrega ao menos
  uma vez e sem ordem garantida, uma confirmação reentregue depois de um
  cancelamento recriaria o compromisso. Agora ela lê o estado atual do
  agendamento e faz o calendário refletir — reprocessar em qualquer ordem chega
  ao mesmo lugar.
- **Desconectar não apaga os compromissos já enviados ao Google.** Eles são da
  agenda do profissional; apagá-los sem ele pedir seria mexer no que é dele.
  Guardar o `external_event_id` é também o que faz a reconexão atualizar o
  mesmo evento em vez de criar um segundo.

## 6. Próximo passo

Marco 6 — recursos Pro: Agenda Inteligente, lista de espera, relatórios
avançados e entitlements por plano. Depende dos limites numéricos dos planos
(§3, item 6) para os entitlements; o resto pode começar antes.

Depois: Marco 7 (cobrança e Super Admin) e Marco 8 (Baileys, adiável sem
impedir lançamento).
