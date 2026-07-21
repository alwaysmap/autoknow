#!/usr/bin/env sh
# Give a fresh git worktree the .env it can never inherit.
#
# .env is gitignored on purpose — it holds AUTH_SECRET, GEMINI_API_KEY, ADMIN_TOKEN
# and the Google credentials — so `git worktree add` cannot bring it. Nothing
# downstream says it is missing, either: dotenv.config() no-ops on an absent file,
# and BOTH harnesses invent `postgresql://postgres:postgres@localhost:5432/autoknow`
# when DATABASE_URL is unset (tests/helpers/testDatabaseUrl.ts, scripts/dev/demo.ts).
# So a fresh worktree HALF-works: e2e and `npm run demo` run green against a database
# nobody chose, while db:migrate, Google auth and Gemini fail with errors that look
# unrelated to each other and to the actual cause. One missing file, five bugs.
#
# The cure runs from the one step a fresh worktree already cannot skip: `npm ci`,
# via postinstall. A SYMLINK, not a copy — one real file, so rotating a secret
# reaches every worktree at once and no checkout can silently drift (the drift
# between .env.sample and the real .env is what that failure mode looks like).
#
# HARD CONSTRAINT: `npm ci` also runs in CI and in the Dockerfile's deps stage,
# which copies only package*.json — this file is not even present there. It must
# never fail an install and must stay silent outside a linked worktree. Hence the
# `|| true` on the postinstall entry, and an unconditional exit 0 on every path here.

# Not a git repo at all (the Docker build context has no .git) — nothing to do.
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
this=$(git rev-parse --path-format=absolute --git-dir 2>/dev/null) || exit 0

# A LINKED worktree is exactly the case where its .git differs from the shared one.
# The main checkout and every CI runner compare equal here and stop.
if [ "$common" = "$this" ]; then
  exit 0
fi

# Never clobber: an existing link, copy, or hand-written file wins.
if [ -e .env ]; then
  exit 0
fi

main=$(dirname "$common")
if [ -f "$main/.env" ]; then
  if ln -s "$main/.env" .env 2>/dev/null; then
    echo "worktree bootstrap: linked .env -> $main/.env"
  fi
  exit 0
fi

echo "worktree bootstrap: no .env here, and none at $main/.env"
echo "  cp .env.sample .env and fill it in — otherwise db:migrate, auth and Gemini"
echo "  fail separately while tests and demo quietly use a localhost database."
exit 0
