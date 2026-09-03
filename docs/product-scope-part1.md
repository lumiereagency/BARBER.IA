# BARBER SaaS — Parte 1: Confirmação de escopo (produto, telas, jornadas)

Registro da análise da especificação de produto recebida em 2026-09-03, antes de qualquer implementação. Nenhum código foi escrito nesta etapa.

## 1. Confirmação estruturada do entendimento

- **Produto**: SaaS multi-tenant, mobile first, web (sem app obrigatório), para pequenas barbearias. Cada barbearia (tenant) tem página pública própria (`/b/{slug}`), painel, profissionais, serviços, agenda, clientes e configurações isoladas entre si.
- **Aquisição do cliente final**: o consumidor agenda sem conta. Depois da confirmação, é convidado a criar um perfil (autenticação sem senha — telefone + OTP/magic link, com e-mail como fallback inicial) para acompanhar/repetir agendamentos e receber promoções. O CRM é derivado automaticamente do histórico de agendamentos — não há cadastro manual obrigatório.
- **Modelo de dados de cliente em duas camadas**: `Customer` (identidade global do consumidor, cross-tenant) e `BarbershopCustomer` (relação consumidor↔barbearia, dados/histórico isolados por estabelecimento). Uma barbearia nunca vê histórico do cliente em outra barbearia.
- **Papéis**: Superadmin da plataforma (não opera agenda), Dono/admin da barbearia, Profissional/barbeiro, Recepção, Cliente. Cada papel tem escopo de ação e visibilidade distintos.
- **Planos**: Essencial e Pro, diferenciados por Agenda Inteligente avançada, lista de espera, recuperação de clientes, relatórios avançados, lembrete automático e Baileys. Preços são configuráveis (não fixos em código).
- **Navegação do painel**: Hoje (operacional), Agenda, Clientes, Equipe, Gestão (serviços, relatórios, promoções, configurações, integrações, assinatura, usuários).
- **Reserva com concorrência controlada**: seleção de horário cria um HOLD temporário (~5 min, configurável); confirmação definitiva é uma transação atômica no servidor, com restrição de banco contra double-booking do mesmo profissional.
- **Gestão sem conta**: link não enumerável e revogável (`/a/{token}`) permite ao cliente consultar, cancelar, remarcar e criar conta, vinculando o histórico.
- **Ciclo de vida do agendamento**: `HOLD → CONFIRMED → {CANCELLED_BY_CUSTOMER | CANCELLED_BY_SHOP | COMPLETED | NO_SHOW}`. Remarcação preserva histórico (não deleta, referencia o agendamento anterior + trilha de auditoria). Só `COMPLETED` conta como receita realizada.
- **Motor de disponibilidade**: combina jornada semanal, exceções, folgas/bloqueios, duração + buffer do serviço, reservas/holds existentes, antecedência mínima/máxima, fuso horário da barbearia e elegibilidade profissional↔serviço. "Qualquer profissional" resolve de forma determinística.
- **Agenda Inteligente (Pro)**: motor de regras (não IA generativa) que detecta vagas, sugere clientes com pontuação explicável e gera links de preenchimento de vaga (`/vaga/{token}`, primeiro a confirmar leva).
- **CRM automático**: métricas derivadas (primeira/última visita, ticket médio, frequência, preferências, próximo retorno estimado) — nunca inventadas quando os dados são insuficientes.
- **WhatsApp**: apenas links `wa.me` pré-preenchidos com envio manual no MVP padrão; Baileys é opcional, isolado, Pro, uso mínimo (lembrete + link de gestão), nunca bot conversacional, nunca requisito para ação crítica, falha nunca invalida reserva.
- **Google Calendar**: opcional por profissional, unidirecional (plataforma → Google) no MVP, jobs idempotentes com retentativa, falha de sync não desfaz a reserva.
- **Dashboard**: métricas básicas (todos os planos) vs. avançadas (Pro), sempre separando previsto de realizado, com fórmulas no backend.
- **Superadmin**: gestão de tenants, planos/assinaturas, inadimplência, cupons, MRR, saúde de integrações/jobs, suporte/impersonação auditada (se aprovada), logs sem dados sensíveis desnecessários.
- **Fora do MVP**: PDV, estoque, nota fiscal, folha/comissões complexas, marketplace, app nativo, chatbot de WhatsApp, IA generativa, campanhas em massa automáticas, pagamento do serviço pelo consumidor, múltiplas unidades por assinatura, sync bidirecional completa com Google Calendar.

Meu entendimento do escopo e das regras acima está confirmado, exceto pelos pontos levantados na seção 2.

