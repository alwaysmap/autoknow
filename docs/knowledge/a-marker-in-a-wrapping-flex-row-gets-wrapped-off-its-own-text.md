---
title: A leading marker inside a wrapping flex row gets pushed onto a line of its own — flex breaks lines on max-content and prefers wrapping to shrinking
status: current
updated: 2026-08-03
applies_to:
  - src/**/*.module.css rules combining `display: flex` with `flex-wrap: wrap`
  - adding an icon, badge or status glyph before a run of text in a one-line-fact row (design.md §7)
symptoms:
  - an icon sits alone on a line with the text it marks pushed below it
  - the layout is correct at 1440 and wrong at 360, with no media query involved
  - setting `min-width: 0` or `flex-shrink` on the text changes nothing
verified_by: 'autoknow-2o9: the escalation urgency mark rendered inline on desktop and stranded on its own line at 360px in EscalationRows; fixed by taking the mark out of flow (position: absolute in a padding gutter), screenshotted at 360 both before and after'
---

# A leading marker inside a wrapping flex row gets wrapped off its own text

**The lesson.** In a `display: flex; flex-wrap: wrap` row, adding a small marker
before a long text item does **not** give you "glyph, then text wrapping beside
it". Once the text is long enough to need more than the remaining space, the
whole text item moves to the next line and the marker is left alone on the first
one — pointing at nothing. It looks like a width bug and is not: the same markup
is correct at desktop width and broken at 360px, with no media query anywhere.

**Why it bites.** Flex collects items into lines using each item's **outer
hypothetical main size** — its `flex-basis`, which for `auto` is its
**max-content** width. Shrinking happens *after* items are assigned to a line, so
a wrapping container prefers to wrap an item rather than squeeze it. This is why
the fixes people reach for first all fail: `min-width: 0` permits shrinking but
does not reduce the hypothetical size, so it cannot change which line the item
lands on, and `flex-shrink` is never consulted because the item was never on that
line to begin with. `flex-basis: 0` does fix the line-breaking — and breaks the
layout differently, because the item now grows to fill the line and pushes
everything after it down.

**What to do.** Take the marker **out of flow**. Open a gutter on the row with
`padding-left` and hang the marker in it:

```css
.row  { position: relative; padding-left: 1.125rem; display: flex; flex-wrap: wrap; }
.mark { position: absolute; left: 0; top: 0.3125rem; }   /* (line-height − mark height) / 2 */
```

An out-of-flow marker cannot be wrapped away from what it marks, every row starts
on the same vertical edge whether or not it has one, and wrapped continuation
lines align under the text rather than under the glyph. Set `top` from the FIRST
line's box, not by centring on the row: a statement that wraps to three lines
should keep its marker beside the line it starts on. While you are in a wrapping
row, check `gap` too — one `gap` serves both axes, so a row whose own wrapped
lines sit as far apart as its siblings reads as two records rather than one
(`column-gap` / `row-gap` separately, with row-gap tighter than the list's).
