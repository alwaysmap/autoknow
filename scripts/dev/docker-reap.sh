#!/usr/bin/env bash
# Reclaim per-worktree Docker resources whose worktree is gone (npm run docker:reap).
#
#   npm run docker:reap         # dry run — print the plan and stop (default)
#   npm run docker:reap:apply   # remove
#   npm run clean:workspace     # this + db:test:clean, the whole local sweep
#
#   --yes, -y            actually remove; without it nothing is touched
#   --force              also reap a RUNNING container whose worktree is gone
#   --min-age-hours N    never reap a project younger than N hours (default 1)
#   --help, -h           print this header
#
# The container sibling of `db:test:clean`. That script reclaims the per-worktree
# DATABASES inside Postgres; this one reclaims the per-worktree Postgres CONTAINERS,
# VOLUMES and NETWORKS around them — and nothing else did, so they accumulate forever.
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
# PORTABILITY: bash rather than ts-node, because this runs from launchd/cron and from a
# stale checkout where node_modules may not exist — docker + git + coreutils, nothing
# else. It must also stay BASH 3.2 CLEAN: the LaunchAgent invokes /bin/bash, which on
# macOS is 3.2, so no associative arrays and no `[[ -v ]]`. Indexed arrays are fine.
set -euo pipefail

APPLY=0
FORCE=0
MIN_AGE_HOURS=1

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)        APPLY=1 ;;
    --force)         FORCE=1 ;;
    --min-age-hours) MIN_AGE_HOURS="${2:?--min-age-hours needs a value}"; shift ;;
    # Printed FROM the header, so it can never drift out of date. A hardcoded line range
    # is right until somebody adds a sentence above, and then silently truncates.
    -h|--help)       awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

# Absent Docker is not an error: this runs from a scheduled sweep that must stay quiet on
# a machine where the daemon is simply off.
command -v docker >/dev/null 2>&1 || { echo "docker not on PATH — nothing to do."; exit 0; }
docker info >/dev/null 2>&1        || { echo "docker daemon not running — nothing to do."; exit 0; }

readonly PROJECT_LABEL='com.docker.compose.project'
readonly WORKDIR_LABEL='com.docker.compose.project.working_dir'

# ---- helpers ----------------------------------------------------------------

# Grouped here rather than scattered, so the policy below reads top-to-bottom.

# the ids of one resource KIND belonging to one compose project, newline separated.
# `container` is `ps -aq` — EVERY container, stopped ones included, because a stopped
# container is exactly what pins a volume and is exactly what this script removes.
ids_of() { # ids_of <container|volume|network> <project>
  case "$1" in
    container) docker ps         -aq --filter "label=$PROJECT_LABEL=$2" ;;
    volume)    docker volume ls   -q --filter "label=$PROJECT_LABEL=$2" ;;
    network)   docker network ls  -q --filter "label=$PROJECT_LABEL=$2" ;;
  esac
}

# …and the RUNNING ones only, which is a different question and the one the --force guard
# asks. Kept as its own function rather than a fourth `ids_of` kind, because reading
# `ids_of container` as "running containers" is the mistake it exists to prevent: with
# `-aq` there, every project with any history at all looks busy and nothing is ever reaped.
running_ids_of() { docker ps -q --filter "label=$PROJECT_LABEL=$1"; }

# one label off one resource; defaults to the compose project name
label_of() { # label_of <container|volume|network> <id> [label]
  local key="${3:-$PROJECT_LABEL}"
  case "$1" in
    container) docker container inspect -f "{{index .Config.Labels \"$key\"}}" "$2" ;;
    volume)    docker volume    inspect -f "{{index .Labels \"$key\"}}"        "$2" ;;
    network)   docker network   inspect -f "{{index .Labels \"$key\"}}"        "$2" ;;
  esac 2>/dev/null || true
}

# a directory basename as Compose would name a project from it
compose_project_name() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]//g'; }

