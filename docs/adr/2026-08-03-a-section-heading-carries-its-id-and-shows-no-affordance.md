---
status: accepted
date: 2026-08-03
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [ui, navigation, headings]
---

# A section heading carries its id and shows no affordance for it

**Context.** "Everything is a URL" (design.md §2) gave every `<h2>` an id and, next
to it, a hover-revealed `#` link to that id — three CSS states of one glyph
(`.row:hover` reveal, `:focus-visible` reveal for keyboards, and `@media (hover:
none)` showing it permanently at 0.45), repeated on every section heading in the
app. It also carried real layout arithmetic: zero width plus a `-1 * --gr-gap`
margin, so the invisible glyph would not push the trailing graticule right (#25).
The user's verdict on the affordance was that it is a distraction.

**Decision.** The id stays on the `<h2>`; the visible affordance goes. Section
deep links remain real, shareable addresses that the browser scrolls to —
`AnchorHeading` simply renders no control that points at them.

**Alternatives rejected.**
- *Keep it, revealed only on `:focus-visible`.* Keeps the keyboard path but keeps
  the glyph, the three states and the layout arithmetic — the cost this removes is
  the mechanism, not one of its states.
- *Hide it with `opacity: 0` and no reveal rule.* Leaves a focusable link nobody
  can see, which is worse than either shipping it or removing it.
- *Add a copy-link item to the section's ⋯ menu.* Most headings have no menu, so
  this trades one uniform affordance for an inconsistent one; nobody asked for a
  replacement.

**Consequences.** Grabbing a section's URL now means arriving at the section and
reading the address bar, or knowing the id. That is the deliberate give-up: the
addresses are unchanged and every link already shared still resolves, but the app
no longer hands one to you. `AnchorHeading` loses its `linkLabel` prop and the
`anchorLink` i18n key (all four locales). Nothing about the heading row's geometry
changed — the removed glyph's own arithmetic existed to make the row measure as if
it were absent, so the graticule's seen lead is still exactly `--graticule-lead`
(measured 12px against a `.75rem` token).

**Receipts.** bead `autoknow-or9`; design.md §2 rewritten in the same PR; the two
knowledge notes that described the `#`
([no-component-owns-heading-typography](../knowledge/no-component-owns-heading-typography.md),
[a-plain-hash-anchor-scrolls-before-your-handler-decides-not-to](../knowledge/a-plain-hash-anchor-scrolls-before-your-handler-decides-not-to.md))
corrected in place.
