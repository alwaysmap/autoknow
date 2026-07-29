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
# It is NOT free — ~60-70s on the leg that IS the workflow's critical path
# (docs/knowledge/ci-wall-clock-is-one-job-find-it-before-optimizing.md) — and it runs
# anyway, for the measured reason below the shebang block.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/ci/lib.sh

before_kb="$(disk_avail_kb)"
echo "DISK before reclaim: $(disk_gib "$before_kb") GiB free on / ($(disk_used_pct) used)"

# THIS RUNS UNCONDITIONALLY, AND THAT IS THE MEASURED CHOICE — do not gate it again.
#
# It was gated once, on the reasoning that the suite's transient peak had fallen to 3.9 GiB
# (run 30416379550) against the 14.1 GiB a runner arrives with, so ~70s was buying headroom
# nobody needed. The gate skipped exactly as designed and the webkit leg went 348s -> 471s.
# Per step, run 30417428911 against 30416379550:
#
#   this step             71s -> 0s      saved, as intended
#   the suite itself     154s -> 204s    SLOWER, on a filesystem with 5.8 GiB left
#   "Disk at job end"     14s -> 197s    low disk crossed the warn line, so the report
#                                        escalated ITSELF to the full --deep scan
#   guard low-water     32.1 -> 5.8 GiB  and it warned, correctly
#
# So this is not only buying safety margin. It buys I/O speed for the suite, and it is what
# keeps every other disk probe on its cheap path. Skipping it cost ~120s net on the leg that
# IS the workflow's critical path. Free space is a resource the whole job spends, not a
# threshold it merely has to clear once.

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
