---
title: A fresh worktree has no .env, and the suite blames your diff for it
status: current
updated: 2026-07-26
applies_to:
  - any new git worktree (agent-created or `git worktree add` by hand)
  - running `npm test` for the first time in a worktree
  - judging whether a test failure is "pre-existing"
symptoms:
  - one test fails in the full suite but passes when run on its own
  - 'SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string'
  - an API route test gets 500 where it expects 200
  - a failure that "reproduces on main too" — and does not, on a bootstrapped tree
verified_by: 'tests/cronAuth.test.ts; scripts/dev/link-env.sh; package.json `postinstall`; two independent agent worktrees, one bootstrapped and one not'
---

# A fresh worktree has no `.env`, and the suite blames your diff for it

**The lesson.** `.env` is a **symlink created by `npm run postinstall`**, not a
tracked file, so it does not come along with a checkout. `git worktree add` gives
you the source tree and nothing else; the worktree resolves `node_modules` from
the parent repo, so everything *looks* installed and no step visibly fails. The
first `npm test` then runs with no `DATABASE_URL` password, and the handful of
tests that stand up an app-side pg pool fail with a SASL error while the other
~600 pass.

This is [lesson 16](../../AGENTS.md)'s hook seen from the other side. There, the
rule is that CI and Docker must not *depend* on the bootstrap. Here, the trap is
the mirror image: a **local** tree that never ran it is silently under-configured.

**Why it costs more than the five seconds it takes to fix.** The failure does not
look like configuration. It looks like a test failure in a file you did not touch,
which invites exactly the wrong conclusion — "unrelated, pre-existing, not mine" —
and that conclusion is unfalsifiable from inside the broken worktree: re-running
the file alone passes (no pool), and moving your own files out and re-running
still fails, which reads as proof of innocence. It is not. It is the same missing
symlink both times.

It happened twice in one session, in two worktrees, on the same test
(`tests/cronAuth.test.ts`), and the two agents reached opposite conclusions: one
called it pre-existing and shipped the claim in a commit message; the other
root-caused it in the same minute by noticing the tree had never been bootstrapped.
The difference was not diligence, it was whether they thought to check.

**The fix, before the first test run in any new worktree:**

```bash
npm run postinstall     # links .env, generates the Prisma client
ls -la .env             # must be a symlink, not "No such file"
```

**The rule.** A failure is only "pre-existing" once you have reproduced it on a
tree that is actually bootstrapped. `ls -la .env` is the first thing to check when
one test fails and the rest pass — it is cheaper than any other hypothesis, and
per [lesson: fix flakes at the root], a suite you cannot trust is not a gate.
