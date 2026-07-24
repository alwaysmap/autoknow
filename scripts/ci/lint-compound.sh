#!/usr/bin/env bash
# Require every substantive PR to declare, in a commit message, what it compounded
# — a record that ships in this diff, or an explicit "nothing, because…".
# Rationale, rejected alternatives and the three-place prose sweep this replaces:
# ADR compound-records-ride-the-pr-that-motivated-them. Modelled on
# lint-change-ordering.sh, whose `allow-mixed-infra:` opt-in has the same shape.
#
# The accepted grammar is stated once, in print_accepted_forms() below — that is
# the message contributors actually read when this fails.
#
# Usage: BASE_REF=origin/main scripts/ci/lint-compound.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/ci/lib.sh

base="$(resolve_base_ref)"
mapfile -t changed < <(git diff --name-only "$base"...HEAD)

# "Substantive" is app code, deliberately narrow: docs, CI, tests and skills are
# exempt. NOTE this is a different set from lint-change-ordering.sh's "app code"
# (which also counts Dockerfile, next.config.ts and the lockfiles) — that script
# asks "would this auto-deploy before its infra?", which is a different question
# from "could this have taught us something?". Widening the filter is a one-line
# change here; narrowing it to a decision-smelling heuristic was rejected in the
# ADR, because a heuristic that lets most PRs through reintroduces the skipping
# this gate exists to stop.
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

print_accepted_forms() {
  cat >&2 <<'EOF'
Put ONE of these lines in any commit message on this branch:

  compound: docs/adr/YYYY-MM-DD-slug.md     a record that SHIPS IN THIS DIFF —
                                            an ADR, a knowledge note, or AGENTS.md
  compound: docs/knowledge/a.md, AGENTS.md  several, comma- or space-separated
  compound: none — <why there is nothing worth recording>

The path form carries paths and nothing else: no trailing prose, no backticks,
no parentheses. Run the `compound` skill to make the call, then amend or add a
commit; do not merge around it.
EOF
}

mapfile -t lines < <(commit_message_lines "$base" compound)

if [ "${#lines[@]}" -eq 0 ]; then
  echo "::error::This PR changes src/** or prisma/** but no commit message carries a 'compound:' line. Records ride the PR that motivated them."
  printf '  substantive: %s\n' "${substantive[@]}"
  print_accepted_forms
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

  if printf '%s' "$value" | grep -qiE '^none([^[:alnum:]]|$)'; then
    # Strip `none` and a separator — em dash, en dash, hyphen, colon, or nothing
    # but space. sed matches these bytewise, so the multi-byte dashes are covered
    # byte by byte rather than as characters.
    reason="$(printf '%s' "$value" | sed -E 's/^[Nn][Oo][Nn][Ee]//; s/^[[:space:]]*[—–:-]*[[:space:]]*//')"
    # At least one alphanumeric: `none.` and `none —` are keystrokes, not reasons.
    if printf '%s' "$reason" | grep -q '[[:alnum:]]'; then
      echo "compound: declared none — ${reason}"
    else
      echo "::error::'compound: none' must say WHY there is nothing to record — a bare 'none' is a keystroke, not a judgement."
      failed=1
    fi
    continue
  fi

  # Otherwise every token is a path, and every path must be in the diff.
  # `read -ra` rather than an unquoted expansion: word-splitting alone would also
  # GLOB, so `compound: src/*` would expand against the worktree into paths that
  # are in the diff by construction — the exact rubber stamp this check prevents.
  IFS=', ' read -ra paths <<<"$value"
  for path in "${paths[@]}"; do
    [ -n "$path" ] || continue
    if printf '%s\n' "${changed[@]}" | grep -qxF -- "$path"; then
      echo "compound: ${path} — present in this diff."
    else
      echo "::error::'compound: ${path}' names a file that is NOT in this PR's diff. Ship the record with the change, or declare 'none — <reason>'."
      failed=1
    fi
  done
done

if [ "$failed" -ne 0 ]; then
  print_accepted_forms
  echo "compound: FAILED — declaration present but invalid." >&2
  exit 1
fi

echo "compound: OK."
