---
title: A heading whose presence one computation decides, over content another decides, will eventually render over nothing
status: current
updated: 2026-08-15
applies_to:
  - src/components/**
  - src/app/**/*.tsx
  - src/lib/chainLedger.ts
symptoms:
  - a section heading renders with an empty box under it
  - "{xs.length > 0 && <ul>…} under an unconditional <h3>"
  - a column promises an instruction and gives none
verified_by: 'tests/chainLedger.test.ts "the Next-steps floor"; tests/chain_next_step_floor.spec.ts; issue #174'
---

# A heading whose presence one computation decides, over content another decides, will eventually render over nothing

**The lesson.** When a heading is gated by one computation and the content beneath it by
another, the two are free to disagree, and one day they will: the reader is promised
something and handed an empty box, which is worse than saying nothing. Either gate them
together, or make agreement an INVARIANT the data layer holds up — never a coincidence
you inspect and declare safe.

**Why it bites.** The two computations usually answer questions that *sound* like the same
question. The Critical Chain's `<h3>` came from `ledger.register`, which is pure buffer
arithmetic — "is the reserve thinner than the 50% guideline?" The list beside it was
assembled from five unrelated situation kinds — overruns, oversubscribed resources, an
upcoming handoff, the owner's load, SOP overshoot. A program holding 65 days against a
168-day guideline answers YES to the first and NO to all five, so it rendered **Next
step** over nothing, beside a column explaining that idle time was already costing it a
day. The second trap is worse than the first: the `act` register *looked* safe, because
`immediateFocus` also feeds the overrun bullets — but that is two code paths happening to
agree, not an invariant, and nothing would have caught it drifting apart.

**What to do.** Sweep with `grep -rn "length > 0 &&" src/components src/app --include=*.tsx`
and read each hit for whether a sibling heading renders unconditionally. Every hit in this
repo except one gates heading and content together — including the correct model sitting
in the same grid, `{wfRows.length > 0 && <div><h3>…}`, which gates the whole block.

When the heading legitimately must render (its presence carries meaning), give the content
a **floor computed in the data layer**, not a string the component invents when the array
is empty:

- a component that invents an instruction the ledger does not know about is untestable
  where the rest of the ledger is unit-tested, and it breaks the "renders structured facts
  only" contract those components state in their own headers;
- the floor must be a strict complement of the real cases (`yieldsStep` in
  `lib/chainLedger`), so it is a floor and never a preamble;
- assert the implication itself — `register !== 'none'` ⇒ at least one step — over every
  branch, which is what stops the next case from re-opening it.

A heading that is a complete sentence on its own ("Nothing needs to change today") needs
no list and must not grow an invented one. That is the third state, and forgetting it is
how a floor turns into noise on every healthy record.
