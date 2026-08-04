---
title: A plain `<a href="#x">` scrolls the page before your handler decides it shouldn't
status: current
updated: 2026-08-03
applies_to:
  - src/components/**  # any anchor whose href is a same-page fragment AND which also runs a click handler
  - src/app/globals.css  # `html { scroll-behavior: smooth }` is what makes that jump an animation
symptoms:
  - an element already fully visible still jumps to the top of the viewport when clicked
  - the page moves twice for one click, the second move much smaller than the first
  - a carefully-written "only scroll when it doesn't fit" guard is honoured and the page moves anyway
  - Back has to be pressed twice to leave a page whose rows are addressable
verified_by: 'tests/phase_card_placement.spec.ts (all three cases fail on the unfixed component: +46px on a card needing no rescue, top pinned to the clearance line, history depth +1); bead autoknow-06t'
---

# A plain `<a href="#x">` scrolls the page before your handler decides it shouldn't

**The lesson.** Activating a same-page fragment anchor does two things, and only one
of them is yours. The browser performs its own fragment navigation — it scrolls to
the target and pushes a history entry — and it does this **unconditionally**, before
any placement your `onClick` computes. So a handler that carefully decides *not* to
move the page has already lost: the page moved. If an anchor both addresses something
and does something, the handler must take the fragment over with
`e.preventDefault()` plus an explicit `history.replaceState`.

**Why it bites.** The two halves look independent in the source and are usually
written months apart, so nothing on screen says they compose. It is worse here than
elsewhere for two reasons. First, `html { scroll-behavior: smooth }` (globals.css)
makes the browser's jump an *animation*, so the two scrolls visibly fight rather than
resolving in one frame. Second, this codebase's own grammar invites the collision:
"everything is a URL" (design.md §2) means rows, cards and sections carry real hrefs
precisely so they can be shared, and the same elements are the click targets. A Next
`<Link scroll={false}>` suppresses the jump, which is why the several `<Link>`-based
hash controls on the phase rail never showed this — the bug needs a *plain* `<a>`.

**What to do.** Decide which half owns the page. If the anchor is purely an address —
a fragment link that only wants the browser's own jump — let the browser have it and
add no handler. (`AnchorHeading`'s hover-revealed `#` was the example here until it was
removed on 2026-08-03; the section ids it addressed are still there.) If a handler
also places the page, take the whole gesture: `preventDefault()`, write the fragment
with `replaceState` (which state is showing is a mode of the page, not a stop on the
way back), and let the handler scroll. Leave modified clicks alone — meta/ctrl/shift/
alt and any non-primary button are "open in a new tab" / "copy link", and a real href
is what makes those work. `ChainLedger.tsx` and `PhaseTrack.tsx`'s card title are the
two worked examples; grep `href={\`#` outside `<Link>` to find the rest.

**How we found out.** On `/programs/:id`, clicking a phase card's title scrolled the
page 1353 → 1685 via the fragment jump, and `activateCard`'s own `scrollIntoView` then
moved it a further 8px. `activateCard` already implemented and documented the correct
rule — move the page only to rescue a card that is not whole on screen — and the rule
was working; it simply ran second. Unit tests and the rail's e2e specs were all green
throughout, because every one of them asserted what the card *showed*, never where the
page *was*. See also
[a-page-scroll-between-press-and-release-loses-the-click](a-page-scroll-between-press-and-release-loses-the-click.md):
the same stray scroll, sampled at a worse moment, silently eats the click instead.
