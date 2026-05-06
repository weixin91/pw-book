FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY packages/shared-types/package.json packages/shared-types/
RUN npm install -g pnpm && pnpm install
COPY . .
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
RUN pnpm --filter backend exec prisma generate
RUN pnpm --filter @pwbook/shared-types build
RUN pnpm --filter backend build

FROM node:20-alpine
RUN apk add --no-cache sqlite
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/packages/shared-types ./packages/shared-types
EXPOSE 3000
CMD ["sh", "-c", "apps/backend/node_modules/.bin/prisma migrate deploy && node apps/backend/dist/index.js"]
