---
title: A test that synthesises the hazard a guard defends against must first prove the guard is ARMED
status: current
updated: 2026-07-28
applies_to:
  - tests/*.spec.ts  # any spec that scrolls the document and then clicks, or that stages a race for a client-side guard
symptoms:
  - a regression test for a click-swallowing bug fails intermittently, and only under load
  - the component state is untouched after a click Playwright reported as successful
  - the failure is indistinguishable from the regression the test exists to catch
  - a "fix" for that flake goes green in CI while the underlying press is still landing wrong
verified_by: 'tests/phase_graph.spec.ts "a card click is not swallowed by page motion still under way" — CI run 30333850072 (chromium attempt 1: `pointerdown react=false`, scroll 1444→1674 unhalted, release on a `DIV` outside every row) vs run 30334474423 (both engines `react=true`, no retries); measured drift table; mutation-checked green→red on both engines; bead autoknow-dxa'
---

# A test that synthesises the hazard a guard defends against must first prove the guard is ARMED

**The lesson.** A client-side guard arms on mount. A test that manufactures the
hazard it defends against — starting a scroll, a resize, a navigation — can fire
that hazard before the guard exists, and then it is testing an unguarded page. It
fails exactly like the bug, so it reads as a regression and gets re-run. Wait for
the guard, and wait on a signal **the server cannot render**.

**Why it bites.** Two independent traps, both live in the same test here:

* *The press point is stale.* Playwright computes a click's point at `click()` and
  never recomputes it. Motion begun any earlier — a `mousemove` listener, a hover —
  drifts the page out from under it. Measured: a 50ms gap drifts 12px, and the
  title link is 24px tall, so half an element is the whole error budget.
* *Your trigger outruns the app's.* Moving the trigger to a capture-phase
  `pointerdown` in `addInitScript` fixes the drift, because the page cannot move
  before a press that IS the trigger. But `addInitScript` runs at document start,
  so it also wins the registration race against a guard that arms in a mount
  effect. Press before hydration and the hazard fires with nothing to cancel it.

**What to do.** Gate the press on a client-only signal, asserted as state rather
than retried as an interaction (a retry spends a `once` listener and then passes
against a settled page — green whatever the code does). Verify the gate is really
client-only by loading with `page.route('**/*.js', r => r.abort())` and counting
it: it must be **zero**. Here `svg title` counted 8 without JS — server-rendered
icons — so the first gate gated nothing and CI went green anyway.

**How we found out.** Three CI failures across three PRs, each read as a product
regression. Local reproduction failed four ways (CPU throttled 20x, JS chunks
delayed 2.5s, full suite under load, repeat-each×24) because every one of them
slows hydration and the scroll animation together, and the failure needs them
skewed. The answer came from logging `mousedown`/`mouseup`/`click` targets plus
`window.scrollY` **in CI** — one run, and `react=false` at `pointerdown` was the
whole story. See also
[a-page-scroll-between-press-and-release-loses-the-click](a-page-scroll-between-press-and-release-loses-the-click.md),
the product defect this test exists to catch.
