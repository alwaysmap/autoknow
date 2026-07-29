---
status: accepted
date: 2026-07-28
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [ui, urls, phases, overlays]
---

# A phase is READ on its card; the only thing left over it is the write

**Context.** A phase's record has now lived in three places. The standalone
`/history/phase/:id` page retired 2026-07-21 into a focused DETAILS popover, and the
popover became where a phase actually *was*: the update form, the full log, Goal &
DoD, before/after dependency chips, people/partner editing and + Watch a source all
sat inside it, while the rail card was a summary with an expand button that opened
it. The card was a table of contents for a modal, so the common path to reading a
phase was card → modal → read → close. A program page is mostly made of phases; a
modal is a bad home for the thing a page is made of.

**Decision.** Invert it. **The card is the phase's home and states the phase without
opening anything** — goal and definition of done on the left, the latest update whole
on the right (graphic, words, date, author), involvement pinned to the foot. The
popover retires.

Exactly one thing still opens over the card, and it is the one thing a reading
surface cannot be: **UPDATE & HISTORY** (`#phase-:id-progress`) — the full hill log
*and* the form that adds to it. One affordance, not two, because an update IS an entry
in the log it joins. It is named for both jobs: a control labelled only "History"
hides this app's most frequent write behind a word that means looking backwards.

Everything else the popover held went somewhere that already owned it: structure,
name, forecast, Goal & DoD and involvement to the ONE phase editor
(autoknow-crw.1); the dependency chips to the rail, which already draws them and
traces them on click. The card's three affordances are Edit, Update & history, and
+ Watch a source; the expand button is gone.

`#phase-:id` is therefore the phase's whole address, and **arriving there OPENS that
card** — every card rests collapsed, so a fragment that merely scrolled would land a
reader on a one-line header, which is the lossy preview this change removes.

**Alternatives rejected.**
- *Keep the popover as an optional "full record"* — two homes for one phase is the
  duplication this change exists to remove, and the second one always wins the
  affordances back over time.
- *Put the update form inline on the card* — the card is a reading surface; a live
  form on every one of fifteen rows is noise, and a half-typed note would belong to
  whichever card you last clicked.
- *Split History and Update into two affordances* — an update is an entry in the log,
  so splitting them means two doors onto one story and a card with four controls.
- *Leave `#phase-:id` as a scroll anchor only* — a phase link would land on a
  collapsed header, i.e. the exact failure the epic set out to fix.
- *Alias `#phase-:id-detail` to the card forever* — two spellings of one address,
  permanently. It is canonicalised on arrival instead, and the shim states the
  condition under which it goes away.

**Consequences.** The standard card is bigger and taller; the COLLAPSED state is
deliberately untouched, because one line per row is what keeps a 15-phase program
scannable. Retiring `#phase-:id-detail` is a data question, not only a code one
(AGENTS lesson 15): stored AI-brief citations are rewritten at the read boundary
(`lib/summaries`) onto the card, and old bookmarks are canonicalised there on arrival
— a fragment cannot 404 the way a route can, so nothing else would tell a reader they
had landed nowhere. Both shims die together, once no `Summary.body` on file cites the
old shape. Coverage moved with the surface rather than being deleted: the two specs
that edited involvement inside the popover now do it in the phase editor.

**Receipts.** `docs/HILL_CHARTS_CONVERGENCE_PLAN.md` was written against the popover
and its STATUS now says so. `tests/history_retired.spec.ts` states the new truth
(retired URL canonicalises onto the card; the log is its own URL and closes back to
the card); `tests/summaryLegacyCitations.test.ts` pins both legacy citation shapes
rewriting to the card in one hop; `tests/phase_graph.spec.ts` pins the three
affordances and the progress view's fragment. Beads autoknow-crw.1 … crw.4.
