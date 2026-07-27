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
* **Reference it as a link where the medium allows** (`[ADR: <title>](<path>)`),
  and as `ADR <slug>` in code comments, where a link is not clickable.
  Placeholders in docs are spelled with angle brackets so a link checker can tell
  them from a real path that has rotted.
* **`supersedes:` / `superseded-by:` carry the other record's slug**, not a
  number. A reversal is a NEW record; history is never edited.
* **`extends:` / `extended-by:` are the same machinery for the non-reversal
  case**: the old record still holds but no longer describes the whole system.
  Without the forward pointer it quietly starts lying. Filling in a forward field
  is additive, not a history edit.
* `tests/adrNaming.test.ts` enforces the shape and keeps the index honest.

Related knowledge with other homes: **findings** — how the system actually
behaves, learned the hard way, as opposed to anything we chose — live in
[docs/knowledge/](../knowledge/README.md), undated and edited in place;
cross-cutting one-liners live in [AGENTS.md](../../AGENTS.md) "Compounding
lessons"; task-scoped rules live in the agent skills; subsystem design rationale
lives in the distilled plan docs ([INGEST_FRESHNESS_PLAN](../INGEST_FRESHNESS_PLAN.md)
is the model: decisions and invariants kept, narrative deleted). The `compound`
skill routes between them.

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
| 2026-07-22 | [Findings get a third home, and the homes are priced by retrieval cost](2026-07-22-findings-get-a-third-home-priced-by-retrieval.md) | accepted | docs, knowledge, agents, context |
| 2026-07-22 | [Containers own outer spacing; charts fill width and own their height](2026-07-22-containers-own-spacing-charts-own-height.md) | accepted | ui, layout, css, box-model, charts |
| 2026-07-22 | [Ingestion is sized for hundreds of sources; declare the limits, gate the 10K rebuild](2026-07-22-ingestion-sized-for-hundreds-gate-the-10k-rebuild.md) | accepted | scaling, ingestion, vectors, freshness, architecture |
| 2026-07-22 | [Poppable charts: a parameter for humans, a credentialed `/embed` for machines, one shared assembly](2026-07-22-poppable-charts-a-parameter-a-shared-assembly-and-a-token.md) | accepted | ui, charts, urls, auth, embed, kiosk |
| 2026-07-23 | [Ingestion health is a serverless signal, not a growing table](2026-07-23-ingestion-health-is-a-serverless-signal-not-a-growing-table.md) | accepted | ingestion, infra, cost, observability, scaling |
| 2026-07-23 | [Converge the hill charts on one drawing, two roles, and the Basecamp snapshot card](2026-07-23-converge-the-hill-charts-on-one-drawing.md) | accepted | ui, charts, hill, components, urls |
| 2026-07-24 | [Compound records ride the PR that motivated them, and CI blocks the merge until the judgement is declared](2026-07-24-compound-records-ride-the-pr-that-motivated-them.md) | accepted | docs, knowledge, ci, agents, process |
| 2026-07-24 | [A forecast on screen derives from the real plan; a synthetic model is deleted, not kept beside it](2026-07-24-forecasts-derive-from-the-real-chain-never-a-synthetic-model.md) | accepted | forecast, ui, data-integrity, charts, critical-chain |
| 2026-07-25 | [Seeded content moves through the real connectors, and a demo may compress the schedule but never a timestamp](2026-07-25-seeded-content-runs-the-real-pipeline-and-fakes-only-the-schedule.md) | accepted | seed, demo, ingestion, freshness, data-integrity |
| 2026-07-26 | [Parallel work builds in parallel and merges one at a time](2026-07-26-parallel-work-merges-serially.md) | accepted | deploy, ci, process, agents |
| 2026-07-26 | [An insight is one envelope, and its symptom is separate from its action](2026-07-26-an-insight-separates-symptom-from-action.md) | accepted | insights, types, i18n, ui, chain |
| 2026-07-26 | [One Gemini budget, spent by every automated consumer in priority order](2026-07-26-one-gemini-budget-pool-ordered-freshness-first.md) | accepted | ingestion, gemini, cost, budget, summaries |
| 2026-07-26 | [A fact owned by infrastructure is supplied at runtime or declared unknown — never a literal](2026-07-26-infra-owned-facts-are-supplied-or-unknown.md) | accepted | infra, terraform, config, env, copy, budget |
| 2026-07-26 | [A stored vector fails loud; a query vector fails soft](2026-07-26-a-stored-vector-fails-loud-a-query-vector-fails-soft.md) | accepted | ingestion, embeddings, data-integrity, gemini, search |
| 2026-07-26 | [`Person.currentPartnerId` is a cache; the affiliation covering the day is the truth](2026-07-26-currentpartnerid-is-a-cache-affiliations-are-the-truth.md) | accepted | data-integrity, identity, affiliations, lint, prisma |
| 2026-07-26 | [Recording a move INSERTS into a career timeline; it never appends to the end of it](2026-07-26-a-move-is-an-insert-into-a-timeline.md) | accepted | people, affiliations, temporal, data-integrity, actions |
| 2026-07-26 | [Navigation is the one inner activation that dismisses a popover, and the popover decides it](2026-07-26-navigation-is-the-one-inner-activation-that-dismisses.md) | accepted | ui, popover, menus, navigation, components |
| 2026-07-26 | [A name→FK backfill writes only the unambiguous match, and reports the rest](2026-07-26-a-name-to-fk-backfill-writes-only-the-unambiguous.md) | accepted | data-integrity, identity, migrations, backfill |
| 2026-07-26 | [A backfill reaches production through one allowlisted dispatch runner, as the DML-only role](2026-07-26-a-backfill-reaches-prod-through-an-allowlisted-dispatch-runner.md) | accepted | ci, database, security, backfill, deploy |
| 2026-07-26 | [A dated row is labelled as of ITS OWN date; a list of dated rows resolves per row](2026-07-26-a-dated-row-is-labelled-as-of-its-own-date.md) | accepted | identity, affiliations, feed, activity |
