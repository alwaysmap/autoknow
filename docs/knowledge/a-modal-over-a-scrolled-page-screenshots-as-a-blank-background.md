---
title: A modal opened over a scrolled page screenshots as a blank background — the capture misses the top layer, the element is fine
status: current
updated: 2026-07-26
applies_to:
  - verifying an OverlayDialog / <dialog> from the Browser pane
  - signing off a popover reached from a link far down a long page
symptoms:
  - the screenshot is one flat expanse of page background and nothing else
  - the DOM says the dialog is open, position fixed, visibility visible, opacity 1
  - the same dialog screenshots correctly when the page is scrolled to the top
verified_by: '#111 partner-health popover, feed row at scrollY 1019: elementFromPoint(640,360) returned the dialog''s history list while two consecutive screenshots came back blank; the identical dialog captured fine at scrollY 0 in both themes'
---

# A modal over a scrolled page screenshots as a blank background

**The lesson.** A native `<dialog>` opened with `showModal()` renders in the
browser's **top layer**, outside the normal paint tree. When the page underneath
is scrolled away from the origin, the Browser pane's capture can come back as a
uniform block of `--bg` with neither the dialog nor the page content in it. The
element is not invisible and nothing is wrong with your CSS — the *capture*
missed a layer. Scroll to the top (or open the same URL fresh) and the identical
dialog photographs perfectly.

**Why it bites.** It inverts the repo's own sign-off rule, and inverts it in the
most expensive direction. AGENTS lesson 18 says to trust the SCREENSHOT over
element counts, because three defects in a row rendered valid geometry that was
invisible. Here the screenshot is the thing that lies, so an agent who follows
the rule faithfully concludes the popover does not render, and goes looking for a
bug in a component that works. The two cases are genuinely hard to tell apart
from the image alone, because "correct element you cannot see" and "correct
element the camera missed" produce the same flat rectangle.

**What to do.** Distinguish them with a **hit test**, which reads the real
composited stacking order rather than the paint you were handed:

```js
const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
document.querySelector('dialog[open]').contains(el)   // true ⇒ it is really on screen
```

If that is `true`, the pixels exist and you need a different capture, not a fix:
reload the deep link directly (`/partners/13#relationship-update-15`) so the page
opens at scrollY 0, and sign off from that. Reserve the lesson-18 verdict
("correct but invisible") for when the hit test returns something *else* — a
scrim, a sibling, the body — which is what a genuinely occluded or zero-sized
element does. Note that `document.documentElement.scrollTop = 0` will not rescue
the shot while the dialog is open: `OverlayDialog` locks body scroll on purpose,
and that lock working is not the problem.
