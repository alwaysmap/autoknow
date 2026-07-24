#!/usr/bin/env bash
# PreToolUse(Bash) hook: when an agent tries to `gh pr merge` from this repo, run
# the same gate CI runs (scripts/ci/lint-compound.sh) and DENY the merge if the
# branch has no valid `compound:` declaration.
#
# CI is the real gate — it binds humans, the GitHub web UI, and any agent that
# never loads a hook. This is only fast local feedback, so the failure is caught
# in a second rather than five minutes into a CI run. It lives in the repo's
# .claude/settings.json (not a user-level dotfile) so every clone gets it; the
# readability-review gate that inspired it protects exactly one machine.
#
# FAIL-OPEN by construction. Every ambiguity — no jq, not this repo, unresolvable
# base, unreadable input — exits 0. A hook that blocks every Bash call in every
# clone when something unexpected happens is far worse than a missed prompt, and
# CI still catches what this lets through.
set -uo pipefail

input="$(cat 2>/dev/null)" || exit 0
[ -n "$input" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
# `gh … pr merge` at a command-segment boundary, so `echo "gh pr merge"` and
# `gh pr merge-queue-status` do not trip it.
printf '%s' "$cmd" | grep -qE '(^|[;&|])[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$|[;&|])' || exit 0

cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
[ -n "$cwd" ] && cd "$cwd" 2>/dev/null
gate="$(git rev-parse --show-toplevel 2>/dev/null)/scripts/ci/lint-compound.sh"
[ -x "$gate" ] || exit 0

base="${BASE_REF:-origin/main}"
git rev-parse --verify -q "$base" >/dev/null 2>&1 || exit 0

output="$(BASE_REF="$base" "$gate" 2>&1)" && exit 0

cat >&2 <<EOF
BLOCKED: this branch has no valid \`compound:\` declaration, so CI would reject
the merge anyway.

$output

Run the \`compound\` skill, commit any record onto THIS branch, and add the
declaration line to a commit message. Then push (CI goes green a second time —
records are gated like code) and re-run the merge.
EOF
exit 2