## 2. Inconsistências e lacunas encontradas

1. **Autenticação da equipe (dono/recepção/profissional) não é especificada.** A seção 3 só proíbe senha tradicional para *consumidores*. Presumo que a equipe pode usar e-mail+senha convencional, mas isso não está escrito — e afeta diretamente o modelo de usuários/permissões.
2. **Canal do OTP do cliente pode colidir com o princípio "WhatsApp não é requisito".** Se o OTP for enviado por WhatsApp (via Baileys/API oficial), criar conta ficaria condicionado a WhatsApp funcionando — o que contradiz a seção 3. Presumo que o OTP deve ir por SMS (ou e-mail no fallback), nunca por WhatsApp, mas isso precisa ser explícito.
3. **Vínculo entre "WhatsApp informado no agendamento" e "telefone validado da conta" não é definido.** No passo 5 da jornada pública, o cliente informa nome e WhatsApp (não verificado). Na criação de conta (seção 10), a autenticação é por telefone validado via OTP. Não fica claro se é o mesmo número reaproveitado (pré-preenchendo o OTP) ou um novo fluxo do zero.
4. **Política de expiração do HOLD durante o preenchimento (passos 5–7) não é detalhada como estado de tela.** A seção 8 cobre conflito de concorrência ("horário ocupado"), mas não o caso de o HOLD expirar por timeout enquanto o cliente ainda está preenchendo nome/WhatsApp/termos — precisa de um estado de UI específico (ex.: contador regressivo + mensagem "sua reserva temporária expirou, escolha outro horário").
5. **Revogação do link `/a/{token}` não tem regra definida.** Não é dito se ele expira sozinho após CONCLUÍDO/CANCELADO, se fica válido indefinidamente para consulta histórica, ou se só é revogado manualmente.
6. **Staff único por barbearia vs. modelo global do cliente.** A seção 10.2 define claramente que o *Customer* é global e o *BarbershopCustomer* é local. Não existe o equivalente para profissionais/donos: um barbeiro freelancer que trabalha em duas barbearias teria dois cadastros de usuário totalmente separados (login duplicado), já que "toda entidade operacional pertence a uma barbearia" (seção 3). Vale confirmar que é essa a intenção.
7. **Matriz de permissões incompleta.** Fica claro o que Recepção *não* pode fazer (assinatura, config sensível), mas não o que ela *pode* ver em "Gestão" (ex.: relatórios, promoções — leitura, edição?). Também não é dito se Profissional vê apenas a própria agenda por padrão ou a da equipe toda, e quem concede essa permissão.
8. **Booking multi-serviço não é especificado.** O passo 1 da jornada pública é "escolher serviço" (singular). O exemplo "Corte + Barba" sugere um serviço combo pré-cadastrado, não seleção múltipla ad-hoc. Preciso confirmar se o MVP permite selecionar vários serviços numa mesma reserva (somando duração) ou só serviços/combos únicos pré-definidos.
9. **Sem antecedência mínima para cancelamento/remarcação pelo cliente.** A seção 12 define antecedência mínima para *criar* reserva, mas nada impede o cliente de cancelar/remarcar em cima da hora, o que pode ser um problema operacional real para o dono. Vale decidir se há uma janela mínima configurável para essas ações também.
10. **"Receita realizada" é sempre o preço cadastrado do serviço, sem ajuste manual.** Como não há pagamento no MVP (fora de escopo), o valor realizado é uma estimativa baseada no preço do serviço no momento do agendamento. Não há como o dono registrar que cobrou um valor diferente (desconto, serviço adicional feito na cadeira). Vale confirmar que isso é aceitável para o MVP.
11. **Cobrança da própria assinatura SaaS (barbearia → plataforma) não tem gateway definido.** A seção 21 só exclui pagamento do *consumidor* pelo serviço; a cobrança de mensalidade Essencial/Pro está implicitamente dentro do escopo (Superadmin trata inadimplência, cupons, MRR), mas nenhum meio de pagamento é indicado.
12. **Ordem de prioridade da lista de espera não é definida.** A seção 16 diz que "o primeiro a reservar fica com a vaga", mas não como o painel ordena os interessados para contato manual (FIFO, pontuação como na Agenda Inteligente, ou ordem de cadastro).
13. **Link de promoção (`seção 15`) não define se aplica desconto automaticamente no fluxo de agendamento ou é apenas informativo/redirecionamento**, já que não há checkout/pagamento no MVP.
14. **Retenção e exclusão de dados (LGPD) entre `Customer` e `BarbershopCustomer` não é definida.** A seção 10.1 menciona "encerramento de conta e solicitações de privacidade", mas não diz se apagar a conta global apaga também o histórico `BarbershopCustomer` de cada barbearia (que é dado operacional dela) ou se ele é anonimizado/mantido.
15. **Escopo da impersonação do Superadmin ("se aprovada") é ambíguo** — não está claro se entra no MVP ou é um recurso condicionado a uma decisão futura/aprovação de compliance.

