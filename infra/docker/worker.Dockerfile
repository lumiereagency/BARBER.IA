# Worker de efeitos assíncronos. Processo separado da web, como exige a
# topologia da Parte 3 §3 — a reserva nunca depende dele para ser válida.
# Contexto de build: raiz do repositório.

FROM node:22-alpine AS base
RUN corepack enable
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
