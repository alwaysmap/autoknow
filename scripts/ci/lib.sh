#!/usr/bin/env bash
# Shared helpers for CI/DB scripts. Source this; don't execute it.
set -euo pipefail

CSP_VERSION="${CSP_VERSION:-v2.15.2}"

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

# db_password <project> — the app password, read from the database-url secret.
db_password() {
  gcloud secrets versions access latest --secret=database-url --project "$1" \
    | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#'
}
