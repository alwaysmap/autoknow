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

APP_PW="$(gcloud secrets versions access latest --secret=database-url --project "$PROJECT" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')"
APP_URL="postgresql://app:${APP_PW}@127.0.0.1:${PORT}/autoknow"

echo "==================== DIAGNOSIS (connected as app) ===================="
psql "$APP_URL" -c "SELECT current_user;"
echo "-- role attributes:"
psql "$APP_URL" -c "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname IN ('app','migrator','cloudsqlsuperuser','cloudsqladmin') ORDER BY rolname;"
echo "-- role memberships (who app/migrator belong to):"
psql "$APP_URL" -c "SELECT r.rolname AS role, g.rolname AS member_of, am.admin_option FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.member JOIN pg_roles g ON g.oid=am.roleid WHERE r.rolname IN ('app','migrator') ORDER BY 1,2;"
echo "-- schema public owner:"
psql "$APP_URL" -c "SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='public';"
echo "-- can app admin the migrator role (needed to reassign ownership)?"
psql "$APP_URL" -tAc "SELECT pg_has_role('app','migrator','USAGE') AS app_in_migrator, pg_has_role('app','migrator','MEMBER') AS app_member_migrator;"
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

echo "==================== APPLY harden-roles.sql (as app) ===================="
psql "$APP_URL" -v ON_ERROR_STOP=1 -f scripts/db/harden-roles.sql

echo "==================== VERIFY (as app) ===================="
echo "-- app must still READ:"
psql "$APP_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM \"Partner\";"
echo "-- app must still have INSERT/UPDATE/DELETE:"
psql "$APP_URL" -v ON_ERROR_STOP=1 -tAc \
  "SELECT has_table_privilege('app','\"Partner\"','SELECT'), has_table_privilege('app','\"Partner\"','INSERT'), has_table_privilege('app','\"Partner\"','UPDATE'), has_table_privilege('app','\"Partner\"','DELETE');"
echo "-- app must NOT be able to DDL (this is the whole point):"
if psql "$APP_URL" -q -c "CREATE TABLE _harden_probe2(x int);" >/dev/null 2>&1; then
  psql "$APP_URL" -q -c "DROP TABLE _harden_probe2;" >/dev/null 2>&1 || true
  echo "::error::app can STILL create tables — hardening INEFFECTIVE" >&2
  exit 1
fi
echo "OK: app can read/write rows but cannot alter schema. Hardening verified."
