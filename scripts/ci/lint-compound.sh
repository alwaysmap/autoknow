#!/usr/bin/env bash
# Require every substantive PR to make the `compound` judgement EXPLICIT, in a
# commit message, before it can merge.
#
# `compound` used to fire at end of session — the wrong boundary. A session can
# end after its PR merged, or produce no PR at all, so the records it writes land
# as an orphan docs-only commit later, or never get written: the knowledge is
# furthest from the change that motivated it exactly when it is cheapest to
# attach. The repo already holds the opposite rule for the neighbouring case
# (AGENTS lesson 10 — the PR that implements what a doc describes updates that
# doc's STATUS line); compound records are the same shape and got a different
# lifecycle by accident.
#
# A commit-message line is the carrier (not a PR-body field) because it needs no
# `gh` API call here, survives squash-merge, and matches the `allow-mixed-infra:`
# precedent in lint-change-ordering.sh, which this script is modelled on.
#
# Accepted forms — one of these in ANY commit message in the range:
#
#   compound: docs/adr/YYYY-MM-DD-slug.md
#   compound: none — pure refactor, no new knowledge
#
# A named path must actually appear in the diff, or the line is a rubber stamp.
# `none` must carry a reason, or it is a keystroke rather than a judgement.
#
# Usage: BASE_REF=origin/main scripts/ci/lint-compound.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

base="${BASE_REF:-origin/main}"
mapfile -t changed < <(git diff --name-only "$base"...HEAD 2>/dev/null || true)

# "Substantive" is app code, deliberately narrow. A docs/CI/skill-only PR has
# nothing to compound about that it is not already doing. Widening this filter is
# a one-line change here; narrowing it to a decision-smelling heuristic was
# rejected (see the ADR) because a heuristic that lets most PRs through
# reintroduces the skipping this gate exists to stop.
substantive=()
for f in "${changed[@]}"; do
  case "$f" in
    src/*|prisma/*) substantive+=("$f");;
  esac
done

if [ "${#substantive[@]}" -eq 0 ]; then
  echo "compound: no src/** or prisma/** change in this PR. OK."
  exit 0
fi

forms() {
  cat >&2 <<'EOF'
Put ONE of these lines in any commit message in this PR:

  compound: docs/adr/YYYY-MM-DD-slug.md     a record that SHIPS IN THIS DIFF —
                                            an ADR, a knowledge note, or AGENTS.md
  compound: none — <why there is nothing worth recording>

Run the `compound` skill to make the call. Amend or add a commit; do not merge
around it.
EOF
}

mapfile -t lines < <(git log --format=%B "$base"...HEAD | grep -iE '^[[:space:]]*compound:' || true)

if [ "${#lines[@]}" -eq 0 ]; then
  echo "::error::This PR changes src/** or prisma/** but no commit message carries a 'compound:' line. Records ride the PR that motivated them."
  printf '  substantive: %s\n' "${substantive[@]}" >&2
  forms
  echo "compound: FAILED — no declaration." >&2
  exit 1
fi

failed=0
for line in "${lines[@]}"; do
  value="${line#*:}"
  value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"

  if [ -z "$value" ]; then
    echo "::error::A 'compound:' line has no value."
    failed=1
    continue
  fi

  # `none` + a reason. The separator may be an em dash, en dash, hyphen or colon.
  if printf '%s' "$value" | grep -qiE '^none([^[:alnum:]]|$)'; then
    reason="$(printf '%s' "$value" | sed -E 's/^[Nn][Oo][Nn][Ee]//; s/^[[:space:]]*[—–:-]*[[:space:]]*//')"
    if [ -z "$reason" ]; then
      echo "::error::'compound: none' must say WHY there is nothing to record — a bare 'none' is a keystroke, not a judgement."
      failed=1
    else
      echo "compound: declared none — ${reason}"
    fi
    continue
  fi

  # Otherwise every token is a path, and every path must be in the diff.
  for path in $(printf '%s' "$value" | tr ',' ' '); do
    if printf '%s\n' "${changed[@]}" | grep -qxF -- "$path"; then
      echo "compound: ${path} — present in this diff."
    else
      echo "::error::'compound: ${path}' names a file that is NOT in this PR's diff. Ship the record with the change, or declare 'none — <reason>'."
      failed=1
    fi
  done
done

if [ "$failed" -ne 0 ]; then
  forms
  echo "compound: FAILED — declaration present but invalid." >&2
  exit 1
fi

echo "compound: OK."
