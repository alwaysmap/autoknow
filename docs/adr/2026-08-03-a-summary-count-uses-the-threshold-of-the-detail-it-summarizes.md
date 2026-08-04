---
status: accepted
date: 2026-08-03
supersedes: ""
superseded-by: ""
extends: forecasts-derive-from-the-real-chain-never-a-synthetic-model
extended-by: ""
tags: [forecast, ui, critical-chain, sop, data-integrity]
---

# A summary count uses the threshold of the detail it summarizes, and a missed date is its own class

**Context.** `/ecosystem`'s "SOP at risk" tile read 1 across a 16-program seed, and
the one program it named was the only one whose buffer had gone fully negative. Four
others were holding less buffer than half the work still ahead — Goldratt's 50% line,
which this app already computes (`chainLedger.guidelineDays`) and already acts on:
`ProjectMetaHeader` paints their forecast date `--warn` and `chainLedger.register`
raises them to `plan`. So a program read **Some Risk** on its own page and was counted
**On Track** by the ecosystem tile whose entire job is to tally that question. The cause
was two branch sets over one question — `sop.sopForecastTone` (three tones, guideline
aware) and `sop.sopBufferCategory` (`buffer < 0`, guideline blind) — AGENTS lesson 7 in
its literal form, one file apart.

**Decision.** Two rules, and they are one rule seen from either end.

1. **A summary figure counts exactly what the detail surface flags.** Where a tile and a
   record page answer the same question, the threshold is computed once —
   `sop.sopBufferClass` — and every surface derives from it. A tile that applies its own,
   stricter test is not a summary; it is a second opinion wearing a summary's clothes.
   The 50% rule itself is `sop.guidelineFor`, so "50%" is one edit rather than a grep
   for `/ 2` across two modules.
2. **A date already missed is not a forecast, and gets its own class.** The SOP outlook
   is four classes, severity-ordered — `blown` (SOP passed), `late` (chain overruns a SOP
   still ahead), `atrisk` (buffer positive, under the 50% reserve), `ontrack` — each with
   its own label and ink. "At risk" previously meant all three at once.

The deep link and the count read one constant (`SOP_FLAGGED_CLASSES`), so the figure and
the rows behind it are the same set by construction rather than by two literals someone
keeps in sync.

**Alternatives rejected.**

- **Leave the tile strict and let the header be the loud one.** That is the status quo,
  and the status quo is a leadership surface under-reporting by 4× on the seed. A count
  nobody can reconcile with the pages beneath it is worse than no count.
- **One "at risk" class, just with the guideline added.** Cheaper, and it keeps the
  existing URL token — but it folds a date nobody hit in with a date we predict we will
  miss. Those are different briefings and prompt different actions; collapsing them is
  what made the original tile unreadable.
- **Give the header a fourth tone so tones and classes map 1:1.** The header renders a
  bare DATE; its ink can only carry severity, and there is no room to say which of two
  `--warn` conditions applies. Three tones over four classes, via one mapping table, is
  honest about that.
- **Raise `flagged > 0` to a `--bad` tile.** The figure mixes classes, so painting the
  whole number for its worst member overstates it. The missed-SOP count is broken out in
  the sub-line in `--bad` instead — the sharpest fact said plainly, without recolouring
  the other four.

**Consequences.** The tile's number rises (1 → 5 on the demo seed) and that is the point:
it now equals the number of programs whose own page says something is wrong. The old
`?sopOutlook=late` links keep resolving, but they now select a NARROWER set — programs
whose SOP is still ahead — because `blown` split out from underneath the token. Three
new i18n keys, four locales. This does not touch the *basis* of the forecast, which is
still `now + remaining chain work` and still cannot say when a program will actually land
(autoknow-7tg), nor the fact that the ledger and the portfolio compute two different
projected finishes (autoknow-9jd).

**The surfaces the first two passes missed are the receipt for rule 1.** This landed in
three commits, and the second and third exist because review found the SAME defect
further along the same rule — twice, inside the change that was fixing an instance of it
(AGENTS lesson 7, which is why it says *sweep before closing*):

- `SopOutlookCell` (the /ecosystem and /ecosystem-summary at-risk tables) still branched
  on the binary `sopOutlook().onTrack`. Its text stays the buffer in weeks — that is a
  quantity, and quantities are not verdicts — while its ink now comes from the class.
  The demo seed shows why the ink had to move: one program reads `≈10w buffer` in green
  and another reads `≈10w buffer` in amber, because ten weeks against twenty of chain
  and ten weeks against sixty are not the same program.
- `lib/summaries` built the AI brief's SOP clause the same binary way, so a thin-buffer
  program was described to the model — and then to a leader — as "reachable" while every
  screen in the app called it at risk. A brief that contradicts the page it summarizes is
  the most expensive version of this defect, because the reader has no way to see the
  disagreement.

The composition itself is now `sop.sopBufferClassFor(chainRemainingDays, sopDate, now)`:
the three lines that derive a buffer and a reserve from a program were being written per
call site, which is how the next site drifts.

**Receipts.** Diagnosed against the demo seed: `/programs` showed one `FORECAST LATE`
(Polaris EV Digital Key) and four `BUFFER LOW` that the tile had been counting as On
Track. Guards shipped alongside: `tests/sop.test.ts` (the four classes, the reserve taken
from the same chain days the buffer is, and `flagged` == the set `SOP_FLAGGED_CLASSES`
selects), `tests/sopForecastTone.test.ts` (the tone is a mapping of the class, not a
second branch set), `tests/home.spec.ts` (one seeded program per class, and the tile's
figure equals the rows its link reveals).
