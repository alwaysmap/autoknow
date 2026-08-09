---
title: The preview browser tab is shared across worktrees and can move to another one's dev server mid-session
status: current
updated: 2026-08-09
applies_to:
  - .claude/launch.json
  - scripts/dev/demo.ts
symptoms:
  - a screenshot shows the OLD behaviour after the change is already applied and the tests are green
  - the page renders a feature you have not written yet, or is missing one you have
  - the tab's origin is a port you never started
verified_by: 'issue #153 visual verification, 2026-07-25 — the tab reported localhost:3675 for six screenshots, then silently reported localhost:3862 and rendered pre-change output (person emails, ISO dates) from a different worktree'
---

# The preview browser tab is shared across worktrees and can move to another one's dev server mid-session

**The lesson.** The Browser pane is not private to your worktree. Its tabs, and the
preview server registry behind them, are shared: `preview_start` will happily *reuse* a
server whose `cwd` is a different checkout, and an existing tab can end up pointed at a
port you never started. A screenshot taken then is a picture of somebody else's code,
and it looks exactly like "my change did not work".

**Why it bites.** Everything else in this repo is per-worktree by construction — the demo
DB, the demo port, the `*_test` DB, the e2e port are all derived from a sha1 of the
checkout path (`scripts/dev/demo.ts`, `tests/helpers/worktree`). The browser is the one
shared resource in that chain, so it is the one place the isolation stops, and it fails
silently: a stale tab renders a *plausible* page rather than an error. The failure is
worse than "no screenshot" because it produces confident evidence for the wrong
conclusion — here, a person column of raw emails and ISO dates in a session whose whole
job was to remove them.

**What to do.**
1. **Read the origin from inside the page, not from the tool's echo.** `navigate` reports
   the URL it was *asked* for; the tab context line reports where the tab actually is.
   Assert it in the page itself and keep it in the same call as the data you are
   collecting: `javascript_tool` → `JSON.stringify({origin: location.origin, …})`. A
   screenshot with no origin assertion beside it is unverified.
2. **Open your own tab** (`tabs_create`) rather than adopting whatever tab exists.
3. **Check `preview_list` before trusting `preview_start`.** Its response includes each
   server's `cwd`; `"reused": true` on a server whose `cwd` is not your worktree means
   you got someone else's app, not yours. Never `preview_stop` it — it belongs to a live
   session.
4. **An agent in an isolated worktree cannot use a named launch config at all.**
   `preview_start` resolves `.claude/launch.json` against the SESSION's root checkout,
   not the caller's cwd — writing your own launch.json in the isolated worktree changes
   nothing, and the tool boots the parent's server with the parent's config (gh-286
   part f verification, 2026-08-09: it launched `next dev -p 3793` from the root
   worktree while the agent's config said 3854). Run the dev server yourself (a
   backgrounded shell with the env inline) and `navigate` a fresh tab to that port.

**How we found out.** During #153 the tab was verified on the right port across several
screenshots, then moved to another worktree's demo server between one `javascript_tool`
call and the `screenshot` that followed it. The DOM read (taken before the move) said
"names, no links on unresolved" — correct; the screenshot (taken after) said
`clara@google.com` and `2026-07-10` — the code as it was before the branch. Only the
`localhost:3862` in the tool's tab-context footer gave it away.
