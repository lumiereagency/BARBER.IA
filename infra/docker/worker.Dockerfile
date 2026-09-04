# Worker de efeitos assíncronos. Processo separado da web, como exige a
# topologia da Parte 3 §3 — a reserva nunca depende dele para ser válida.
# Contexto de build: raiz do repositório.

FROM node:22-alpine AS base
# O binário do Prisma detecta a versão do OpenSSL em tempo de execução; sem o
# pacote instalado, a detecção falha e ele baixa/usa o motor errado — erro só
# aparece rodando de verdade, nunca em teste local fora do Alpine.
RUN apk add --no-cache openssl
RUN corepack enable
# corepack só baixa a versão fixada de pnpm na primeira vez que ele é
# invocado — sem isto aqui, o CMD deste worker (que roda "pnpm --filter
# @barber/worker start") tentaria baixá-lo em tempo de execução, e a rede
# `internal` do compose não alcança a internet, de propósito.
RUN corepack prepare pnpm@10.33.0 --activate  # mantenha em sincronia com "packageManager" em /package.json
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/api-contracts/package.json packages/api-contracts/
COPY packages/config/package.json packages/config/
COPY packages/integrations/package.json packages/integrations/
COPY packages/entitlements/package.json packages/entitlements/
RUN pnpm install --frozen-lockfile

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /repo/packages ./packages
COPY . .
RUN pnpm --filter @barber/db exec prisma generate \
 && pnpm --filter @barber/domain build

RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001 \
 && chown -R worker:nodejs /repo
USER worker

CMD ["pnpm", "--filter", "@barber/worker", "start"]
