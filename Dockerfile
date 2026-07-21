# Alpine variant — same multi-stage build on a musl base to measure image size.
# Prisma's pg driver adapter is engine-less (pure JS) and pg is pure JS, so musl is safe.
# Building deps ON alpine pulls the musl SWC + sharp binaries.

FROM node:22-alpine AS deps
WORKDIR /app
# `npm ci` runs postinstall HERE, and the contract is that it degrades to NOTHING:
# only package*.json is in scope, and `scripts/` is excluded from the build context
# on purpose (.dockerignore — keep the image clean), so the bootstrap script is
# absent and its half of the entry is rescued by `|| true`, while the Prisma half
# skips for want of a schema. Nothing added to postinstall may need the source tree.
# The builder stage below generates the client explicitly, because it never re-runs
# `npm ci`. CI's `image` job builds this file so the contract is checked, not
# assumed — an earlier attempt to COPY the script in here died on exactly that
# .dockerignore rule, in CI-shaped verification rather than at deploy time. ADR 0008.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run db:generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# Which commit this image runs — surfaced by /api/health for deploy verification.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
