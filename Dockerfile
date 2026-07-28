# Alpine variant — same multi-stage build on a musl base to measure image size.
# Prisma's pg driver adapter is engine-less (pure JS) and pg is pure JS, so musl is safe.
# Building deps ON alpine pulls the musl SWC + sharp binaries.

# The base image comes from our Artifact Registry remote repo (a proxy + cache of
# Docker Hub), not docker.io: on 2026-07-27 a docker.io timeout failed a prod deploy
# AFTER migrations had applied (autoknow-d1h). Pinned by DIGEST, not the 22-alpine
# tag, so a moved tag cannot silently change the runtime. This digest is the
# multi-arch index for node 22.23.1 on alpine 3.24 — bumping it is a deliberate act;
# resolve a new one with `docker buildx imagetools inspect node:22-alpine`.
# Pulling needs AR auth (gcloud auth configure-docker us-central1-docker.pkg.dev);
# CI's image job and the deploy script both do this.
ARG NODE_BASE=us-central1-docker.pkg.dev/autoknow-prod-1895f1/dockerhub/library/node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

FROM ${NODE_BASE} AS deps
WORKDIR /app
# `npm ci` runs postinstall HERE, and the contract is that it degrades to NOTHING:
# only package*.json is in scope, and `scripts/` is excluded from the build context
# on purpose (.dockerignore — keep the image clean), so the bootstrap script is
# absent and its half of the entry is rescued by `|| true`, while the Prisma half
# skips for want of a schema. Nothing added to postinstall may need the source tree.
# The builder stage below generates the client explicitly, because it never re-runs
# `npm ci`. CI's `image` job builds this file so the contract is checked, not
# assumed — an earlier attempt to COPY the script in here died on exactly that
# .dockerignore rule, in CI-shaped verification rather than at deploy time. ADR npm-ci-bootstraps-a-checkout-but-nothing-depends-on-it.
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_BASE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run db:generate
RUN npm run build

FROM ${NODE_BASE} AS runner
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