## 3. Perguntas que alteram regra de negócio

1. O OTP de criação de conta do cliente será enviado por **SMS** (serviço terceiro a definir) ou pode usar o número de WhatsApp informado no agendamento? (Impacta diretamente o princípio "WhatsApp não é requisito para ação crítica".)
2. A equipe (dono, recepção, profissional) faz login com **e-mail e senha tradicionais**, ou também deve seguir o modelo sem senha?
3. Um mesmo profissional pode ter **login vinculado a mais de uma barbearia**, ou cada vínculo profissional↔barbearia exige um cadastro de usuário separado?
4. O agendamento do MVP permite **selecionar múltiplos serviços em uma única reserva**, ou apenas um serviço/combo por vez (combos sendo cadastrados como serviço único pelo dono)?
5. Deve existir uma **antecedência mínima para cancelar/remarcar** pelo cliente (ex.: não pode cancelar faltando 10 min), ou isso fica livre no MVP?
6. O link `/a/{token}` deve **expirar automaticamente** (ex.: X dias após conclusão/cancelamento) ou permanece válido indefinidamente para consulta?
7. Ao encerrar a conta global (`Customer`), o histórico já existente em cada `BarbershopCustomer` é **mantido (anonimizado)** para a operação da barbearia, ou é apagado também?
8. Como a plataforma vai **cobrar a mensalidade das barbearias** (gateway de pagamento — cartão recorrente, Pix, boleto)? Isso deve ser desenhado já na Parte 1 de arquitetura ou fica para uma fase posterior?
9. A **impersonação de conta pelo Superadmin** entra no MVP com aprovação simples (ex.: log + confirmação), ou deve ficar fora do MVP até haver processo de compliance definido?
10. Na lista de espera (Pro), quando uma vaga abre, a equipe deve contatar os interessados **em qual ordem** (cadastro, pontuação de propensão como na Agenda Inteligente, ou proximidade da preferência informada)?

## 4. Mapa de telas e estados

### Público (sem conta)
- **Página pública da barbearia** `/b/{slug}` — vitrine: serviços, profissionais, botão "Agendar".
- **Fluxo de agendamento** (wizard de 7 passos): Serviço → Profissional/"qualquer" → Data → Horário → Dados (nome + WhatsApp) → Termos + opt-in de promoções → Confirmar.
  - Estados: carregando disponibilidade; HOLD ativo (com contagem regressiva); HOLD expirado; conflito de horário (slot ocupado por outro) com sugestão de horários próximos; erro de validação; erro de rede.
- **Tela de sucesso** — resumo do agendamento + ações (adicionar ao calendário, confirmar no WhatsApp, gerenciar, criar conta).
- **Gestão sem conta** `/a/{token}` — estados: ativo/CONFIRMED (ações cancelar/remarcar/calendário/WhatsApp/criar conta), cancelado, concluído, no-show, link inválido/revogado/expirado.
- **Fluxo de remarcação** (dentro de `/a/{token}` ou da área logada) — reaproveita seleção de data/horário do wizard.
- **Convite para criar conta** — tela intermediária pós-sucesso ("Fique conectado com sua barbearia").
- **Autenticação do cliente** — captura de telefone (ou e-mail fallback) → tela de código OTP/magic link.
- **Vaga direta** `/vaga/{token}` (Pro) — oferece exclusivamente a janela específica detectada pela Agenda Inteligente.
- **Entrada na lista de espera** (Pro) — formulário de preferências (data, faixa de horário, serviço, profissional).

### Área do cliente (logado)
- **Início** — próximos agendamentos.
- **Histórico** — atendimentos passados, barbeiro/serviço mais usados, "agendar novamente".
- **Promoções** — listagem das promoções ativas do estabelecimento.
- **Preferências de comunicação** — opt-in/opt-out por canal.
- **Encerrar conta / privacidade** — solicitação de exclusão/portabilidade.

