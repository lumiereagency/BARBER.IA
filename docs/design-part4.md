# BARBER SaaS — Parte 4: direção visual (entregáveis do §1, antes do código)

A Parte 4 pede, no §1 e no §33: oito entregáveis de aprovação, e nenhum código
visual antes de aprovados. Este documento é essa entrega. Nenhum componente,
página nova ou classe Tailwind foi alterado nesta etapa — só o canvas visual
publicado (link na seção 6), que é mockup, não app.

Complementa, sem repetir: `docs/product-scope-part1.md` (produto e jornadas),
`docs/architecture.md` (stack) e `docs/status.md` (o que já está no ar).

---

## 0. Confronto com o que já existe

A Parte 4 assume um produto ainda sem interface. Não é o caso: Marcos 0–5 estão
implementados e testados, com uma UI funcional em Tailwind puro — neutra, clara,
sem tokens, sem tema, sem ícones de biblioteca, sem motion. Adotar a direção da
Parte 4 é **retema completo**, não decoração por cima. Isto muda o que cada
entregável abaixo pode prometer:

| Da Parte 4 | Hoje no código | Efeito nesta entrega |
|---|---|---|
| Dark premium como identidade principal | `bg-neutral-50` / `bg-white` / `text-neutral-900` fixos em toda tela, sem variável de tema | Tokens propostos na seção 3 são a base; aplicá-los em 20+ arquivos é o próximo marco visual, não desta etapa. |
| `Manrope` + `Geist Mono`, `Lucide` | Fonte padrão do sistema, nenhum ícone de biblioteca (nenhuma linha usa `<svg>` de ícone) | Nova dependência (`next/font`, `lucide-react`) a somar no próximo marco. |
| `shadcn/ui` ou Radix como fundação | Nenhuma; cada tela escreve `<button>`/`<input>` com classes inline | Camada de componentes (seção 4) é construção nova, não retoque. |
| Framer Motion para transições | Nenhuma transição além do CSS default do navegador | Nova dependência; plano na seção 8, zero implementação ainda. |
| Personalização por barbearia (logo, capa, cor de destaque) | Onboarding (Marco 1) só grava nome, descrição, endereço e contato — sem upload de imagem, sem cor | Depende de armazenamento de objetos (S3, ainda não decidido — `docs/status.md` §3) antes de poder ser construído. |
| Site institucional (venda, hero, planos, FAQ) | `apps/web/app/page.tsx` é um placeholder de uma linha | Experiência inteira por construir; ver gap G1 abaixo. |
| Tela **Clientes** (CRM do lado da equipe) | RBAC já tem a permissão `customers.read`; a tela nunca foi construída — o item de menu que apontava para ela foi removido no Marco 5 por ser link morto | Ver gap G2. |
| Tela **Inteligência** | Não existe — depende do motor da Agenda Inteligente, que é o Marco 6 | Fora desta fase por definição do próprio roteiro (Parte 3 §8). |
| **Promoções** (lado da barbearia) | Só existe o oposto: o cliente liga/desliga consentimento de marketing na própria conta. Não há tela da barbearia para criar/gerenciar promoção | Ver gap G3. |
| **Relatórios** | Métricas ao vivo existem soltas em Hoje/Agenda; não há tela dedicada | Depende de decisões de plano/entitlement do Marco 6. |
| Nome definitivo → `{{PRODUCT_NAME}}` | `apps/web/app/layout.tsx` tem `title: "BARBER SaaS"` fixo; "BARBER SaaS" também aparece hardcoded em e-mails/textos de teste | Ver decisão pendente P1. |

Gaps que **não bloqueiam** esta entrega (o mapa de telas os inclui como
"planejado, não construído"), mas que precisam de uma decisão de roteiro antes
do próximo marco visual:

- **G1 — site institucional**: é a 4ª experiência do §14, e hoje é a que tem
  menos código (uma página placeholder). Proponho tratá-la como o primeiro
  entregável do próximo marco visual, já que hero + planos + CTA validam a
  paleta e a tipografia com o menor acoplamento ao resto do app.
- **G2 — tela Clientes**: a permissão já existe no RBAC (`customers.read`/
  `customers.write`/`customers.notes.read`) e o modelo de dados (`BarbershopCustomer`,
  CRM automático do Marco 4) já está pronto — falta só a tela. Como não depende
  de nenhuma decisão de negócio nova, pode entrar no próximo marco visual junto
  do retema, e não precisa esperar o Marco 6.
