#!/usr/bin/env bash
# Fail a PR that changes BOTH infra (infra/terraform/**) and app code. The deploy
# ordering rule (playbook recipes B/C) is: infra merges + human `terraform apply`
# BEFORE the app PR that needs it (additions), app PR before infra PR (removals).
# A combined PR auto-deploys the app before anyone has applied the infra — the
# rollout fails on a missing secret/resource and the change lands half-done.
#
# Opt-in for a genuinely-safe mixed PR (e.g. an infra comment fix riding along):
# include a line `allow-mixed-infra: <reason>` in any commit message in the range.
#
# Usage: BASE_REF=origin/main scripts/ci/lint-change-ordering.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

base="${BASE_REF:-origin/main}"
mapfile -t changed < <(git diff --name-only "$base"...HEAD 2>/dev/null || true)

infra=(); app=()
for f in "${changed[@]}"; do
  case "$f" in
    infra/terraform/*) infra+=("$f");;
    src/*|prisma/*|package.json|package-lock.json|Dockerfile|next.config.ts) app+=("$f");;
  esac
done

if [ "${#infra[@]}" -eq 0 ] || [ "${#app[@]}" -eq 0 ]; then
  echo "change-ordering: no mixed infra+app change. OK."
  exit 0
fi

if git log --format=%B "$base"...HEAD | grep -iEq '^[[:space:]]*allow-mixed-infra:'; then
  echo "change-ordering: mixed infra+app change, but 'allow-mixed-infra:' opt-in present in a commit message. OK."
  exit 0
fi

echo "::error::This PR changes infra/terraform/** AND app code. Split it: infra PR + human apply FIRST for additions; app PR first for removals (docs/CHANGE_PLAYBOOK.md)."
printf '  infra: %s\n' "${infra[@]}"
printf '  app:   %s\n' "${app[@]}"
echo "change-ordering: FAILED. Opt-in (only if genuinely safe): add 'allow-mixed-infra: <reason>' to a commit message." >&2
exit 1
