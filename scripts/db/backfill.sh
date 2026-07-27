#!/usr/bin/env bash
# Run ONE reviewed data backfill against an instance's Cloud SQL database — the prod
# invocation path for `npm run db:backfill:*`, driven by .github/workflows/db-backfill.yml.
#
# WHY THIS EXISTS: a backfill is deliberately NOT part of `migrate deploy`
# (docs/CHANGE_PLAYBOOK.md — it needs a report an operator reads), and the runtime image
# cannot run it either (.dockerignore drops scripts/, the standalone build has no ts-node
# and no src/ TypeScript). Without this, the only way to backfill prod was to pull a
# production password onto a laptop, which is exactly what the keyless WIF setup exists
# to prevent. No human holds a connection string at any point below.
#
# THE SHAPE, copied from the two paths that already work:
#   - scripts/ci/migrate.sh  — proxy + `db_password` + npm ci'd node_modules + ts-node
#   - scripts/db/harden.sh   — a manual, dispatch-only, confirmed write to prod
#
# WHAT IT IS NOT: a "run an npm script against prod" hatch. The set of runnable backfills
# is the allowlist below and nothing else — one arm per backfill, added in a reviewed PR.
#
# Env: INSTANCE_PROJECT, INSTANCE_SQL_CONNECTION, BACKFILL, CONFIRM.
#      Optional: DB_PROXY_PORT (default 5432), DB_NAME (default autoknow).
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/ci/lib.sh
. scripts/ci/lib.sh

PROJECT="${INSTANCE_PROJECT:?set INSTANCE_PROJECT}"
CONN="${INSTANCE_SQL_CONNECTION:?set INSTANCE_SQL_CONNECTION}"
BACKFILL="${BACKFILL:?set BACKFILL (the name after db:backfill: — see the allowlist)}"
CONFIRM="${CONFIRM-}"
PORT="${DB_PROXY_PORT:-5432}"
DB_NAME="${DB_NAME:-autoknow}"

# The DML-only role, not the `app` migration role. A backfill is SELECT + UPDATE, and
# least privilege is the entire point of the two-role split (scripts/db/harden-roles.sql):
# connected as app_runtime, a stray DDL statement in a script dies with "permission
# denied" instead of altering prod's schema. Nothing needs granting for a new backfill:
# `GRANT … ON ALL TABLES` is table-level, so a column added by a later migration is
# already writable, and `ALTER DEFAULT PRIVILEGES` covers tables added by one.
ROLE=app_runtime
ROLE_SECRET=runtime-database-url

# --- 1. Allowlist: which backfills may run here at all -------------------------------
#
# ONE LIST, and it is DATA so the error message cannot drift from it. The workflow's
# `choice` input mirrors these names, but that is only the dropdown; this is the
# enforcement, and it is what makes "add a backfill" a reviewed one-line diff here rather
# than a standing licence to run arbitrary code against production (AGENTS lesson 2 — the
# guard ships in software, not in the description).
#
# The list is a control against MISTAKES, not against people: dispatching this workflow
# needs repo write access, and a dispatch names its own ref, so anyone who can fire it
# could equally push a branch that widens the list. Run it from `main`.
# `name=npm-script` pairs, so the list stays the single source of both the allowlist and
# what each name RUNS. It carries two namespaces now: `db:backfill:*` writes, and
# `db:check:*` only SELECTs — a read-only question that has to be asked of production and
# has nowhere else to be asked from, for exactly the reasons in this file's header. The
# check rides the same three refusals as the writes rather than getting a laxer path of
# its own; the cost is typing the instance name to run a SELECT, which is not a cost.
ALLOWED=(
  "owner-person=db:backfill:owner-person"           # #127 E6 — Project.ownerName -> ownerPersonId
  "affiliation-email=db:backfill:affiliation-email" # #127 E8 — Person.email -> the PersonAffiliation period covering now
  "email-conflicts=db:check:email-conflicts"        # #127 E9 — READ-ONLY: can the unique-at-an-instant constraint be applied here?
)
NPM_SCRIPT=""
names=()
for entry in "${ALLOWED[@]}"; do
  names+=("${entry%%=*}")
  [ "${entry%%=*}" = "$BACKFILL" ] && NPM_SCRIPT="${entry#*=}"