- **G3 — Promoções (lado da barbearia)**: diferente de Clientes, esta precisa
  de modelo de dados novo (regra de elegibilidade, período, canal) que a Parte 3
  não detalhou. Fica com o Marco 6, como o roteiro já previa.

---

## 1. Mapa final de telas

Rotas reais do App Router (`apps/web/app`), mais as que a Parte 4 pede e ainda
não existem — marcadas como **planejada**.

| Rota | Tela | Perfil | Estado |
|---|---|---|---|
| `/` | Site institucional | Visitante | Placeholder — planejada (G1) |
| `/criar-conta` | Criar conta + barbearia | Dono | Construída |
| `/entrar` | Entrar (equipe) | Equipe | Construída |
| `/hoje` | Hoje | Dono, Admin, Recepção, Profissional | Construída |
| `/agenda` | Agenda (dia/semana) | Dono, Admin, Recepção, Profissional | Construída |
| `/equipe` | Equipe (profissionais) | Dono, Admin | Construída |
| `/gestao/servicos` | Serviços | Dono, Admin | Construída |
| `/gestao/configuracoes` | Configurações da barbearia | Dono, Admin | Construída |
| `/gestao/integracoes` | Integrações (Google Agenda) | Dono, Admin, Profissional (a própria) | Construída |
| `/clientes` | Clientes / CRM | Dono, Admin, Recepção | Planejada (G2) |
| `/inteligencia` | Agenda Inteligente | Dono, Admin, Recepção | Planejada (Marco 6) |
| `/gestao/promocoes` | Promoções | Dono, Admin | Planejada (G3 / Marco 6) |
| `/relatorios` | Relatórios | Dono, Admin | Planejada (Marco 6) |
| `/b/{slug}` | Página pública da barbearia | Visitante | Construída |
| `/b/{slug}/agendar` | Fluxo de reserva | Visitante | Construída |
| `/vaga/{token}` | Vaga compartilhável | Visitante | Construída |
| `/a/{token}` | Gerenciar agendamento (sem conta) | Cliente sem conta | Construída |
| `/entrar-cliente` | Entrar (cliente, OTP) | Cliente | Construída |
| `/minha-conta` | Início da conta do cliente | Cliente | Construída |
| `/minha-conta/historico` | Histórico | Cliente | Construída |
| `/minha-conta/preferencias` | Preferências e privacidade | Cliente | Construída |
| `/barbearias` (superadmin) | Lista de barbearias | Superadmin | Placeholder — Marco 7 |

**Fora do MVP visual, por decisão explícita da própria Parte 4** (§21, §27):
marketplace entre barbearias, alternância de múltiplas unidades na mesma conta
(coluna já existe no banco — `organization_id` — mas nula no MVP), chat como
interface de IA.

---

## 2. Sitemap por perfil

```
Visitante
├─ Site institucional (/)
├─ Página pública da barbearia (/b/{slug})
│  └─ Fluxo de reserva (/b/{slug}/agendar) → sucesso → convite de conta
├─ Vaga compartilhável (/vaga/{token})
└─ Gerenciar agendamento sem conta (/a/{token})

Cliente (conta por OTP)
├─ Entrar (/entrar-cliente)
└─ Minha conta (/minha-conta)
   ├─ Início — próximo horário, agendar de novo, promoções elegíveis
   ├─ Histórico (/minha-conta/historico)
   └─ Preferências e privacidade (/minha-conta/preferencias)

Equipe — Dono / Admin
├─ Entrar (/entrar) · Criar conta (/criar-conta)
├─ Hoje (/hoje)
├─ Agenda (/agenda)
├─ Clientes (/clientes) — planejada
├─ Equipe (/equipe)
├─ Inteligência (/inteligencia) — Marco 6
├─ Gestão
│  ├─ Serviços (/gestao/servicos)
│  ├─ Promoções (/gestao/promocoes) — Marco 6
│  ├─ Relatórios (/relatorios) — Marco 6
│  ├─ Integrações (/gestao/integracoes)
│  ├─ Configurações (/gestao/configuracoes)
│  └─ Assinatura — Marco 7
└─ Sair

Equipe — Recepção
├─ Hoje, Agenda, Clientes (mesmas telas do Dono, sem Configurações/Equipe/Assinatura)
└─ Gestão → só Integrações em modo leitura

Equipe — Profissional
├─ Hoje, Agenda — apenas a própria agenda (RBAC .own)
└─ Gestão → Integrações — apenas a própria conexão de calendário

Superadmin da plataforma
└─ Barbearias (/barbearias) — Marco 7: status, impersonation auditada, billing
```