# newest container of a project, as a unix epoch; 0 when it has none
newest_container_epoch() { # newest_container_epoch <project>
  local newest=0 c t
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    # BSD date (macOS) first, GNU date second — this runs on both.
    t="$(docker container inspect -f '{{.Created}}' "$c" 2>/dev/null || echo '')"
    t="${t:0:19}"
    t="$(date -j -f '%Y-%m-%dT%H:%M:%S' "$t" +%s 2>/dev/null || date -d "$t" +%s 2>/dev/null || echo 0)"
    [ "$t" -gt "$newest" ] && newest="$t"
  done < <(ids_of container "$1")
  printf '%s' "$newest"
}

remove_project() { # remove_project <project> — containers first: a volume or network
  local proj="$1" kind id      # still attached to one refuses to go.
  for kind in container volume network; do
    while IFS= read -r id; do
      [ -n "$id" ] || continue
      case "$kind" in
        container) docker rm -f       "$id" ;;
        volume)    docker volume rm   "$id" ;;
        network)   docker network rm  "$id" ;;
      esac >/dev/null 2>&1 || true
    done < <(ids_of "$kind" "$proj")
  done
}

# ---- what is alive ----------------------------------------------------------

# The repo is found from THIS SCRIPT'S OWN LOCATION, never from $PWD: launchd runs with
# cwd=/ , and a cwd-derived root would silently resolve to "no worktrees" and reap
# everything it could see.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN="$(cd "$(dirname "$(git -C "$HERE" rev-parse --git-common-dir)")" && pwd)"

