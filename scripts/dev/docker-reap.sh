#!/usr/bin/env bash
# Reclaim per-worktree Docker resources whose worktree is gone (npm run docker:reap).
#
# The container sibling of `db:test:clean`. That script reclaims the per-worktree
# DATABASES inside Postgres; this one reclaims the per-worktree Postgres CONTAINERS,
# VOLUMES and NETWORKS around it — and nothing else did, so they accumulate forever.
# Measured on one laptop before this existed: 13 compose projects, 9 of them belonging to
# worktrees deleted up to two weeks earlier, 3.9GB of volumes, 18 bridge networks.
#
# WHY THEY EXIST AT ALL: docker-compose.yml declares no `name:`, so Compose derives the
# project name from the working DIRECTORY — which is unique per worktree. Every worktree
# that runs `npm run db:up` therefore gets its own container, volume and network. (They
# all publish 5432, so only one can ever actually run; the rest sit Created/Exited holding
# a volume. Isolation between worktrees comes from the per-worktree DATABASE NAMES, not
# from the containers — see tests/helpers/worktree and scripts/dev/demo.ts.)
#
# THREE DESIGN CHOICES, each the reason a simpler version does not work:
#
# 1. LEVEL-TRIGGERED, not edge-triggered. Nothing here runs "when a session ends". The
#    desired state is "a compose project exists iff its worktree exists", and this
#    reconciles toward it, from anywhere, as often as you like. A shutdown hook is
#    edge-triggered and leaks on every path that skips it — SIGKILL, laptop sleep, Docker
#    Desktop restart, `git worktree remove` typed by hand, a session archived from another
#    machine. Those paths are the majority: the 9 orphans above all had "clean" sessions.
#
# 2. REMOVES BY LABEL, never `docker compose down`. `down -v` needs the compose file, and
#    the compose file was inside the worktree — the moment you need cleanup is the moment
#    that tool stops working. Docker's own `com.docker.compose.project` label outlives the
#    directory, so it is the only durable handle.
#
# 3. NEVER `docker volume prune` / `system prune`. Both skip volumes referenced by any
#    container INCLUDING STOPPED ONES, which is every volume here — that is why
#    `docker system df` reports 3.9GB of volumes and 0B reclaimable. They are also
#    unscoped and would eat unrelated projects on the same machine.
#
# SAFE BY DEFAULT: dry run unless --yes. Only projects this repo created; never a live
# worktree, never the main checkout, never a RUNNING container without --force, and
# nothing younger than --min-age-hours (so a sweep cannot race a worktree being set up).
#
#   npm run docker:reap            # dry run — print the plan
#   npm run docker:reap:apply      # remove
#   npm run clean:workspace        # this + db:test:clean, the whole local sweep
#
# Bash rather than ts-node on purpose: it has to run from launchd/cron and from a stale
# checkout, where node_modules may not exist. docker + git + coreutils, nothing else.
set -euo pipefail

APPLY=0
FORCE=0
MIN_AGE_HOURS=1

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)        APPLY=1 ;;
    --force)         FORCE=1 ;;
    --min-age-hours) MIN_AGE_HOURS="${2:?--min-age-hours needs a value}"; shift ;;
    -h|--help)       sed -n '2,45p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

# Absent Docker is not an error: this runs from a scheduled sweep that must stay quiet on
# a machine where the daemon is simply off.
command -v docker >/dev/null 2>&1 || { echo "docker not on PATH — nothing to do."; exit 0; }
docker info >/dev/null 2>&1        || { echo "docker daemon not running — nothing to do."; exit 0; }

# The repo is found from THIS SCRIPT'S OWN LOCATION, never from $PWD: launchd runs with
# cwd=/ , and a cwd-derived root would silently resolve to "no worktrees" and reap
# everything it could see.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN="$(cd "$(dirname "$(git -C "$HERE" rev-parse --git-common-dir)")" && pwd)"

# LIVE = every worktree git still knows about, by BASENAME — which is exactly what Compose
# uses as the default project name. Read from git rather than from the filesystem so a
# worktree whose directory is gone but whose registration lingers still counts as live
# until `git worktree prune` runs.
normalize() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]//g'; }
LIVE=" "
while IFS= read -r line; do
  case "$line" in worktree\ *)
    p="${line#worktree }"; LIVE="${LIVE}$(normalize "${p##*/}") " ;;
  esac
done < <(git -C "$MAIN" worktree list --porcelain)

echo "main checkout : $MAIN"
echo "live projects :${LIVE}"
echo

is_live() { case "$LIVE" in *" $(normalize "$1") "*) return 0 ;; esac; return 1; }

label_of() { docker "$1" inspect -f "{{index ${2} \"com.docker.compose.project\"}}" "$3" 2>/dev/null || true; }

# Candidates from ALL THREE resource types, because they die at different times: this
# machine had 13 networks whose container was already gone, and a container-only sweep
# leaves every one of them behind.
candidates="$( {
  for c in $(docker ps -aq); do label_of container '.Config.Labels' "$c"; done
  for v in $(docker volume  ls -q --filter label=com.docker.compose.project); do label_of volume  '.Labels' "$v"; done
  for n in $(docker network ls -q --filter label=com.docker.compose.project); do label_of network '.Labels' "$n"; done
} | sed '/^$/d' | sort -u )"

