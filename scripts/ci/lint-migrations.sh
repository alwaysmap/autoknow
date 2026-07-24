#!/usr/bin/env bash
# Fail if a NEW migration contains a data-destructive statement without an explicit,
# reviewed opt-in. This is a hard gate: wire it as a required status check so a
# corrupting migration cannot reach main (see docs/CHANGE_PLAYBOOK.md recipe D).
#
# Opt-in for a genuinely-intended destructive change (e.g. the contract step of an
# expand→contract): put a line
#     -- allow-destructive: <reason>
# in the migration.sql. That keeps the decision visible in the diff and in review.
#
# Usage:
#   scripts/ci/lint-migrations.sh [file ...]         # explicit files
#   BASE_REF=origin/main scripts/ci/lint-migrations.sh   # files added vs a base ref
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/ci/lib.sh

# Data-loss / rewrite statements. Adding a column, table, index, or a nullable/defaulted
# column is NOT here — those are safe and need no opt-in.
DESTRUCTIVE='DROP TABLE|DROP COLUMN|DROP SCHEMA|TRUNCATE|ALTER COLUMN [^;]*SET DATA TYPE|ALTER COLUMN [^;]*SET NOT NULL|DROP DATABASE'

files=("$@")
if [ "${#files[@]}" -eq 0 ]; then
  base="$(resolve_base_ref)"
  mapfile -t files < <(git diff --name-only --diff-filter=A "$base"...HEAD -- 'prisma/migrations/**/migration.sql')
fi

if [ "${#files[@]}" -eq 0 ]; then
  echo "migrations-lint: no new migration files to check."
  exit 0
fi

fail=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  # Strip comments so a hit is real SQL, but keep the raw file to look for the opt-in.
  if grep -iEq "$DESTRUCTIVE" <(sed 's/--.*$//' "$f"); then
    if grep -iEq '^[[:space:]]*--[[:space:]]*allow-destructive:' "$f"; then
      echo "migrations-lint: $f — destructive, but opt-in present. OK."
    else
      echo "::error file=$f::Destructive statement without an '-- allow-destructive: <reason>' opt-in."
      grep -inE "$DESTRUCTIVE" <(sed 's/--.*$//' "$f") | sed "s#^#  $f:#"
      fail=1
    fi
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "migrations-lint: FAILED. Destructive changes split expand→backfill→contract (docs/CHANGE_PLAYBOOK.md; db-change skill)." >&2
  exit 1
fi
echo "migrations-lint: passed."
