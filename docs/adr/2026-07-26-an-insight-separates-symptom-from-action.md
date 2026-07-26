---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [insights, types, i18n, ui, chain]
---

# An insight is one envelope, and its symptom is separate from its action

**Context.** Three surfaces had independently grown the same row (#149): the Flow
Constraint Diagnosis on `/ecosystem-summary` (`LiveConstraint`), Possible Resource
Constraints on `/ecosystem` (`BusiestRow`), and `chainLedger`'s `Situation` union.
Each is a derived "here is something worth your attention"; each hand-rolled its
own type, its own ranking scalar, its own empty-state convention, and its own
decision about whether to offer advice. A fourth finding cost a fourth invention,
and no two of them could be listed, ranked or filtered together.

`FeedItem` had already solved exactly this for activity — a stable envelope plus
optional typed payloads, which is why search hits, status changes and phase
updates flow through one list and one component.

**Decision.** `Insight` (`src/lib/insight.ts`) is that envelope for derived
findings: `id`, `source`, `scope`, `symptom`, `action`, `since`, `severity`,
`href`. Four properties are the point, and each is a claim a producer could
otherwise break while still compiling:

* **Symptom and action are separate fields, and `action: null` is a first-class
  answer.** A surface can render the finding without advice. `BusiestResources`
  already returned `null` rather than inventing a recommendation; this makes that
  legal everywhere instead of a local habit.
* **`basis` (`measured` | `estimated` | `asserted`) sits inside `symptom`, beside
  the number it qualifies.** `overPct` is a share of a typed-in
  `forecastedDuration` — "40% over" is over a guess. Without the flag a surface
  renders a measurement and an opinion in the same ink.
* **`severity` is a three-value enum, never a score.** `BusiestRow.exposure` is
  `days × units`: two incommensurate units multiplied into a number no reader can
  interpret. `compareInsights` therefore ranks by severity across sources and
  compares `measure` **only within one source**. Across sources it GROUPS, in
  `InsightSource`'s declaration order, rather than returning a tie: a comparator
  that ties across sources is intransitive, and `Array.sort` then reorders two
  insights that *are* comparable. Grouping is not a claim that a chain insight
  outranks a load one — it is what makes the order total, and a total order is
  the only kind that can promise "bigger measure first" for every input.

  The same trap caught this comparator **twice**: once across sources, and once
  on `measure: null`, where `null ≡ 5` and `null ≡ 10` while `10 < 5`. Both were
  written as ties for the same sympathetic reason ("these two aren't comparable,
  let the producer's order stand"), and a stable sort does not deliver that — it
  preserves input order only for elements the comparator actually calls equal.
  So: a measureless insight sorts to the END of its group, and **every branch of
  a comparator has to be total, not just the one someone caught first.** Both are
  pinned by permutation tests rather than a single input order, because a single
  order is exactly how each of them hid.
* **`symptom.key` and `action.key` are `StringKey` from `lib/i18n`, not `string`.**
  The catalog key is compile-checked, so prose cannot be smuggled into a producer.
  This is what lets a list of insights be built, sorted and filtered server-side —
  the reason `/ecosystem`'s "Consider:" line cannot be today: `considerLine` builds
  React nodes at render time.

`since` and `measure` are **required and nullable**, not optional. Optional gives
"I do not know" and "I forgot" the same spelling, and a fabricated start date is
the precise failure `since` exists to prevent (#148: the constraint panel names
*where*, never *since when*).

**Alternatives rejected.**
- *A per-surface type, as today.* The status quo, and the thing that made a fourth
  finding cost a fourth invention.
- *Extend `FeedItem` to carry both.* An activity is something that HAPPENED; an
  insight is something derived about NOW. They share an envelope shape, not a
  meaning, and merging them would put `timestamp` and `since` in one field where
  a reader cannot tell which one they are looking at.
- *A single cross-source numeric score.* This is `exposure` again, at portfolio
  scale — a compound of incommensurate units, unreadable and unauditable.
- *`symptom.key: string`.* The issue proposed it. `string` documents the intent
  without enforcing it, and `lib/relationship`'s `REL_KEY: Record<RelScore,
  StringKey>` is the existing precedent for enforcing it (AGENTS lesson 2).

**Consequences.** A new finding is a producer, not a new type. `Situation` stays:
it is a richer phase-local union and the mapping to `Insight` is lossy in that
direction, so it becomes a producer rather than being replaced. Producers must own
their i18n keys — the catalog gains a key per new symptom, which is the intended
cost. Whether insights are derived per request or materialized, whether they
aggregate, and whether they ever persist (dismissed / snoozed) are all deliberately
left open: those answers change an insight from a derived view into state, and
nothing yet needs them.

**Receipts.** Shape only, by the issue's own last acceptance line — "a shape
validated by one caller is a guess", so nothing is built on it here. Three real
producers are expressed against it in `tests/insight.test.ts` to prove the fit:
`LiveConstraint` (which surfaced that it is a phase-NAME rollup with no single
phase id, so it scopes to `ecosystem`), `chainLedger`'s `forecastOverrun`
Situation (`basis: 'estimated'`), and a `BusiestRow` with its `clConsiderPerson`
advice. The first real callers are #148 and #140.