---

## 3. Design tokens

Os valores abaixo são os da especificação, sem reinterpretação — a Parte 4
pede para não copiar a *paleta de referência* (imagens), não estes tokens, que
já são a versão "própria" definida pelo documento. Nomeados para virar variáveis
CSS (`--color-brand-500` etc.) mais uma extensão Tailwind, no marco em que forem
aplicados.

### 3.1 Marca

| Token | Valor | Uso |
|---|---|---|
| `brand-500` | `#FF5A1F` | CTA principal, seleção, oportunidades |
| `brand-400` | `#FF7442` | hover, destaque leve |
| `brand-600` | `#E84612` | pressed, alto contraste |
| `brand-soft` | `#2B160F` | fundo de alerta/chip de marca |
| `brand-glow` | `rgba(255,90,31,.28)` | brilho controlado |

### 3.2 Neutros (dark, base)

| Token | Valor |
|---|---|
| `bg-canvas` | `#08090B` |
| `bg-surface-1` | `#0F1114` |
| `bg-surface-2` | `#15181D` |
| `bg-surface-3` | `#1B1F25` |
| `border-subtle` | `#262B33` |
| `border-strong` | `#3A414C` |

### 3.3 Texto

| Token | Valor |
|---|---|
| `text-primary` | `#F7F7F4` |
| `text-secondary` | `#B2B7C0` |
| `text-muted` | `#747B86` |
| `text-inverse` | `#101114` |

### 3.4 Estado (sempre com texto/ícone, nunca só cor — §6.4)

| Token | Valor |
|---|---|
| `state-success` | `#35C784` |
| `state-warning` | `#F5B942` |
| `state-error` | `#F25F68` |
| `state-info` | `#5A9EF7` |

### 3.5 Tema claro (ligado desde o MVP — decisão P3)

| Token | Valor |
|---|---|
| `canvas` (claro) | `#F5F5F2` |
| `surface` (claro) | `#FFFFFF` |
| `text-primary` (claro) | `#15171A` |
| `text-secondary` (claro) | `#626872` |
| `border` (claro) | `#E1E3E6` |

### 3.6 Tipografia

| Estilo | Tamanho/altura | Peso |
|---|---|---|
| Display | 48/54 desktop · 36/42 mobile | 650–700 |
| H1 | 32/38 | 650 |
| H2 | 24/30 | 650 |
| H3 | 20/26 | 600 |
| Body L | 16/24 | 450 |
| Body | 14/21 | 450 |
| Label | 13/18 | 600 |
| Caption | 12/17 | 500 |

Família: `Manrope` (interface e títulos) + numerais tabulares da própria
Manrope para horário/valor/métrica — evita a segunda família (`Geist Mono`) até
haver evidência de que a Manrope não cobre bem números tabulares no teste real.
`Inter` fica de reserva caso a Manrope pese demais no `next/font`.

### 3.7 Espaço, raio, grid

