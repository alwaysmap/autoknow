#!/usr/bin/env bash
# Run a command while watching free disk, and if the disk is about to run out, STOP the
# command and fail with a message that says "disk".
#
# WHY A WATCHDOG AND NOT A `df` STEP EITHER SIDE. When the runner itself hits ENOSPC the
# worker process dies mid-step, and nothing after it runs — not the next step, not an
# `if: always()` step, not a post-job hook. So a before/after pair can only ever report
# the "before", and the last thing in the log is a red browser-test step. That is why an
# out-of-disk run reads as a webkit flake and gets re-run instead of diagnosed. The only
# way to turn it into an honest, named failure is to notice the disk draining WHILE the
# command runs and fail first, with room left to write the message.
#
# It also reports the low-water mark on every run, pass or fail — the number that says
# whether the headroom is comfortable or one bad run away from this happening again.
#
# Incident: bead autoknow-by9 — runs 30239195026 and 30288543059, both the webkit leg of
# the e2e job, both 2026-07-27.
#
# Usage:
#   scripts/ci/disk-guard.sh <command> [args...]
# Env (the defaults are for direct invocation; ci.yml sets its own, from measurement —
# see docs/knowledge/an-out-of-disk-runner-fails-as-the-test-it-was-running.md):
#   CI_DISK_FLOOR_MB  fail below this much free space (default 1024)
#   CI_DISK_WARN_MB   warn if the run ever dips below this (default 2× floor)
#   CI_DISK_POLL_S    seconds between samples (default 5)
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/ci/lib.sh

: "${1:?usage: disk-guard.sh <command> [args...]}"

floor_mb="${CI_DISK_FLOOR_MB:-1024}"
warn_mb="${CI_DISK_WARN_MB:-$((floor_mb * 2))}"
floor_kb=$((floor_mb * 1024))
warn_kb=$((warn_mb * 1024))
poll_s="${CI_DISK_POLL_S:-5}"

state="$(mktemp -d)"
# `$BASHPID` != `$$` inside the backgrounded watchdog, which inherits this EXIT trap.
# Without the guard the watchdog deletes the low-water mark and the tripped flag on its way
# out, and the parent reports on a state directory that is no longer there.
trap 'if [ "$BASHPID" = "$$" ]; then rm -rf "$state"; fi' EXIT
# The watchdog is a separate PROCESS, so these two files are how its findings reach the
# reporting below — a shell variable set in a background job is invisible to its parent.
low_file="$state/low"
tripped_file="$state/tripped"
disk_avail_kb >"$low_file"

# TERM, then KILL: a shell waiting on a foreground child (which is exactly what `npm run`
# is) does not act on TERM until that child returns, and a suite that keeps running keeps
# writing to the disk we are trying to stop filling.
stop_command() {
  local pid="$1"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -KILL "$pid" 2>/dev/null || true
}

# Sample until the command exits: record the low-water mark, and on crossing the floor stop
# the command and say where the space went.
watch_disk() {
  local pid="$1" avail
  while kill -0 "$pid" 2>/dev/null; do
    avail="$(disk_avail_kb)"
    # An `if`, not `[ … ] && echo …`: the `&&` form returns non-zero whenever the test is
    # false — the common case here — and as the last command in a loop body that ends the
    # whole watchdog under `set -e`, leaving a job that looks guarded and is not (AGENTS
    # lesson 2). Found by testing this, not by reading it.
    if [ "$avail" -lt "$(cat "$low_file")" ]; then
      echo "$avail" >"$low_file"
    fi
    if [ "$avail" -lt "$floor_kb" ]; then
      touch "$tripped_file"
      echo "::error::OUT OF DISK at $(disk_gib "$avail") GiB free — stopping the command." >&2
      # Stop the writer FIRST, diagnose second: the deep scan walks the filesystem, and
      # running it before the kill leaves the suite writing for that whole window — which
      # is how the first draft of this let a 60s command run to completion after the floor
      # was crossed.
      stop_command "$pid"
      scripts/ci/disk-report.sh --deep "at the moment the floor was crossed" || true
      return 0
    fi
    sleep "$poll_s"
  done
}

"$@" &
cmd_pid=$!
watch_disk "$cmd_pid" &
watchdog_pid=$!

status=0
wait "$cmd_pid" || status=$?

if [ -e "$tripped_file" ]; then
  # The watchdog is mid-diagnosis — it kills the command BEFORE it reports, so the report
  # outlives the command it was reporting on. Let it finish; TERMing it here is how the
  # first draft of this threw away the only forensic record of the fill.
  wait "$watchdog_pid" 2>/dev/null || true
else
  kill -TERM "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
fi

# Only now is the low-water mark final — the watchdog wrote to it until it was reaped.
low_kb="$(cat "$low_file")"
echo "DISK low-water while running '$*': $(disk_gib "$low_kb") GiB free (floor $(disk_gib "$floor_kb") GiB)"

if [ -e "$tripped_file" ]; then
  echo "::error title=CI runner is out of disk::The runner filled up while running '$*'. This is a DISK failure, not a test failure: nothing asserted anything, and a re-run will hit the same ceiling. See the consumer breakdown above; bead autoknow-by9." >&2
  exit 1
fi

# Passed, but close enough that the next occurrence is a coin flip. Say so while it is
# still a warning rather than a red check nobody can attribute.
if [ "$low_kb" -lt "$warn_kb" ]; then
  echo "::warning title=CI disk headroom is thin::Only $(disk_gib "$low_kb") GiB free at the low-water mark (warn below $(disk_gib "$warn_kb") GiB). This job is close to the out-of-disk failure in bead autoknow-by9."
fi

exit "$status"
