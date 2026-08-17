#!/bin/bash
# Make a Claude Code on the web container able to do this repo's work.
#
# Two things are missing from a fresh remote container and BOTH are silent:
#   - bd and dolt. .claude/settings.json already registers `bd prime` as a
#     SessionStart hook, so without them every web session opens with a failed
#     hook and no issue tracker.
#   - node_modules. Without it `npm run lint` / `typecheck` / `test` cannot run.
#
# Local machines are left alone; this only runs in the remote container.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

BD_VERSION="v1.2.2"   # PINNED ON PURPOSE — see the note by the go install below

export PATH="$HOME/.local/bin:$HOME/go/bin:/usr/local/go/bin:$PATH"
mkdir -p "$HOME/.local/bin"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$HOME/go/bin:/usr/local/go/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

# --- dolt -------------------------------------------------------------------
# bd stores issues in Dolt and shells out to this binary to serve them.
# Upstream ships a prebuilt linux-amd64 tarball; use it rather than building,
# which turns ~3 minutes of cgo into ~20 seconds of download.
if ! command -v dolt >/dev/null 2>&1; then
  echo "session-start: installing dolt"
  curl -fsSL -o /tmp/dolt.tgz \
    https://github.com/dolthub/dolt/releases/latest/download/dolt-linux-amd64.tar.gz
  tar xzf /tmp/dolt.tgz -C /tmp
  install -m 0755 /tmp/dolt-linux-amd64/bin/dolt "$HOME/.local/bin/dolt"
  rm -rf /tmp/dolt.tgz /tmp/dolt-linux-amd64
fi

# --- bd ---------------------------------------------------------------------
# Beads publishes no release binaries, so this is a source build. bd links
# Dolt's ICU regex engine through cgo, which needs the ICU headers — without
# them the build dies on a missing unicode/uregex.h.
#
# The version is PINNED. bd v1.2.0/v1.2.1 were an accidental, untested release
# that migrates the shared database to schema v65 and drops the `events` table;
# the damage is invisible on reads and breaks every write. Anyone running an
# unpinned `@latest` that resolves to those re-breaks the database for the whole
# team. Raise this deliberately, never implicitly.
if ! command -v bd >/dev/null 2>&1; then
  echo "session-start: installing bd ${BD_VERSION}"
  if ! dpkg -s libicu-dev >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq libicu-dev
  fi
  go install "github.com/steveyegge/beads/cmd/bd@${BD_VERSION}"
fi

# Dolt refuses to commit without an identity, which is how bd persists a write.
if ! dolt config --global --list 2>/dev/null | grep -q '^user.email'; then
  dolt config --global --add user.email "$(git config user.email || echo agent@alwaysmap.com)" >/dev/null
  dolt config --global --add user.name  "$(git config user.name  || echo 'Claude Code')" >/dev/null
fi

# --- beads database ---------------------------------------------------------
# .beads/dolt is gitignored runtime state, so a fresh clone has issues.jsonl but
# no database. Hydrate it from refs/dolt/data. Non-fatal: a session that cannot
# reach the remote should still start, just without the tracker.
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
chmod 700 .beads 2>/dev/null || true
if [ -d .beads ] && [ ! -d .beads/dolt ] && [ ! -d .beads/embeddeddolt ]; then
  echo "session-start: hydrating beads from refs/dolt/data"
  bd bootstrap || echo "session-start: bd bootstrap failed; continuing without the tracker" >&2
fi

# --- app dependencies -------------------------------------------------------
# `install`, not `ci`: the container image is cached after this hook completes,
# so an incremental install is the one that benefits. postinstall links .env and
# generates the Prisma client (AGENTS lesson 16 — nothing in CI or Docker may
# depend on this hook having run).
if [ ! -d node_modules ]; then
  echo "session-start: npm install"
  npm install --no-audit --no-fund
fi

# --- postgres ---------------------------------------------------------------
# jest connects on import, so even a pure-text test fails without a database.
# The app needs pgvector, which the base image has no extension for, so this
# goes through docker compose (pgvector/pgvector:pg16) like `npm run db:up`.
# The remote container ships the docker client but no running daemon.
#
# Everything here is best-effort: a session that cannot get a database should
# still start, and say why, rather than refuse to open.
if ! docker info >/dev/null 2>&1; then
  echo "session-start: starting dockerd"
  nohup dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi

if docker info >/dev/null 2>&1; then
  npm run db:up || echo "session-start: db:up failed; tests needing postgres will not run" >&2
else
  echo "session-start: no docker daemon; tests needing postgres will not run" >&2
fi