| Categoria | Valores |
|---|---|
| Espaço | base 4px; preferir 8·12·16·24·32·48 |
| Raio — campo/botão | 12px |
| Raio — card funcional | 16px |
| Raio — painel/modal | 20px |
| Raio — pill | total |
| Sidebar desktop | 232–256px |
| Header desktop | 64–72px |
| Grid desktop | 12 colunas, gutter 24px, margem 24–40px |
| Grid mobile | 4 colunas, gap 12–16px, margem 16px |
| Nav inferior mobile | 64–72px + safe area |
| Alvo de toque mínimo | 44px |
| Breakpoints | `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536 |

---

## 4. Componentes principais

Inventário dos 30 componentes do §22, contra o que existe hoje. Nenhum dos
"existe (sem tokens)" precisa ser reescrito do zero — a base já resolve
associação de rótulo, estado de erro e disabled; falta o retema e os estados
que ainda não têm caso de uso na tela (loading, success visual).

| Componente | Estado hoje |
|---|---|
| Button, icon button | Existe (sem tokens) — `<button>` inline em cada tela |
| Input, phone input | Existe (sem tokens) — `Field` em `components/field.tsx` |
| Checkbox, switch | Existe parcial — `CheckboxField`; switch não existe |
| Select/combobox | Existe (sem tokens) — `<select>` nativo |
| Date picker | Não existe — reserva pública usa grade de dias, não um seletor genérico |
| Time slot | Existe (sem tokens) — botões de horário no `booking-wizard` |
| Service item, professional selector | Existe (sem tokens) |
| Appointment row/card, timeline, calendar grid | Existe (sem tokens) — `/agenda` |
| Status badge | Existe parcial — texto colorido inline, não um componente |
| Metric compact | Existe parcial — números soltos em `/hoje` |
| Smart opportunity | Não existe — Marco 6 |
| Customer return item | Não existe — depende de G2/Marco 6 |
| Drawer, bottom sheet, dialog, dropdown | Não existem — ações hoje usam `<details>`/página cheia |
| Command palette | Não existe |
| Toast | Existe parcial — mensagem de sucesso/erro inline no formulário, não um toast flutuante |
| Empty state | Existe parcial — texto simples em listas vazias |
| Skeleton | Não existe — hoje sem estado de carregamento visível |
| Error state | Existe parcial — `role="alert"` inline |
| Stepper, progress | Existe parcial — o wizard de reserva pública tem etapas sem indicador visual |
| Table responsiva | Não existe — listas são `<ul>` |
| Chart tooltip | Não existe — nenhum gráfico ainda |
| Plan gate | Não existe — nenhum entitlement de plano ainda |

Decisão adotada (não pendente): construir sobre **Radix primitives + Tailwind**,
sem o CLI do shadcn/ui — o projeto já normaliza acessibilidade à mão
(`components/field.tsx`) e prefere não herdar arquivos gerados que depois
precisam ser "completamente personalizados" como o próprio §22 pede. Radix dá
o comportamento acessível (foco, teclado, ARIA); os tokens da seção 3 dão a
aparência.

---

## 5. Wireframes dos fluxos críticos

Wireframes de baixa fidelidade (estrutura e hierarquia, sem cor de marca) dos
três fluxos que a Parte 4 chama de críticos, publicados no canvas da seção 6:

1. **Onboarding da barbearia** — as 7 etapas do §16, uma decisão por tela,
   progresso visível, sem exigir Google Agenda/WhatsApp para concluir.
2. **Reserva pública** — as 9 etapas do §19 (capa → serviço → profissional →
   data → horário → dados → revisão → sucesso), com os 9 estados obrigatórios
   do §19 (vazio, sem serviço, sem profissional, sem horário, horário
   recém-ocupado, hold expirando, erro recuperável, confirmado, indisponível)
   já mapeados um a um contra os estados que `booking.ts` já modela
   (`SlotUnavailableError`, hold expirado, etc.) — nenhum estado novo de
   backend é necessário, só a representação visual.
3. **Painel Hoje** — hierarquia do §17: saudação/data → próximo cliente e ação
   → agenda cronológica → oportunidade da Agenda Inteligente (placeholder
   inativo até o Marco 6) → resumo do dia → alertas.

---

## 6. Telas-chave em alta fidelidade

Uma mobile (**Hoje**, 390px) e uma desktop (**Agenda**, 1440px) — as duas
escolhidas por aparecerem na jornada de todo perfil de equipe todo dia, o que
as torna o teste mais direto da paleta, tipografia e componentes em conteúdo
real (nomes, horários, valores), não em texto de exemplo.

**Canvas publicado**: https://claude.ai/code/artifact/3366011f-ac7d-476b-862e-b90dba0aac06 —
seis pranchas em um canvas só: fundamentos (tokens), amostra de componentes,
wireframe do onboarding, wireframe da reserva pública, e as duas telas em alta
fidelidade. Publicado antes da resolução das decisões da seção 9 — ainda mostra
`{{PRODUCT_NAME}}` e o símbolo placeholder, não "CUTLIST" nem o arquivo real do
logo (que chega com a decisão P2). Será atualizado no próximo marco visual,
junto da implementação, para não redesenhar duas vezes.

---

## 7. Inventário de assets

| Categoria | Itens | Estado |
|---|---|---|
| Símbolo | Principal, positivo/negativo, monocromático, redução 16/24/32px | Aguardando o arquivo (decisão P2) — você vai enviar |
| Wordmark | Horizontal, assinatura vertical | Nome resolvido: **CUTLIST** — pode ser produzido assim que o símbolo chegar |
| Ícone de app | PWA, favicon | Pendente do símbolo final |
| Fotografia | Ambiente real, iluminação quente, profissionais trabalhando, detalhes de acabamento — mínimo 12 imagens para cobrir hero, onboarding, site institucional | Placeholder por decisão (P4) — blocos de cor/gradiente até haver fonte |
| Assets próprios | Orb de partículas, textura de grão, halo laranja, 3 mini-ilustrações (agenda vazia, cliente retornando, vaga preenchida), padrão geométrico, avatar fallback com iniciais, placeholder de foto | A produzir no próximo marco visual, depois do símbolo aprovado (dependem dele) |
| Ícones de interface | `lucide-react`, traço 1.75–2px, 16/20/24px | A instalar — não requer decisão, só o marco de implementação |
| Fontes | Manrope (self-hosted via `next/font`) | A instalar |

---

## 8. Plano de motion e estados

| Categoria | Duração | Curva |
|---|---|---|
| Microfeedback | 100–160ms | — |
| Componente | 180–240ms | — |
| Transição de página/etapa | 240–360ms | — |
| Celebração | até 700ms | — |
| Entrada | — | `cubic-bezier(.16,1,.3,1)` |
| Saída | — | `cubic-bezier(.4,0,1,1)` |
| Padrão | — | spring leve, sem bounce |

Aplicações (§23), mapeadas contra o código que já existe e vai receber o
motion: seleção de serviço/horário (`booking-wizard.tsx`), avanço de etapa
(mesmo arquivo), expansão de resumo, abertura de drawer/sheet (componente
novo, seção 4), atualização de status (`appointment-actions.tsx`), slot
cancelado voltando à agenda (efeito visual de algo que `cancelAppointment` já
faz no banco — `docs/architecture.md` §3), confirmação de reserva, transição
entre dias na agenda, atualização de indicador.

Regras que não mudam com o motor escolhido: `prefers-reduced-motion` sempre
respeitado; nenhuma ação fica indisponível sem a animação (o clique/toque
funciona mesmo com motion desligado); motion de marca (símbolo se fechando)
só em splash/loading de autenticação — nunca como spinner de toda requisição.

Biblioteca: `Framer Motion` para transição de interface, CSS puro para
microfeedback. Rive/Lottie para a animação de marca fica como decisão do marco
em que o símbolo existir — sem símbolo aprovado não há o que animar.

---

## 9. Decisões — resolvidas em 2026-09-04

| # | Decisão | Resposta | O que isso muda na implementação |
|---|---|---|---|
| P1 | Nome definitivo do produto | **CUTLIST** | `{{PRODUCT_NAME}}` deixa de ser placeholder. Vira uma constante `PRODUCT_NAME = "CUTLIST"` em `packages/config`, lida de env var (`NEXT_PUBLIC_PRODUCT_NAME` ou similar) com esse valor como default — nunca hardcoded espalhado pelo código, como o §2 exige. Atualiza `<title>` em `apps/web/app/layout.tsx`, o wordmark, e os textos de SMS/e-mail que hoje dizem "BARBER SaaS" em teste. |
| P2 | Arquivo-mestre do símbolo | **Você vai enviar a imagem gerada** | Aguardando o arquivo. Quando chegar, eu vetorizo a partir dele seguindo as regras do §5.1 (sem tesoura, sem 3D, sem deformar, sem trocar proporção) e produzo o conjunto completo do §5 (positivo/negativo, monocromático, reduções 16/24/32px, ícone de PWA, favicon). Até lá, o canvas mantém o placeholder geométrico explícito. |
| P3 | Tema escuro só, ou os dois já no MVP | **Os dois já no MVP** | Muda o escopo do próximo marco visual: em vez de só aplicar os tokens dark, a implementação sai direto com `data-theme` (ou equivalente) alternando os dois conjuntos de tokens da seção 3.5, alternância persistida por usuário, e QA dobrado — cada tela verificada nos dois temas antes de fechar o marco, não só no escuro. |
| P4 | Fonte da fotografia premium | **Placeholders por enquanto** | O canvas e a implementação seguem com blocos de cor/gradiente no lugar de foto. Sem bloqueio — troco por fotos reais assim que você tiver uma fonte (própria ou banco licenciado). |
| P5 | Site institucional — mesmo app ou separado | **Mesmo `apps/web`** | A rota `/`, hoje placeholder, vira o site institucional do §15 (hero, planos, FAQ) dentro do mesmo Next.js do painel — sem segundo deploy, sem duplicar CI/tokens. |

Com as cinco decisões resolvidas, os oito entregáveis do §1 estão completos e
nada mais bloqueia o início do próximo marco visual — exceto o arquivo do
símbolo (P2), que só trava a vetorização final, não o resto do retema
(tokens, componentes, tema claro/escuro, site institucional podem avançar em
paralelo usando o placeholder geométrico até o arquivo chegar).
