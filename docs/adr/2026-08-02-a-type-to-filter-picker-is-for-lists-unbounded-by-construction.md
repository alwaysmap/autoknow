---
status: accepted
date: 2026-08-02
supersedes: ""
superseded-by: ""
extends: "a-text-input-picker-cant-share-anchoredpopovers-invoker"
extended-by: ""
tags: [ui, forms, accessibility]
---

# A type-to-filter picker is for lists unbounded by construction; a closed lookup table keeps its `<select>`

**Context.** gh-269 asked for type-to-filter on "entity pickers", and the obvious reading
of that is "every `<select>` in the app". Rolling `Combobox` out to the remaining call
sites forced the question, because the surviving `<select>`s are not one kind of thing.
`PersonEditor`'s organization picker is the partner directory — hundreds of rows in a real
deployment. `PartnerEditor`'s type picker is `OEM | Supplier`. Both are `<select name=…>`
over a database table, and only the first one has the problem the component was built for.

**Decision.** Convert a picker when its option set is **unbounded by construction** — it
grows with the business, so no reader can be expected to scan it. Leave a native
`<select>` when the set is closed and short: `PartnerEditor`'s type (2 rows) and region
(4), and `PersonEditor`'s phase picker, whose options are the phases of one
already-chosen program. Below roughly a screenful the native control is strictly better —
one tap to the OS picker on a phone, no filtering behaviour to explain, no ARIA to get
right — so converting costs the reader and buys nothing. A lookup table growing past a
screenful is the signal to revisit, not the row count on the day it was written.

**Alternatives rejected.**

- *Convert everything, for consistency.* Consistency of MECHANISM, bought with a worse
  control on the surfaces that did not need it. The fields still LOOK alike either way,
  because `Combobox` reuses `dash.textInput`, so a native `<select>` beside one is not a
  visual break — and the consistency that actually matters to a reader is that the same
  NAMED field behaves the same way wherever it appears, which is a claim about finishing
  the sweep (below), not about converting every `<select>` in the app.
- *A row-count threshold in code, picking the control at runtime.* Two controls to keep
  working, two sets of e2e interactions, and a field that changes interaction model when
  someone seeds a fifth region. The judgement is a design-time one and belongs in a
  record, not in a branch.

**Consequences.** "Why is this still a `<select>`?" has an answer that is not "nobody got
to it" — but only if the two kinds of survivor are kept apart, because an undifferentiated
list of exceptions is indistinguishable from an abandoned migration:

- *Deliberate, by the rule above.* `PartnerEditor`'s type (`OEM | Supplier`) and region
  (`AMER | APAC | EMEA | Other`); `PersonEditor`'s phase picker (the phases of one
  already-chosen program). Every enum-valued control — severity, org level, escalation status, lead role —
  is outside this decision altogether: those are not entity pickers, and no growth turns
  them into one.
- *Not yet done, and unbounded.* Tracked in `autoknow-wak`, which names each call site.
  Two of them are the SAME named field as a converted one ("Googler Owner" on
  `/programs/new`, "Organization" in `TrackPersonProse`), so until they land, one field
  has two interaction models on different pages. **The rule is settled; the sweep is not**
  (AGENTS lesson 7).

Deliberately NOT restated in `Combobox.tsx` — the component links here instead. A second
copy of an exception list is the staleness trap this record exists to prevent, and the
first version of that comment was already wrong on the day it landed.

The remaining cost is that the boundary is a judgement, not a rule a linter can hold: a
lookup table that quietly grows past a screenful will not announce itself.

**Receipts.** PR for `autoknow-zl8`; the primitive and its invoker constraint are
[the preceding ADR](2026-08-02-a-text-input-picker-cant-share-anchoredpopovers-invoker.md);
gh-269; AGENTS lesson 3 (entity inputs are pickers, which is about the committed VALUE and
is satisfied by either control).