# OURS? Two independent signals, either sufficient, both conservative — an unrecognized
# project is always left alone.
#   (a) a container of the project carries a working_dir inside this repo's tree; or
#   (b) the project owns this repo's compose signature, a `<project>_pgdata` volume.
# (a) is authoritative while the container lives; (b) still identifies a project whose
# container has already been removed. A project matching NEITHER is somebody else's.
is_ours() {
  local proj="$1" wd
  for c in $(docker ps -aq --filter "label=com.docker.compose.project=$proj"); do
    wd="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null || true)"
    case "$wd" in "$MAIN"|"$MAIN"/*) return 0 ;; esac
  done
  docker volume inspect "${proj}_pgdata" >/dev/null 2>&1
}

now=$(date +%s)
# BSD date (macOS) first, GNU date second — this runs on both.
epoch_of() {
  local s="${1:0:19}"
  date -j -f '%Y-%m-%dT%H:%M:%S' "$s" +%s 2>/dev/null || date -d "$s" +%s 2>/dev/null || echo 0
}

reap=""
for proj in $candidates; do
  if ! is_ours "$proj";  then printf 'skip   %-42s not this repo\n'     "$proj"; continue; fi
  if   is_live "$proj";  then printf 'keep   %-42s worktree present\n'  "$proj"; continue; fi

  running="$(docker ps -q --filter "label=com.docker.compose.project=$proj" | grep -c . || true)"
  if [ "$running" -gt 0 ] && [ "$FORCE" != "1" ]; then
    printf 'SKIP   %-42s worktree gone but %s running (use --force)\n' "$proj" "$running"
    continue
  fi

  # Grace period, judged on the NEWEST container: a worktree being provisioned right now
  # must survive a sweep that races it.
  newest=0
  for c in $(docker ps -aq --filter "label=com.docker.compose.project=$proj"); do
    t=$(epoch_of "$(docker inspect -f '{{.Created}}' "$c" 2>/dev/null || echo '')")
    [ "$t" -gt "$newest" ] && newest=$t
  done
  if [ "$newest" -gt 0 ] && [ $(( (now - newest) / 3600 )) -lt "$MIN_AGE_HOURS" ]; then
    printf 'SKIP   %-42s younger than %sh\n' "$proj" "$MIN_AGE_HOURS"; continue
  fi

  printf 'REAP   %-42s worktree gone\n' "$proj"
  reap="$reap $proj"
done

# A compose network with NO containers at all and no live worktree is residue whichever
# project it came from: `docker compose up` recreates it on demand, and Docker's bridge
# address space is finite. Handled separately because such a network fails `is_ours`
# by construction — the container and volume that would have identified it are gone.
bare_networks=""
for n in $(docker network ls -q --filter label=com.docker.compose.project); do
  proj="$(label_of network '.Labels' "$n")"
  [ -n "$proj" ] || continue
  is_live "$proj" && continue
  [ -n "$(docker ps -aq --filter network="$n")" ] && continue
  case " $reap " in *" $proj "*) continue ;; esac   # already covered by its project
  bare_networks="$bare_networks $n"
  printf 'REAP   %-42s bare network, no containers\n' "$proj"
done

echo
if [ -z "${reap// /}" ] && [ -z "${bare_networks// /}" ]; then echo "nothing to reap."; exit 0; fi

if [ "$APPLY" != "1" ]; then
  echo "DRY RUN — nothing removed. Apply with: npm run docker:reap:apply"
  for proj in $reap; do
    printf '  %s\n' "$proj"
    printf '    containers %s\n' "$(docker ps -aq     --filter "label=com.docker.compose.project=$proj" | tr '\n' ' ')"
    printf '    volumes    %s\n' "$(docker volume ls  -q --filter "label=com.docker.compose.project=$proj" | tr '\n' ' ')"
    printf '    networks   %s\n' "$(docker network ls -q --filter "label=com.docker.compose.project=$proj" | tr '\n' ' ')"
  done
  [ -n "${bare_networks// /}" ] && printf '  bare networks %s\n' "$bare_networks"
  exit 0
fi

# Order matters: a volume or network still attached to a container refuses to go.
for proj in $reap; do
  echo "reaping $proj"
  ids="$(docker ps -aq     --filter "label=com.docker.compose.project=$proj")"; [ -n "$ids" ] && docker rm -f     $ids >/dev/null || true
  ids="$(docker volume ls  -q --filter "label=com.docker.compose.project=$proj")"; [ -n "$ids" ] && docker volume  rm $ids >/dev/null || true
  ids="$(docker network ls -q --filter "label=com.docker.compose.project=$proj")"; [ -n "$ids" ] && docker network rm $ids >/dev/null || true
done
for n in $bare_networks; do docker network rm "$n" >/dev/null 2>&1 || true; done
echo "done."
