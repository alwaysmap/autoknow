#!/usr/bin/env bash
# Delete preinstalled toolchains the e2e job cannot use, to buy it headroom.
#
# WHY, AND WHY ONLY NOW. This was the first fix proposed for bead autoknow-by9 and it was
# REJECTED on the first measurements, which showed the e2e legs bottoming out around
# 11.9 GiB free — headroom nobody needed. Run 30304111252 overturned that: the webkit leg's
# transient peak is ~10 GiB against the ~12 GiB it has after installs, and the space is held
# OPEN by the running suite rather than left on disk, so no amount of cleanup can find it.
# The numbers are in docs/knowledge/an-out-of-disk-runner-fails-as-the-test-it-was-running.md.
#
# This does not fix the writer, which is still unidentified. It stops a ~2 GiB margin from
# being the thing that decides whether a run is green.
#
# WHAT IS DELIBERATELY NOT TOUCHED:
#   /opt/hostedtoolcache  actions/setup-node resolves Node out of it; removing it breaks
#                         the job two steps later, and confusingly.
#   /var/lib/docker       the postgres service container lives there.
# Everything below is a language/cloud toolchain nothing in this repo builds against.
#
# IT IS CONDITIONAL, because it is not free: ~60-70s on the leg that IS the critical path
# (docs/knowledge/ci-wall-clock-is-one-job-find-it-before-optimizing.md). Buying headroom
# nobody needs is the same mistake as not having it, paid every run instead of once. So it
# reclaims only when the runner arrives short — see CI_DISK_RECLAIM_BELOW_MB below.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/ci/lib.sh

before_kb="$(disk_avail_kb)"
echo "DISK before reclaim: $(disk_gib "$before_kb") GiB free on / ($(disk_used_pct) used)"

# SKIP WHEN THE RUNNER ALREADY HAS ROOM. The number to beat is what the rest of the job
# actually consumes, measured on run 30416379550: installs ~2.2 GiB, plus a transient peak
# of 3.9 GiB on webkit (36.0 GiB free after installs, 32.1 GiB at the guard's low-water)
# and 0.3 GiB on chromium. So ~6.1 GiB of demand on the worse leg, and a 12 GiB gate leaves
# roughly 6 GiB of margin on top of that — 3x the 2 GiB floor.
#
# Note the ~10 GiB transient peak this script's header cites from run 30304111252 is no
# longer what the suite does; 3.9 GiB is. Re-measure before trusting either number: the
# guard prints the low-water on every run, pass or fail, which is exactly the input this
# gate should be re-tuned from.
#
# Set CI_DISK_RECLAIM_BELOW_MB=999999 to force a reclaim, or 0 to disable it outright.
gate_mb="${CI_DISK_RECLAIM_BELOW_MB:-12288}"
if [ "$before_kb" -ge "$((gate_mb * 1024))" ]; then
  echo "DISK reclaim SKIPPED: $(disk_gib "$before_kb") GiB free is at or above the ${gate_mb}MB gate."
  echo "  (the guard on the test step reports the low-water mark; re-tune this gate from it)"
  exit 0
fi
echo "DISK reclaim RUNNING: below the ${gate_mb}MB gate."

# Removed in PARALLEL: this runs on the critical-path leg (docs/knowledge/ci-wall-clock-is-one-job-find-it-before-optimizing.md),
# and serially these cost more than the headroom is worth.
for path in \
  /usr/local/lib/android \
  /usr/share/dotnet \
  /usr/share/swift \
  /opt/ghc \
  /usr/local/.ghcup \
  /opt/az \
  /opt/microsoft \
  /home/linuxbrew; do
  [ -e "$path" ] || continue
  sudo rm -rf "$path" &
done
wait

after_kb="$(disk_avail_kb)"
echo "DISK after reclaim: $(disk_gib "$after_kb") GiB free on / ($(disk_used_pct) used) — reclaimed $(disk_gib "$((after_kb - before_kb))") GiB"
