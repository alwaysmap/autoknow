---
status: accepted
date: 2026-07-20
supersedes: ""
superseded-by: ""
tags: [testing, e2e]
---

# E2E tests user/system flows only, on a deliberate browser matrix

**Context.** The suite ran 86 tests × 3 browsers (chromium/firefox/webkit) =
258 serial executions against one shared DB, and ~a third of the tests were
static-render assertions (`goto` → expect text visible). e2e minutes are the
most expensive test minutes; the matrix tripled them for engine-agnostic DOM
checks.

**Decision.** An e2e test must exercise a user/system interaction *flow* —
the user does something, the system responds or persists. Chromium runs the
full suite (Chrome-dominant internal user base); WebKit re-runs only the
engine-sensitive specs (`<dialog closedby>`, month/range inputs, SVG drag:
projects_flow, project_details, phase_graph, needle); a new spec joins the
WebKit list only if it exercises engine-divergent behavior. One boot-smoke
static test is allowed per app.

**Alternatives rejected.**
- *Full 3-browser matrix* — re-running table filters and i18n text on three
  engines produced zero divergent signal in the suite's history.
- *Dropping WebKit entirely* — it is the divergent-engine canary exactly where
  the app leans on newer platform features (dialog light-dismiss fallback).
- *Keeping static-render tests "because they're cheap"* — serially they are
  not, their logic is unit-tested (criticalChain, forecast), and their content
  is design-review territory.

**Consequences.** 258 → 87 executions (~2.3 min), cheap enough to gate every
PR (ADR premerge-quality-gate). Firefox regressions would surface only via users; accepted for
an internal Chrome-dominant tool. Screenshot capture became opt-in
(`npm run test:e2e:screens`).

**Receipts.** `acd9a2a` (the cut + verified 87/87 green); the same run caught
a test stale since PR #15 merged unchecked; rules live in the `qa` skill.
