#!/usr/bin/env bash
# Shared helpers for CI/DB scripts. Source this; don't execute it.
set -euo pipefail

CSP_VERSION="${CSP_VERSION:-v2.15.2}"

# --- shared by the lint-*.sh PR gates ----------------------------------------

# Echo the diff base ($BASE_REF, default origin/main), or fail loudly.
#
# Every gate reads `git diff <base>...HEAD`. If the base does not resolve —
# `origin/${{ github.base_ref }}` becomes a bare `origin/` on any trigger other
# than `pull_request` — git errors, the file list comes back empty, and the gate
# PASSES with a reassuring "nothing to check". A gate that green-lights when its
# own input is missing is the failure mode these gates exist to prevent (AGENTS
# lesson 2), so resolve once, up front, and refuse otherwise.
resolve_base_ref() {
  local base="${BASE_REF:-origin/main}"
  if ! git rev-parse --verify -q "$base" >/dev/null 2>&1; then
    echo "::error::BASE_REF '$base' does not resolve — refusing to pass on an empty diff." >&2
    return 1
  fi
  printf '%s' "$base"
}

# Echo every commit-message line on THIS branch that opens with `<key>:` — the
# carrier for the gates' declarations (`allow-mixed-infra:`, `compound:`). A
# commit message is the carrier because it needs no `gh` API call, survives
# squash-merge, and stays visible in review.
#
# `$base..HEAD` — two dots. THREE would be the symmetric difference, which also
# scans everything merged to the base since this branch forked, so another PR's
# declaration would answer for this one. The mistake is easy precisely because
# `git diff <base>...HEAD` above IS correct (changes since the merge base): the
# two forms do not mean the same thing for `log` as they do for `diff`.
commit_message_lines() {
  local base="$1" key="$2"
  git log --format=%B "$base..HEAD" | grep -iE "^[[:space:]]*${key}:" || true
}

# --- shared by the e2e disk report and disk guard ----------------------------

# Free kibibytes on /, which is the only filesystem a GitHub runner has and the one that
# fills.
#
# `df -Pk` and not `df --output=avail`: the latter is GNU-only, and these scripts have to
# behave the same when a developer runs them on macOS to understand a CI failure. -P pins
# the one-line-per-filesystem POSIX format, so field 4 is Available on both.
disk_avail_kb() { df -Pk / | awk 'NR==2 {print $4}'; }

# Percent-used string ("70%") for the same filesystem.
disk_used_pct() { df -Pk / | awk 'NR==2 {print $5}'; }

# Kibibytes -> a GiB number, one decimal. Disk numbers are read by humans deciding whether
# a job has headroom; kibibytes are not.
disk_gib() { awk -v k="${1:-0}" 'BEGIN { printf "%.1f", k / 1048576 }'; }

# Detect platform for the Cloud SQL Auth Proxy download.
csp_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64 | amd64) arch=amd64 ;;
    arm64 | aarch64) arch=arm64 ;;
  esac
  echo "${os}.${arch}"
}

# Download the proxy to $1 (idempotent).
fetch_csp() {
  local dest="$1"
  [ -x "$dest" ] && return 0
  curl -fsSL "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/${CSP_VERSION}/cloud-sql-proxy.$(csp_platform)" -o "$dest"
  chmod +x "$dest"
}

# start_proxy <connection-name> <port> — starts the proxy, exports CSP_PID, waits for ready.
start_proxy() {
  local conn="$1" port="$2" bin="${TMPDIR:-/tmp}/cloud-sql-proxy"
  fetch_csp "$bin"
  "$bin" --port "$port" "$conn" &
  CSP_PID=$!
  for _ in $(seq 30); do
    if command -v pg_isready >/dev/null 2>&1; then
      pg_isready -h 127.0.0.1 -p "$port" -q && return 0
    else
      (echo > "/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1 && return 0
    fi
    sleep 1
  done
  echo "Cloud SQL proxy did not become ready on port $port" >&2
  return 1
}

stop_proxy() { [ -n "${CSP_PID:-}" ] && kill "$CSP_PID" 2>/dev/null || true; }

# db_password <project> [secret] — a database password, read out of a Secret Manager
# secret that holds a whole connection URL. Default `database-url` (the `app` migration
# role); pass `runtime-database-url` for the DML-only `app_runtime` role.
#
# Only the PASSWORD comes back, never the URL, because the stored URLs are in Cloud SQL
# SOCKET form (`…@localhost/autoknow?host=/cloudsql/…`) while every caller here reaches
# the database through the Auth Proxy on 127.0.0.1 — so each rebuilds its own URL.
db_password() {
  gcloud secrets versions access latest --secret="${2:-database-url}" --project "$1" \
    | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#'
}
