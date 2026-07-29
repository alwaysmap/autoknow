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
#
# WHY /usr/local/lib/android IS NOT IN THIS LIST. Measured per path, run 30419570545:
#
#   /usr/local/lib/android   10.3 GiB   44s (chromium) / 20s (webkit)   <- was the whole cost
#   /usr/share/dotnet         5.1 GiB    7s / 4s
#   /usr/local/.ghcup         3.7 GiB    2s / 1s
#   /usr/share/swift          3.3 GiB    1s / 0s
#   /opt/az                   0.6 GiB    3s / 5s
#   /opt/microsoft            0.8 GiB    0s / 0s
#   /home/linuxbrew           0.2 GiB    2s / 1s
#
# The deletes run in PARALLEL, so the step costs max(path), not the sum — and that max WAS
# the Android SDK. Dropping it takes the step from 51-71s to ~7-10s while still freeing
# 13.7 GiB, against the ~7 GiB the worse leg (webkit) actually consumes. Low-water lands
# near 18 GiB, ~9x the 2 GiB floor.
#
# Re-measure before adding anything back: CI_DISK_RECLAIM_MEASURE=1 serialises the deletes
# and prints this table again. Serialised, because in parallel each reading is the sum of
# whatever else was mid-flight. Size comes from the filesystem either side of each delete
# rather than a `du`, which would cost more than the delete it was sizing.
reclaim_one() {
  local path="$1" t0 freed
  t0="$(date +%s)"
  before_one="$(disk_avail_kb)"
  sudo rm -rf "$path"
  freed=$(( $(disk_avail_kb) - before_one ))
  echo "  reclaimed $(disk_gib "$freed") GiB in $(( $(date +%s) - t0 ))s — $path"
}

# Serialised ONLY while the per-path numbers are being gathered: in parallel the deletes
# interleave and every measurement reads as the sum of whatever else was running. This is
# the measurement build; the list gets trimmed from it and the `&` comes back.
if [ "${CI_DISK_RECLAIM_MEASURE:-}" = "1" ]; then
  for path in \
    /usr/share/dotnet \
    /usr/share/swift \
    /opt/ghc \
    /usr/local/.ghcup \
    /opt/az \
    /opt/microsoft \
    /home/linuxbrew; do
    [ -e "$path" ] || continue
    reclaim_one "$path"
  done
else
  for path in \
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
fi

after_kb="$(disk_avail_kb)"
echo "DISK after reclaim: $(disk_gib "$after_kb") GiB free on / ($(disk_used_pct) used) — reclaimed $(disk_gib "$((after_kb - before_kb))") GiB"
