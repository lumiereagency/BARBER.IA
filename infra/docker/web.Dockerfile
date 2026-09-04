# Build da aplicação web. Multi-stage: a imagem final não carrega toolchain
# nem dependências de desenvolvimento.
# Contexto de build: raiz do repositório.

FROM node:22-alpine AS base
# O binário do Prisma detecta a versão do OpenSSL em tempo de execução; sem o
# pacote instalado, a detecção falha e ele baixa/usa o motor errado — erro só
# aparece rodando de verdade, nunca em teste local fora do Alpine.
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /repo

# --- dependências -----------------------------------------------------------
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

# --- build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages ./packages
COPY . .
# O client do Prisma precisa existir antes do build do Next
RUN pnpm --filter @barber/db exec prisma generate
RUN pnpm --filter @barber/domain build
RUN pnpm --filter @barber/web build

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runner
# O motor de consulta do Prisma (@prisma/client) roda aqui em toda query —
# precisa do mesmo pacote que o estágio de build, esta imagem não herda dele.
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Não rodar como root
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
