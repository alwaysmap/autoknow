---
title: A screenshot of a scrolled page can come back blank — the capture missed the content, the element is fine
status: current
updated: 2026-08-03
applies_to:
  - signing off any section far down a long page from the Browser pane
  - verifying an OverlayDialog / <dialog> from the Browser pane
symptoms:
  - the screenshot is one flat expanse of page background and nothing else
  - the DOM says the element is there, position fixed, visibility visible, opacity 1
  - the same content screenshots correctly when the page is scrolled to the top
  - a hit test finds your element but consecutive screenshots are flat background
verified_by: '#111 partner-health popover, feed row at scrollY 1019: elementFromPoint(640,360) returned the dialog''s history list while two consecutive screenshots came back blank; 2026-08-03 ecosystem risk-table empty state at scrollY 2106 with NO dialog in the document — elementFromPoint hit the TD, three consecutive screenshots blank, captured fine in both themes after hiding preceding siblings to bring the section to scrollY 0'
---

# A screenshot of a scrolled page can come back blank

**The lesson.** When the page is scrolled well away from the origin, the Browser
pane's capture can come back as a uniform block of `--bg` with none of the page
content in it. The element is not invisible and nothing is wrong with your CSS —
the *capture* missed it. Put the content at scrollY 0 and it photographs
perfectly.

**Why it bites.** It inverts the repo's own sign-off rule, and inverts it in the
most expensive direction. AGENTS lesson 18 says to trust the SCREENSHOT over
element counts, because three defects in a row rendered valid geometry that was
invisible. Here the screenshot is the thing that lies, so an agent who follows
the rule faithfully concludes the content does not render, and goes looking for a
bug in a component that works. The two cases are genuinely hard to tell apart
from the image alone, because "correct element you cannot see" and "correct
element the camera missed" produce the same flat rectangle.

**A modal is not required, and the top layer is not the mechanism.** This note
was first written from a `showModal()` popover and blamed the browser's top
layer. It then recurred on an ordinary scrolled page — a plain `<section>` with a
table, no dialog anywhere in the document — so the top-layer story explains at
most the first instance. Scroll distance is the common factor; the real mechanism
is still unknown. Do not skip this note because your case has no dialog in it.

**What to do.** Distinguish "the camera missed it" from "genuinely invisible"
with a **hit test**, which reads the real composited stacking order rather than
the paint you were handed:

```js
const r = el.getBoundingClientRect();
document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
```

If that returns your element or a descendant, the pixels exist and you need a
different capture, not a fix. Reserve the lesson-18 verdict ("correct but
invisible") for when it returns something *else* — a scrim, a sibling, the body.

To get the shot, put the content at **scrollY 0**: reload its deep link directly
(`/partners/13#relationship-update-15`) if it has one, or temporarily
`display: none` the section's preceding siblings so it rises to the top, capture,
then undo — that changes nothing about the section you are signing off. Scrolling
to the top will not rescue the shot while a modal is open: `OverlayDialog` locks
body scroll on purpose, and that lock working is not the problem.