# LIVE = every worktree git still knows about, by BASENAME — exactly what Compose uses as
# the default project name. Read from git rather than the filesystem so a worktree whose
# directory is gone but whose registration lingers still counts as live until
# `git worktree prune` runs.
LIVE=()
while IFS= read -r line; do
  case "$line" in worktree\ *)
    p="${line#worktree }"; LIVE+=( "$(compose_project_name "${p##*/}")" ) ;;
  esac
done < <(git -C "$MAIN" worktree list --porcelain)

is_live() {
  local want n; want="$(compose_project_name "$1")"
  for n in "${LIVE[@]}"; do [ "$n" = "$want" ] && return 0; done
  return 1
}

# OURS? Two independent signals, either sufficient, both conservative — a project matching
# NEITHER is somebody else's and is always left alone.
has_container_under_our_root() { # (a) authoritative, while the container still exists
  local proj="$1" c wd
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    wd="$(label_of container "$c" "$WORKDIR_LABEL")"
    case "$wd" in "$MAIN"|"$MAIN"/*) return 0 ;; esac
  done < <(ids_of container "$proj")
  return 1
}
owns_our_pgdata_volume() { # (b) still identifies a project whose container is already gone
  docker volume inspect "${1}_pgdata" >/dev/null 2>&1
}
is_ours() { has_container_under_our_root "$1" || owns_our_pgdata_volume "$1"; }

# The one project name docker-compose.yml pins, if it pins one. Read from the file rather
# than written down here, so the two cannot disagree about which project is current — and
# read from THIS SCRIPT'S OWN checkout rather than the main one, because the script and
# the compose file it reasons about ship together: a branch that changes the pin changes
# this script's behaviour in the same commit, which is also what makes it testable before
# the branch merges. (`$MAIN` stays the source for the worktree list, which is repo-global
# and has no per-checkout answer.)
PINNED_PROJECT="$(sed -n 's/^name:[[:space:]]*//p' "$HERE/../../docker-compose.yml" 2>/dev/null | head -1 | tr -d '"'"'"' ')"

echo "main checkout : $MAIN"
echo "pinned project: ${PINNED_PROJECT:-<none — compose names projects per directory>}"
echo "live projects : ${LIVE[*]}"
echo

# ---- decide -----------------------------------------------------------------
# Verb column: lowercase = nothing to do, UPPERCASE = this one changed, or would have.

# Candidates from ALL THREE resource types, because they die at different times: this
# machine had 13 compose networks whose container was already gone, and a container-only
# sweep leaves every one of them behind.
candidates="$( {
  for c in $(docker ps -aq);                                                do label_of container "$c"; done
  for v in $(docker volume  ls -q --filter "label=$PROJECT_LABEL");         do label_of volume    "$v"; done
  for n in $(docker network ls -q --filter "label=$PROJECT_LABEL");         do label_of network   "$n"; done
} | sed '/^$/d' | sort -u )"

now="$(date +%s)"
reap=()
# Every project this pass decided to LEAVE ALONE. The bare-network pass below must honour
# those decisions too: a project spared for being live, busy or young keeps its network.
spared=()

for proj in $candidates; do
  if ! is_ours "$proj"; then printf 'skip   %-42s not this repo\n' "$proj"; spared+=( "$proj" ); continue; fi

  # LEGACY, once docker-compose.yml pins `name:`. Before the pin, Compose named the
  # project after each worktree's directory; after it there is exactly ONE project, and
  # any other project of ours is residue from that era — including one whose worktree is
  # still alive, because nothing will ever address it again. Without this clause those
  # would be kept forever by the worktree test below, which is the one thing the pin
  # cannot fix on its own.
  # `why` names the reason this project is reapable, so every later line about it — the
  # skip messages included — says the true thing rather than assuming the common case.
  why='worktree gone'
  if [ -n "$PINNED_PROJECT" ] && [ "$proj" != "$PINNED_PROJECT" ]; then
    why="legacy: predates the pinned \`name: $PINNED_PROJECT\`"
  elif is_live "$proj"; then
    printf 'keep   %-42s worktree present\n' "$proj"; spared+=( "$proj" ); continue
  fi

  running="$(running_ids_of "$proj" | grep -c . || true)"
  if [ "$running" -gt 0 ] && [ "$FORCE" != "1" ]; then
    printf 'SKIP   %-42s %s, but %s running (use --force)\n' "$proj" "$why" "$running"
    spared+=( "$proj" ); continue
  fi

  # Grace period: a worktree being provisioned right now must survive a sweep that races
  # it. Judged on the project's newest container.
  newest="$(newest_container_epoch "$proj")"
  if [ "$newest" -gt 0 ] && [ $(( (now - newest) / 3600 )) -lt "$MIN_AGE_HOURS" ]; then
    printf 'SKIP   %-42s younger than %sh\n' "$proj" "$MIN_AGE_HOURS"; spared+=( "$proj" ); continue
  fi

  printf 'REAP   %-42s %s\n' "$proj" "$why"
  reap+=( "$proj" )
done

# A compose network with NO containers at all and no live worktree is residue whichever
# project it came from: `docker compose up` recreates it on demand, and Docker's bridge
# address space is finite. Handled separately because such a network fails `is_ours` by
# construction — the container and volume that would have identified it are gone.
bare_networks=()
for n in $(docker network ls -q --filter "label=$PROJECT_LABEL"); do
  proj="$(label_of network "$n")"
  [ -n "$proj" ] || continue
  [ -n "$(docker ps -aq --filter network="$n")" ] && continue
  case " ${reap[*]-} "   in *" $proj "*) continue ;; esac  # already covered by its project
  case " ${spared[*]-} " in *" $proj "*) continue ;; esac  # its project was spared above
  bare_networks+=( "$n" )
  printf 'REAP   %-42s bare network %s, no containers\n' "$proj" "$n"
done

# ---- act --------------------------------------------------------------------

echo
if [ "${#reap[@]}" -eq 0 ] && [ "${#bare_networks[@]}" -eq 0 ]; then
  echo "Nothing to reap: every compose project has a worktree."
  exit 0
fi

if [ "$APPLY" != "1" ]; then
  echo "DRY RUN — nothing removed. Apply with: npm run docker:reap:apply"
  for proj in ${reap[*]-}; do
    printf '  %s\n' "$proj"
    for kind in container volume network; do
      printf '    %-10s %s\n' "$kind" "$(ids_of "$kind" "$proj" | tr '\n' ' ')"
    done
  done
  [ "${#bare_networks[@]}" -gt 0 ] && printf '  bare networks %s\n' "${bare_networks[*]}"
  exit 0
fi

for proj in ${reap[*]-}; do
  echo "reaping $proj"
  remove_project "$proj"
done
for n in ${bare_networks[*]-}; do docker network rm "$n" >/dev/null 2>&1 || true; done

echo "Done: reaped ${#reap[@]} project(s) and ${#bare_networks[@]} bare network(s)."
