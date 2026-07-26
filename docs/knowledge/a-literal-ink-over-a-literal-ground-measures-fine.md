---
title: A literal ink over a literal ground measures fine — both are wrong, and they cancel
status: current
updated: 2026-07-25
applies_to:
  - src/components/**/*.tsx
  - src/**/*.module.css
  - src/app/globals.css
  - tests/contrast.spec.ts
symptoms:
  - a chart or badge looks like a light-theme drawing pasted onto the dark page
  - the ink measures well against the shape under it, yet the area is obviously the wrong lightness
  - grepping for '#fff' / '#000' / 'white' finds nothing and the colour bug is still there
verified_by: 'tests/contrast.spec.ts "the vehicles line reads on the AAOS band it rides on" — mutation-checked: restoring #dcd8cd reports 1.20:1 (standard/dark) and 1.21:1 (instrument/dark); bead autoknow-vxx'
---

# A literal ink over a literal ground measures fine — both are wrong, and they cancel

**The lesson.** design.md §8b's warning is written around `fill="#fff"`, so the
sweep everyone runs is a grep for white and black. The literals that survive that
sweep are the **mid-tones** — `hsl(0, 0%, 25%)`, `#dcd8cd` — because they look
like a deliberate choice in either theme and name no colour you would search for.
And when a literal ink is painted onto a literal ground, the PAIR is
self-consistent: measure the two against each other and you get a healthy number
while the whole region is a light-theme drawing sitting on a dark page.

**Why it bites.** It defeats both halves of the usual check. A token-contrast
test compares tokens, and a literal is not a token, so it is invisible to the
gate. A spot measurement of ink-against-what-is-under-it passes, because both
sides moved together. CapacityChart drew its vehicles line in a literal mid-grey
on a literal near-white AAOS band: 7.28:1, on a near-black page. Worse, the two
errors protect each other — tokenising the ink ALONE would have put near-white
`--fg` on that same near-white band at **1.21:1**, trading a visible defect for
an invisible one and looking like a regression caused by the fix.

**What to do.** Sweep for the colour SYNTAX, not for known-bad values:
`grep -rnE "#[0-9a-fA-F]{3,8}\b|hsla?\(|rgba?\(" src/components src/**/*.module.css`
— anything outside `globals.css` is suspect, whatever its lightness. When you
tokenise one, tokenise everything it is drawn on or under in the same commit, and
add the pair to `tests/contrast.spec.ts` rather than trusting the eye a second
time. Then sign off from a screenshot in both themes (AGENTS lesson 18): the
number tells you the pair is separated, only the picture tells you the region
belongs to the theme it is in.

**How we found out.** The AAOS band label shipped as `hsl(0, 0%, 25%)` and
measured 1.54:1 on dark paper — caught by eye in a dark-theme screenshot during
the #161 label sweep, months after `tests/contrast.spec.ts` was written to stop
exactly this class of bug. The test was fine; the colour was simply not a token,
so there was nothing for it to check.
