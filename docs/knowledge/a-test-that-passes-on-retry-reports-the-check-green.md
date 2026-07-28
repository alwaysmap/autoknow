---
title: A test that fails then passes on retry reports the CHECK green — so a green e2e tick is not evidence a flake is fixed
status: current
updated: 2026-07-28
applies_to:
  - tests/*.spec.ts  # judging whether a flake fix worked
  - playwright.config.ts  # `retries`
  - .github/workflows/ci.yml  # the e2e legs
symptoms:
  - an e2e check is green and you still cannot say whether the flake is fixed
  - a flake "fixed itself" between runs with no relevant code change
  - a diagnostic you added to a test never appears, because you read the tick and not the log
  - two runs of the same commit disagree, and only one of them was red
verified_by: 'autoknow-dxa — run 30333228844 reported `e2e (chromium) pass` while attempt 1 had failed (`pointerdown react=false`, click swallowed) and only the retry passed; run 30334474423 passed with no retries at all. The difference is invisible from the checks list and decisive.'
---

# A test that fails then passes on retry reports the CHECK green — so a green e2e tick is not evidence a flake is fixed

**The lesson.** `retries: 1` in CI means a spec that fails its first attempt and
passes the second is reported **flaky**, not failed: Playwright exits 0 and the
GitHub check goes green. For a flake — which by definition does not reproduce
every attempt — that is exactly "retried into a false green". When you are
judging whether a flake fix worked, the check status carries almost no
information. Read the job log and confirm there was **no `Retry #1`**.

**Why it bites.** It inverts the evidence at the one moment you are relying on
it. A green tick after a flake fix feels like proof and is not; a red one only
happens when the flake hit *twice*. So a fix that does nothing looks identical to
a fix that works, and the wrong conclusion is the comfortable one. This is how
`tests/phase_graph.spec.ts` survived three PRs: each time it was re-run, and each
time something went green. The comment on `playwright.config.ts`'s `retries`
asserts the opposite of this — that a real flake "fails visibly on the second
attempt" — which holds only for a flake that reproduces every time, i.e. not a
flake.

**What to do.** When a run is meant to prove a flake fix, state the criterion
before you look, and make it a property of the LOG: no `Retry #1` for that spec,
plus whatever invariant the fix establishes (here, `pointerdown … react=true`).
Instrument the test to print that invariant and read it out of the job log —
`gh api repos/<o>/<r>/actions/jobs/<id>/logs`. Retained artifacts would be the
better route, but this repo uploads none (bead `autoknow-uxi`). The mechanical
fix is `failOnFlakyTests: !!process.env.CI` (Playwright ≥1.52, and 1.61 is
installed), which makes the config comment true — proposed in bead
`autoknow-zbt`, deliberately not switched on in the PR that found this because it
turns every existing flake into a merge blocker at once.

**How we found out.** A fix for `autoknow-dxa` was pushed, CI went green, and the
instrumentation printed into the same log showed the press had still landed on an
unhydrated page and the click had still been swallowed — on attempt 1. The tick
said the opposite of the evidence sitting underneath it.
