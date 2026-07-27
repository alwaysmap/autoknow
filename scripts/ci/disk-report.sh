#!/usr/bin/env bash
# Print how much disk the runner has left at a labelled point in the job, and what is
# using it.
#
# A job that never states its free disk cannot tell you it ran out of it. The incident and
# the design argument are in disk-guard.sh, the other half of this; what is local here is
# that the evidence has to be printed IN-LINE, because the two failing job logs had already
# expired from the Actions API (HTTP 404 BlobNotFound) by the time anyone went looking.
#
# Usage:
#   scripts/ci/disk-report.sh <label>            # df + the usual consumers
#   scripts/ci/disk-report.sh --deep <label>     # + a whole-filesystem scan, tens of
#                                                #   seconds, hard-capped at 90
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/ci/lib.sh

# The deep scan runs at the worst possible moment — disk nearly full, job already over
# budget — so bound it where the tool exists. Not an array of optional flags: expanding an
# EMPTY array under `set -u` is fatal on older bash, and killing this script is precisely
# the wrong behaviour for the tool someone reaches for to understand a CI failure.
capped() { if command -v timeout >/dev/null 2>&1; then timeout 90 "$@"; else "$@"; fi; }

deep=0
if [ "${1:-}" = "--deep" ]; then
  deep=1
  shift
fi
label="${1:?usage: disk-report.sh [--deep] <label>}"

avail_kb="$(disk_avail_kb)"

# ESCALATE TO --deep AUTOMATICALLY under CI_DISK_WARN_MB, the same knob the guard warns on.
# The targeted list below has been observed reading byte-for-byte normal on a run that had
# nonetheless lost ~6 GiB, so a shallow report can announce a drain without attributing it;
# only the deep scan can name the writer, and a healthy run never crosses the line to
# pay for it. Measurement: docs/knowledge/an-out-of-disk-runner-fails-as-the-test-it-was-running.md
if [ "$deep" -eq 0 ] && [ -n "${CI_DISK_WARN_MB:-}" ] && [ "$avail_kb" -lt $((CI_DISK_WARN_MB * 1024)) ]; then
  deep=1
  echo "DISK: below the ${CI_DISK_WARN_MB}MB warn line — escalating this report to a deep scan."
fi

echo "DISK ${label}: $(disk_gib "$avail_kb") GiB free on / ($(disk_used_pct) used)"
df -Ph / | sed 's/^/  /'

# The paths this job is known to grow, plus the ones that would explain a fill nobody
# budgeted for: docker (the postgres service image), the apt archive that
# `playwright install --with-deps` fills, /tmp, and the crash dumps. A browser dumping core
# repeatedly is the one mechanism that can fill a disk inside a job this short, and it
# would land on the webkit leg — the leg that failed.
echo "  consumers:"
for path in \
  node_modules \
  .next-test \
  test-results \
  playwright-report \
  "$HOME/.cache/ms-playwright" \
  /var/lib/docker \
  /var/cache/apt \
  /var/crash \
  /var/lib/apport/coredump \
  /tmp; do
  [ -e "$path" ] || continue
  # -x: never walk off the filesystem being reported. `sudo -n` FIRST because the
  # interesting paths here are root-owned on the runner: an unprivileged `du` on those does
  # not fail, it succeeds with a WRONG, partial total. `head -1` keeps that to one answer.
  size="$({ sudo -n du -shx "$path" 2>/dev/null || du -shx "$path" 2>/dev/null; } | head -1 || true)"
  if [ -n "$size" ]; then
    echo "    $size"
  fi
done

if [ "$deep" -eq 1 ]; then
  # This half is aimed at the Linux runner, and only the core-dump pattern actually
  # degrades off it (to `n/a` — there is no /proc). The scan below still runs on a
  # developer's machine, just unprivileged, and without a stock `timeout` it runs uncapped.
  echo "  core dump pattern: $(cat /proc/sys/kernel/core_pattern 2>/dev/null || echo 'n/a') (ulimit -c: $(ulimit -c))"
  echo "  largest directories on /:"
  # `-d 2` limits what is PRINTED, not what is walked, so this is a full traversal.
  # `|| true` inside the group, not outside: `du` exits non-zero on any unreadable
  # directory, and under `set -e -o pipefail` that would abort the whole report — silently,
  # at the one moment its output is the only evidence anyone will get.
  scan="$({ capped sudo -n du -xh -d 2 / 2>/dev/null || capped du -xh -d 2 / 2>/dev/null || true; } | sort -h | tail -25 | sed 's/^/    /')"
  # Say so rather than printing a blank heading: an empty scan means "/ could not be read",
  # not "nothing is on the disk", and the difference matters when this is the only forensic
  # record of a fill.
  echo "${scan:-    (empty — / was not readable; expected only off the CI runner)}"
fi
