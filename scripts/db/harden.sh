#!/usr/bin/env bash
# Diagnose and (optionally) apply the least-privilege runtime DB role.
#   MODE=diagnose (default) — report app's privileges and what's possible; change nothing.
#   MODE=apply              — run scripts/db/harden-roles.sql, then VERIFY app is DML-only
#                             (reads/writes still work; DDL is denied). Fails loudly if not.
# Env: INSTANCE_PROJECT, INSTANCE_SQL_CONNECTION, MODE.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/ci/lib.sh
. scripts/ci/lib.sh

PROJECT="${INSTANCE_PROJECT:?set INSTANCE_PROJECT}"
CONN="${INSTANCE_SQL_CONNECTION:?set INSTANCE_SQL_CONNECTION}"
MODE="${MODE:-diagnose}"
PORT=5432

start_proxy "$CONN" "$PORT"
trap stop_proxy EXIT

APP_PW="$(db_password "$PROJECT")"
APP_URL="postgresql://app:${APP_PW}@127.0.0.1:${PORT}/autoknow"

echo "==================== DIAGNOSIS (connected as app) ===================="
psql "$APP_URL" -c "SELECT current_user;"
echo "-- role attributes:"
psql "$APP_URL" -c "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname IN ('app','app_runtime','cloudsqlsuperuser','cloudsqladmin') ORDER BY rolname;"
echo "-- role memberships (who app/app_runtime belong to):"
psql "$APP_URL" -c "SELECT r.rolname AS role, g.rolname AS member_of, am.admin_option FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.member JOIN pg_roles g ON g.oid=am.roleid WHERE r.rolname IN ('app','app_runtime') ORDER BY 1,2;"
echo "-- schema public owner:"
psql "$APP_URL" -c "SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='public';"
echo "-- does app hold CREATE on schema public right now?"
psql "$APP_URL" -tAc "SELECT has_schema_privilege('app','public','CREATE') AS app_create_public;"
echo "-- probe: can app actually create/drop a table today? (expect YES pre-harden)"
if psql "$APP_URL" -q -c "CREATE TABLE IF NOT EXISTS _harden_probe(x int);" >/dev/null 2>&1; then
  psql "$APP_URL" -q -c "DROP TABLE _harden_probe;" >/dev/null 2>&1 || true
  echo "   app CAN perform DDL"
else
  echo "   app CANNOT perform DDL"
fi

if [ "$MODE" != "apply" ]; then
  echo "==================== diagnose-only; nothing changed ===================="
  exit 0
fi

RUNTIME_PW="$(db_password "$PROJECT" runtime-database-url)"
RUNTIME_URL="postgresql://app_runtime:${RUNTIME_PW}@127.0.0.1:${PORT}/autoknow"

echo "==================== APPLY harden-roles.sql (as app) ===================="
psql "$APP_URL" -v ON_ERROR_STOP=1 -v runtime_pw="$RUNTIME_PW" -f scripts/db/harden-roles.sql

echo "==================== VERIFY (connected as app_runtime) ===================="
echo "-- app_runtime must READ:"
psql "$RUNTIME_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM \"Partner\";"
echo "-- app_runtime must be able to INSERT/UPDATE/DELETE rows:"
psql "$RUNTIME_URL" -v ON_ERROR_STOP=1 -tAc \
  "SELECT has_table_privilege('app_runtime','\"Partner\"','SELECT'), has_table_privilege('app_runtime','\"Partner\"','INSERT'), has_table_privilege('app_runtime','\"Partner\"','UPDATE'), has_table_privilege('app_runtime','\"Partner\"','DELETE');"
# Negative tests are wrapped in BEGIN…ROLLBACK so they cannot alter anything even if the
# permission check unexpectedly passed. A denied statement (ON_ERROR_STOP) exits non-zero
# = the control works; a zero exit = the statement was allowed = the control FAILED.
echo "-- app_runtime must NOT be able to CREATE a table:"
if psql "$RUNTIME_URL" -v ON_ERROR_STOP=1 -q -c "BEGIN; CREATE TABLE _harden_probe(x int); ROLLBACK;" >/dev/null 2>&1; then
  echo "::error::app_runtime can CREATE tables — hardening INEFFECTIVE" >&2
  exit 1
fi
echo "-- app_runtime must NOT be able to DROP a table:"
if psql "$RUNTIME_URL" -v ON_ERROR_STOP=1 -q -c 'BEGIN; DROP TABLE "Partner"; ROLLBACK;' >/dev/null 2>&1; then
  echo "::error::app_runtime can DROP tables — hardening INEFFECTIVE" >&2
  exit 1
fi
echo "OK: app_runtime can read/write rows but cannot alter schema. Hardening verified."
