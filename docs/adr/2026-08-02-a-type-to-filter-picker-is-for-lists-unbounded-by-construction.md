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
(3), and `PersonEditor`'s phase picker, whose options are the phases of one
already-chosen program. Below roughly a screenful the native control is strictly better —
one tap to the OS picker on a phone, no filtering behaviour to explain, no ARIA to get
right — so converting costs the reader and buys nothing. A lookup table growing past a
screenful is the signal to revisit, not the row count on the day it was written.

**Alternatives rejected.**

- *Convert everything, for consistency.* Consistency of MECHANISM, bought with a worse
  control on the surfaces that did not need it. The forms already read as one grammar
  because `Combobox` reuses `dash.textInput` — a native `<select>` beside it is not a
  visual inconsistency, and design.md §7 is about grammar, not about widget identity.
- *A row-count threshold in code, picking the control at runtime.* Two controls to keep
  working, two sets of e2e interactions, and a field that changes interaction model when
  someone seeds a sixth region. The judgement is a design-time one and belongs in a
  record, not in a branch.

**Consequences.** "Why is this still a `<select>`?" now has an answer that is not "nobody
got to it", and the answer is written where the next reader will be — `Combobox.tsx`'s
SCOPE comment names each survivor and why. The cost is that the boundary is a judgement,
not a rule a linter can hold: a lookup table that quietly grows past a screenful will not
announce itself.

**Receipts.** PR for `autoknow-zl8`; the primitive and its invoker constraint are
[the preceding ADR](2026-08-02-a-text-input-picker-cant-share-anchoredpopovers-invoker.md);
gh-269; AGENTS lesson 3 (entity inputs are pickers, which is about the committed VALUE and
is satisfied by either control).
