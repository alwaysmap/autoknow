---
title: A page scroll that steps between press and release hands the click to an ancestor, and nobody reports it
status: current
updated: 2026-07-28
applies_to:
  - src/components/**  # anything that scrolls the document (scrollIntoView, scrollTo, an in-page `#hash` link)
  - src/app/globals.css  # `html { scroll-behavior: smooth }` is what makes every such scroll an animation
  - tests/*.spec.ts  # a spec that clicks the same surface twice in a row
symptoms:
  - a click Playwright reports as successful leaves the component's state untouched
  - a spec passes alone and on re-run, and fails only under full-suite load
  - an assertion reads the state the PREVIOUS click set, as if this one never happened
  - the failure is webkit-only, in a different spec each run
verified_by: 'tests/useSteadyPageScroll.test.tsx (every branch of the guard, including "stops page motion already under way on the press itself"); tests/documentScrollGoesThroughTheGuard.test.ts enforces that every document scroll uses it — mutation-checked, a raw scrollIntoView in PhaseTrack turns it red; bead autoknow-e1h'
---

# A page scroll that steps between press and release hands the click to an ancestor, and nobody reports it

**The lesson.** If the page scrolls between a pointer's `mousedown` and its
`mouseup`, the two land on different elements — and the browser then dispatches
`click` to their nearest common ANCESTOR, not to the thing that was pressed. The
handler on the pressed element never runs. Nothing throws, nothing logs, and the
automation that dispatched the press reports success. So: anything that scrolls
the document must not be able to move it under a pointer that is already down.

**Why it bites.** `html { scroll-behavior: smooth }` (globals.css) turns *every*
in-page scroll into an animation clocked by animation frames — including ones no
one asked to animate, such as an `<a href="#row-7">` fragment jump. A loaded
machine starves that clock: a scroll requested now can sit still for 200ms and
then take its first step at an arbitrary later moment. Waiting for the element to
hold still first does not help, and this is the trap — at the instant you sample,
the pending scroll has not moved anything, so the element looks perfectly stable.
Playwright's own actionability check is exactly that sample. Deferring the scroll
behind `requestAnimationFrame` widens the window from milliseconds to hundreds of
them, because the deferral is starved by the same clock.

**What to do.** Scroll the document through `useSteadyPageScroll`
(`src/lib/useSteadyPageScroll.ts`), which refuses to start a scroll while a pointer is
down and halts one already under way on the next press. Reach for it whenever a
click's response includes moving the page. An INNER scrollport does not need it —
`scroll-behavior` is set on the scroll root only, so those scrolls are instant and
cannot straddle a gesture; `block: 'nearest'` inside a scroll region is the tell.
Diagnose a suspected case by logging `mousedown`/`mouseup`/`click` targets and
`window.scrollY` from an init script — a `mousedown` on your element and a `click`
on something else is the whole proof, and takes one run. If the `mousedown` itself
landed off your element, suspect the test first:
[a-test-that-starts-page-motion-before-the-press-races-its-own-press-point](a-test-that-starts-page-motion-before-the-press-races-its-own-press-point.md).

**How we found out.** A phase-rail card click read `data-rel="far"` — the
PREVIOUS card's selection — only under full-suite load on webkit. The event log
showed `mousedown` on the card's title at `scrollY=1353`, a scroll to 1523 nine
milliseconds later, then `mouseup` on an unrelated `<input>` and `click` on a
`<div>` outside every card. The scroll was the last click's placement, whose two
animation frames had been starved for 182ms.