done
if [ -z "$NPM_SCRIPT" ]; then
  echo "::error::'${BACKFILL}' is not an allowed backfill. Allowed: ${names[*]}." >&2
  echo "Add it to ALLOWED in scripts/db/backfill.sh (and to the workflow's options) to introduce one." >&2
  exit 1
fi

# --- 2. Typed confirmation -----------------------------------------------------------
#
# This job WRITES to production. Requiring the operator to type the instance name means a
# stray click on "Run workflow" — which otherwise runs with every input pre-filled —
# cannot reach the database.
INSTANCE="${CONN##*:}"
if [ "$CONFIRM" != "$INSTANCE" ]; then
  echo "::error::confirm must be exactly the Cloud SQL instance name '${INSTANCE}' (got '${CONFIRM}'). Nothing ran; no connection was opened." >&2
  exit 1
fi

# --- 3. Preflight the script exists BEFORE opening a connection ----------------------
#
# `npm run <missing>` fails anyway, but 40 lines later and after a proxy and a password
# fetch. The likeliest cause is worth naming: the PR that ships the backfill has not
# merged to the ref this workflow ran from.
if ! NPM_SCRIPT="$NPM_SCRIPT" node -e 'process.exit(require("./package.json").scripts[process.env.NPM_SCRIPT] ? 0 : 1)'; then
  echo "::error::Could not find a '${NPM_SCRIPT}' script in package.json on this ref (or package.json could not be read). Has the PR that ships it merged?" >&2
  exit 1
fi

echo "===================== TARGET ====================="
echo "  instance : ${CONN}"
echo "  database : ${DB_NAME}"
echo "  role     : ${ROLE} (DML-only; secret ${ROLE_SECRET})"
echo "  backfill : npm run ${NPM_SCRIPT}"
echo "=================================================="

# --- 4. Proxy + credentials ----------------------------------------------------------
#
# The temp file (the run's output, kept so the report can be echoed to the job summary)
# is created BEFORE the proxy but the trap is armed BEFORE either — a `start_proxy`
# failure under errexit would otherwise leave both the file and a backgrounded proxy.
OUT=""
trap 'stop_proxy; [ -z "$OUT" ] || rm -f "$OUT"' EXIT
OUT="$(mktemp)"
start_proxy "$CONN" "$PORT"

PW="$(db_password "$PROJECT" "$ROLE_SECRET")"
# A non-matching secret makes `db_password`'s sed echo its INPUT unchanged, so an empty
# or URL-shaped answer means the extraction failed — fail here rather than hand Postgres
# a whole connection string as a password and get a confusing auth error.
if [ -z "$PW" ] || [ "${PW#*://}" != "$PW" ]; then
  echo "::error::Could not extract a password from secret '${ROLE_SECRET}' in ${PROJECT}." >&2
  exit 1
fi
# Belt and braces: if anything downstream ever echoes the URL (an unredacted driver
# error, a `set -x` added while debugging), GitHub replaces the password with ***. Only
# under Actions — outside it, `::add-mask::` is not a directive, it is the secret on
# stdout.
if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$PW"; fi

export DATABASE_URL="postgresql://${ROLE}:${PW}@127.0.0.1:${PORT}/${DB_NAME}?schema=public"
PSQL_URL="postgresql://${ROLE}:${PW}@127.0.0.1:${PORT}/${DB_NAME}" # psql rejects Prisma's ?schema=

# --- 5. Prove WHERE and WHO we are, from the server ----------------------------------
#
# Asked of the database rather than inferred from the URL we just built: the connection
# is a proxy hop, and "which database did this actually write to" is the first question
# anyone reading a bad run will ask. A mismatch is a stop condition, not a warning.
identity="$(psql "$PSQL_URL" -v ON_ERROR_STOP=1 -tAc 'SELECT current_database() || chr(10) || current_user' | tr -d '[:blank:]')"
actual_db="$(printf '%s' "$identity" | sed -n 1p)"
actual_role="$(printf '%s' "$identity" | sed -n 2p)"
echo "-- connected as (reported by the server): database=${actual_db} role=${actual_role}"
if [ "$actual_db" != "$DB_NAME" ] || [ "$actual_role" != "$ROLE" ]; then
  echo "::error::Connected to '${actual_db}' as '${actual_role}', expected '${DB_NAME}' as '${ROLE}'. Refusing to write." >&2
  exit 1
