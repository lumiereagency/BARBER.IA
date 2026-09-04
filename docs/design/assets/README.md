# Símbolo CUTLIST — ativos de marca

Resolve a decisão P2 de `docs/design-part4.md` §9. `referencia-simbolo-original.jpg`
é a imagem que você enviou — guardada aqui como referência, **não como arquivo-mestre**
(a Parte 4 §2 é explícita sobre essa distinção). O arquivo-mestre é o vetor
traçado a partir dela, abaixo.

## Como foi feito

Vetorizado com `potrace` (traçado de bitmap para path SVG) a partir da imagem
enviada, depois normalizado: viewBox recortado à caixa real do símbolo (sem a
margem morta do quadro original), removida a folha de estilo/DOCTYPE que o
potrace inclui por padrão. O resultado são dois `<path>` — as duas formas
arredondadas do §2, cada uma sua própria peça, conectadas pelo corte diagonal.

## `simbolo/` — o símbolo

| Arquivo | Cor | Uso |
|---|---|---|
| `simbolo.svg` | `currentColor` | Master para uso **inline** (componente React, SVG embutido direto no HTML) — a cor vem do CSS de quem usa. Não funciona corretamente como `<img src>`, porque `currentColor` não atravessa essa fronteira; para isso, use uma das variantes abaixo. |
| `simbolo-marca.svg` | `#FF5A1F` (brand-500) | Símbolo principal — a versão colorida usada em contexto de marketing/institucional. |
| `simbolo-fundo-escuro.svg` | `#F7F7F4` (quase-branco) | Versão "negativa" — para qualquer fundo escuro. |
| `simbolo-fundo-claro.svg` | `#101114` (quase-preto) | Versão "positiva" — para qualquer fundo claro. |

Testado a 128px, 32px, 24px e 16px (§5.1) — continua legível como forma
abstrata mesmo no tamanho de favicon; o entalhe fino do corte diagonal é o
primeiro detalhe a se perder, o que é esperado e aceitável nesse tamanho.

## `wordmark/` — símbolo + nome

`wordmark-horizontal.svg` e `assinatura-vertical.svg`, ambos em `currentColor`
(mesma ressalva de uso inline acima). O nome está grafado **"Cutlist"**, não
"CUTLIST": segue a regra do §5 ("evitar caixa alta pesada como padrão"), não a
grafia exata com que você respondeu a pergunta de nome — se a intenção era uma
marca sempre em caixa alta, me avise que eu reconstruo o wordmark.

O texto do wordmark está em `<text>` viva (fonte Manrope via CSS), não
convertida em contorno/path. Correto para uso web (a fonte é carregada pela
aplicação), mas não é um arquivo "pronto para impressão" sem depender de fonte
instalada — converter para contorno é um passo de acabamento gráfico que não
foi feito aqui.

## `app-icon/` — favicon e ícone de app

`icon-source.svg` é o mestre: símbolo em brand-500 sobre uma prancheta
arredondada `#0F1114` (bg-surface-1). Rasterizado para os tamanhos que um app
Next.js/PWA usa de fato: `favicon-16.png`, `favicon-32.png`,
`apple-touch-icon-180.png`, `icon-192.png`, `icon-512.png`.

**Já aplicado ao código**: `apps/web/app/icon.svg` (favicon SVG nativo do
Next.js) e `apps/web/app/apple-icon.png` (180×180) usam este símbolo — troca
pontual e sem risco, não faz parte do retema completo que ainda depende das
demais decisões da Parte 4. `icon-192.png`/`icon-512.png` ficam prontos aqui
para quando um `manifest.json` de PWA for construído (fora do escopo atual).

## O que ainda falta

- Converter o texto do wordmark em contorno (path) para um arquivo verdadeiramente
  "pronto para produção gráfica" (cartão, impressão), se algum dia for preciso.
- `manifest.json` do PWA (ícones já existem, o manifesto em si não foi criado).
- Confirmar com você se "Cutlist" (title case) é mesmo a grafia certa, ou se
  a marca deveria ser sempre em caixa alta ("CUTLIST").
