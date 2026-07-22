# Architecture Decision Records

Short, immutable decision records — the compounding memory of this project.
Created and maintained by the `compound` skill (see `.claude/skills/compound/`):
each captures one decision with its context, rejected alternatives,
consequences, and receipts. Reversals get a NEW record that supersedes the old
one; history is never edited.

## Naming: `YYYY-MM-DD-kebab-slug.md`, never a sequence number

Records were numbered `0001…` until 2026-07-21, and the scheme broke the first
time two branches wrote one at once: both picked the next free number, and
because the filenames differed (`0005-session-…` vs `0005-retiring-…`) git
merged them without a conflict — two records sharing a number, two index rows
claiming it, and nothing to notice. A sequential id needs a central allocator,
which a repo with concurrent branches does not have.

The date has no such problem: it comes from the day you write the record, needs
no coordination, and two records written the same day still differ by slug. It
also sorts chronologically in `ls`, which is the order these are read in.

* **The SLUG is the identity** — stable, greppable, and what prose cites: "ADR
  `premerge-quality-gate`". The date prefix only orders the directory.
* **Reference it as a link where the medium allows** (`[ADR: <title>](path)`),
  and as `ADR <slug>` in code comments, where a link is not clickable.
* **`supersedes:` / `superseded-by:` carry the other record's slug**, not a
  number. A reversal is a NEW record; history is never edited.
* `tests/adrNaming.test.ts` enforces the shape and keeps the index honest.

Related knowledge with other homes: cross-cutting one-liners live in
[AGENTS.md](../../AGENTS.md) "Compounding lessons"; task-scoped rules live in
the agent skills; subsystem design rationale lives in the distilled plan docs
([INGEST_FRESHNESS_PLAN](../INGEST_FRESHNESS_PLAN.md) is the model: decisions
and invariants kept, narrative deleted).

## Index

| Date | Decision | Status | Tags |
|---|---|---|---|
| 2026-07-20 | [Decision records over detail documents; skills over bulk context](2026-07-20-decision-records-over-detail-documents.md) | accepted | docs, knowledge, agents |
| 2026-07-20 | [E2E tests user/system flows only, on a deliberate browser matrix](2026-07-20-e2e-flows-only-deliberate-matrix.md) | accepted | testing, e2e |
| 2026-07-20 | [Every PR runs the full quality gate, because merges auto-deploy](2026-07-20-premerge-quality-gate.md) | accepted | ci, testing, deploy |
| 2026-07-20 | [Serialize deploys; newest queued merge wins](2026-07-20-serialize-deploys-newest-wins.md) | accepted | deploy, ci |
| 2026-07-21 | [`npm ci` bootstraps a checkout — and CI and Docker never depend on that](2026-07-21-npm-ci-bootstraps-a-checkout-but-nothing-depends-on-it.md) | accepted | dev-loop, ci, docker, env |
| 2026-07-21 | [Third-party images are proxied through our origin; `img-src` stays `'self'`](2026-07-21-proxy-third-party-images-keep-csp-self.md) | accepted | security, csp, ui, auth |
| 2026-07-21 | [Retiring a URL deletes the route and migrates the data that cites it](2026-07-21-retiring-a-url-migrates-the-data-that-cites-it.md) | accepted | urls, data, ai, migrations |
| 2026-07-21 | [The signed-in session is the only source of "who I am"](2026-07-21-session-is-the-only-source-of-who-i-am.md) | accepted | auth, identity, seed, demo, lint |
| 2026-07-21 | [A trace paints direct neighbours; the closure only fades cards](2026-07-21-a-trace-paints-direct-neighbours-not-the-closure.md) | accepted | ui, rail, graph, tufte |
| 2026-07-21 | [A semantic overlay derives from the data it means, never from the layer beneath](2026-07-21-semantic-overlays-derive-from-data-not-from-the-layer-beneath.md) | accepted | ui, rail, svg, motion, verification |