fi

# --- 6. Run it -----------------------------------------------------------------------
#
# Leftovers (unmatched / ambiguous rows) are a REPORT, not a failure — the script exits 0
# and the numbers are the gate a human reads. Only a real error fails the job.
echo "===================== RUNNING npm run ${NPM_SCRIPT} ====================="
if npm run "$NPM_SCRIPT" 2>&1 | tee "$OUT"; then
  status=ok
else
  status=failed
fi

# The report also goes to the run's summary page, so the counts that gate the next step
# are visible without scrolling a build log.
#
# REDACTED ON THE WAY IN, because `::add-mask::` does not reach here. Masking scrubs the
# runner's LOG stream; the summary is uploaded as a file and GitHub documents no scrubbing
# of it — so an unredacted driver error quoting the connection string would land in the
# clear, on the one artifact that persists. The sed is the guarantee; the mask is only the
# belt to its braces. Bounded too: past 1 MiB GitHub drops the summary ENTIRELY, and a
# silently missing report is worse than a truncated one.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### backfill \`${BACKFILL}\` — ${status} (\`${actual_db}\` as \`${actual_role}\`)"
    echo
    # Four backticks: a report quoting a fenced block of its own would otherwise close
    # this one early. `|| true` because `head` closing the pipe SIGPIPEs sed, and under
    # `pipefail` that would fail the job over a formatting detail.
    echo '````'
    { sed -E 's#(postgresql://[^:]+:)[^@]+@#\1***@#g' "$OUT" || true; } | head -c 900000
    echo
    echo '````'
  } >>"$GITHUB_STEP_SUMMARY"
fi

if [ "$status" = failed ]; then
  echo "===================== IT FAILED — WHAT IT PROBABLY MEANS =====================" >&2
  if grep -qi 'permission denied' "$OUT"; then
    echo "  * 'permission denied' — ${ROLE} lacks a grant on something this touches." >&2
    echo "    STOP. Do NOT rerun as the 'app' role to get around it; re-verify the role" >&2
    echo "    model with the 'Harden DB role' workflow (MODE=diagnose) first." >&2
  fi
  # Specific signatures only. A blanket `P20..` also matches P2010 "raw query failed",
  # which is what a PERMISSION error arrives as — and printing both diagnoses for one
  # error is how a reader stops trusting either.
  if grep -qiE 'does not exist|P202[12]' "$OUT"; then
    echo "  * a column/table the script expects is missing — the migration that adds it" >&2
    echo "    has not reached this database. Check what prod is running (gcp-debug skill)" >&2
    echo "    and that deploy.yml's migrate job went green for that commit." >&2
  fi
  echo "  * a db:check:* arm exits non-zero because it FOUND SOMETHING, not because it" >&2
  echo "    broke. Read its report above: that is the answer you asked for." >&2
  echo "  Nothing partial was left behind by design: a check writes nothing at all, and a" >&2
  echo "  backfill is idempotent with a WHERE clause requiring the target to still be" >&2
  echo "  unset, so a re-run resumes safely." >&2
  echo "::error::npm run ${NPM_SCRIPT} failed against ${actual_db}." >&2
  exit 1
fi

echo "===================== NOW READ THE REPORT ABOVE ====================="
echo "  * unmatched / ambiguous > 0 — rows this backfill REFUSED to guess at. They are"
echo "    still unset and safe; fix the source data and run this again. Zero on both is"
echo "    the gate for retiring the old column's readers."
echo "  * skipped > 0 — rows a concurrent write claimed mid-run. Expected to be small or"
echo "    zero; a LARGE count means something else was writing, so re-run and compare."
echo "  * re-running is always safe: it only touches rows that are still unset."
