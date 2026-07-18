# Production image for Cloud Run: multi-stage → Next.js standalone on a slim runtime.
# Prisma 7 uses the pg driver adapter (engine-less), so no Rust query engine to ship —
# the standalone trace + the generated JS client is all the runtime needs.

# ---- deps: install with a clean, reproducible lockfile ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: generate the Prisma client and build the standalone server ----
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A syntactically-valid placeholder so any import-time Pool() construction is happy;
# the real DATABASE_URL is injected at runtime from Secret Manager. next build never
# connects (every page is force-dynamic).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ---- runner: minimal, non-root ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run sets PORT; Next standalone reads it. Bind all interfaces.
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output + static assets + public. Also copy the generated Prisma client
# explicitly (belt to output-tracing braces — it lives under node_modules/.prisma).
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
