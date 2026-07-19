#!/usr/bin/env bash
# Apply forward-only Prisma migrations to an instance's Cloud SQL database.
#
# Safe by construction:
#   - only ever runs `prisma migrate deploy` (forward-only; never `db push`/`reset`).
#   - baselines a pre-migrations database exactly once (schema present, no _prisma_migrations),
#     and NEVER on an empty database (a fresh instance runs 0_init to build the schema).
#
# Env: INSTANCE_PROJECT, INSTANCE_SQL_CONNECTION. Optional: DB_PROXY_PORT (default 5432).
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/ci/lib.sh
. scripts/ci/lib.sh

PROJECT="${INSTANCE_PROJECT:?set INSTANCE_PROJECT}"
CONN="${INSTANCE_SQL_CONNECTION:?set INSTANCE_SQL_CONNECTION}"
PORT="${DB_PROXY_PORT:-5432}"

start_proxy "$CONN" "$PORT"
trap stop_proxy EXIT

PW="$(db_password "$PROJECT")"
export DATABASE_URL="postgresql://app:${PW}@127.0.0.1:${PORT}/autoknow?schema=public"
PSQL_URL="postgresql://app:${PW}@127.0.0.1:${PORT}/autoknow" # psql rejects Prisma's ?schema=

history="$(psql "$PSQL_URL" -tAc "SELECT to_regclass('public._prisma_migrations')" | tr -d '[:space:]')"
tables="$(psql "$PSQL_URL" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name <> '_prisma_migrations'" \
  | tr -d '[:space:]')"

if [ -z "$history" ] && [ "${tables:-0}" -gt 0 ]; then
  echo "Existing schema without migration history — baselining 0_init as applied."
  npx prisma migrate resolve --applied 0_init
fi

npx prisma migrate deploy