### Painel da barbearia (dono / recepção / profissional, conforme permissão)
- **Login da equipe** (método a confirmar — pergunta 2).
- **Hoje** — próximo cliente, agenda do dia, faturamento previsto/realizado, horários vagos, cancelamentos/no-shows, alertas da Agenda Inteligente, ações rápidas.
- **Agenda** — visão diária/semanal por profissional/equipe; criar reserva manual; bloquear horário; remarcar; cancelar; alterar status (concluir, no-show).
- **Clientes** — lista/busca, perfil (histórico, preferências calculadas, frequência, ticket médio, consentimentos, atalhos de contato).
- **Equipe** — profissionais, jornada de trabalho, folgas, serviços realizados, calendário conectado, permissões.
- **Gestão**
  - Serviços (CRUD, duração, buffer, profissionais elegíveis).
  - Relatórios (básicos todos os planos; avançados Pro).
  - Promoções (CRUD: período, elegibilidade, limite de usos, público, status).
  - Configurações (dados do estabelecimento, fuso horário, políticas de antecedência).
  - Integrações (status do WhatsApp/Baileys com liga/desliga, Google Calendar por profissional).
  - Assinatura (plano atual, upgrade/downgrade, cobrança).
  - Usuários (equipe e permissões).
- **Agenda Inteligente** (Pro) — lista de vagas detectadas + clientes sugeridos com motivo da pontuação + ações (copiar link, WhatsApp, redes sociais).
- **Lista de espera** (Pro) — entradas ativas, quantidade de interessados por vaga compatível, ação de contato manual.

### Superadmin
- **Barbearias** — lista + status (ativa, inadimplente, suspensa).
- **Detalhe da barbearia** — plano/assinatura, uso, saúde das integrações.
- **Usuários administradores da plataforma**.
- **Suporte / impersonação auditada** (pendente confirmação de escopo — pergunta 9).
- **Inadimplência**.
- **Cupons**.
- **Indicadores (MRR etc.)**.
- **Logs operacionais** (sem conteúdo sensível desnecessário).

### Máquina de estados do agendamento
```
HOLD --(timeout)--> [liberado, sem registro definitivo]
HOLD --(confirmação atômica)--> CONFIRMED
CONFIRMED --(cliente cancela)--> CANCELLED_BY_CUSTOMER
CONFIRMED --(barbearia cancela)--> CANCELLED_BY_SHOP
CONFIRMED --(atendimento realizado)--> COMPLETED
CONFIRMED --(cliente não comparece)--> NO_SHOW
CONFIRMED --(remarcação)--> [novo HOLD/CONFIRMED vinculado ao registro anterior + evento de auditoria]
```
Apenas `CONFIRMED` ocupa agenda definitiva; apenas `COMPLETED` conta como receita realizada e frequência de retorno; `NO_SHOW` é contabilizado à parte; nenhum registro é apagado, só transicionado de estado.

## 5. Confirmação explícita do escopo do MVP

**Dentro do MVP** (conforme especificado, seções 2–20): multi-tenant com página pública, agendamento sem login com HOLD/confirmação atômica, gestão sem conta via link seguro, conta opcional do cliente (OTP/magic link) com CRM automático em duas camadas (Customer/BarbershopCustomer), ciclo de vida completo do agendamento com auditoria, motor de disponibilidade (jornada, exceções, buffer, antecedência, fuso, elegibilidade), planos Essencial/Pro configuráveis (preço fora do código), navegação Hoje/Agenda/Clientes/Equipe/Gestão, Agenda Inteligente baseada em regras (não IA generativa) com detecção de vaga + ranking explicável de clientes + link de preenchimento de vaga, lista de espera (Pro), promoções cadastráveis (sem disparo automático em massa), WhatsApp via link manual (wa.me) sempre disponível + Baileys opcional/isolado (Pro, uso mínimo, nunca crítico), Google Calendar unidirecional opcional por profissional, dashboard com métricas previsto/realizado (básico todos, avançado Pro), e painel Superadmin (tenants, planos, inadimplência, cupons, MRR, saúde de integrações, logs).

**Fora do MVP** (conforme seção 21, confirmado): PDV completo, estoque, emissão fiscal, folha/comissões complexas, marketplace de barbearias, app nativo, chatbot de WhatsApp, IA generativa, campanhas automáticas em massa, pagamento do consumidor pelo serviço, múltiplas unidades por assinatura (salvo decisão posterior), sincronização bidirecional completa com Google Calendar.

Não vou expandir o produto para ERP, marketplace ou bot de WhatsApp, e vou tratar os 15 pontos da seção 2 / 10 perguntas da seção 3 como bloqueios a esclarecer antes de iniciar a Parte 2 (implementação), a menos que o usuário prefira que eu assuma respostas padrão e avance mesmo assim.
