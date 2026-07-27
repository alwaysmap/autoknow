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
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/ci/lib.sh

before_kb="$(disk_avail_kb)"
echo "DISK before reclaim: $(disk_gib "$before_kb") GiB free on / ($(disk_used_pct) used)"

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
