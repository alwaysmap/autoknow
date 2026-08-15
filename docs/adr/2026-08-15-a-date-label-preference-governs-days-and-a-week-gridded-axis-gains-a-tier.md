---
status: accepted
date: 2026-08-15
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [dates, preferences, charts, ui]
---

# A date-label preference governs how a DAY is written; a week-gridded axis gains a tier

**Context.** Automotive programs are planned, committed and argued about in ISO calendar
weeks — a supplier promises CW22, not June 1 — and this app wrote every date as a date.
The ask (autoknow-dn8) was a per-user choice between date, date-and-week, and week alone.
The scope question is the hard part: "date" appears in this app as a table cell, a chart
axis tick, a marker caption, a stamp, a form echo, an AI briefing, and a seeded note, and
those are not one thing. The delivery question is nearly as hard: chart labels here are
laid out in JS (`estimateTextWidth` decides which axis ticks survive de-collision), so a
display preference is a **geometry** input, not a string swap.

**Decision.** Three rules.

1. **The preference governs how a DAY is written, and nothing else.** `dayLabel` in
   `lib/dates.ts` is the one function; every surface that names a day calls it. A label
   naming a MONTH is out of scope and keeps its own shape — the SOP target
   ("end of August 2026"), `ProgramTimeline`'s month axis, `ProjectMetaHeader`'s SOP
   line. A week number over a month-granular value would be a finer claim than the value
   supports. Generated prose (`lib/summaries`, `lib/seed`) is also out: it is stored
   content, not a per-reader label, and `tests/summaryProseDates.test.ts` already governs
   it (design.md §6).
2. **A week-gridded axis gains a WEEK TIER when the mode carries weeks — in both such
   modes, identically.** `ChainSchedule`'s columns already *are* ISO weeks, so the tier
   labels what is drawn. It sits nearest the plot (finest unit first, the nesting every
   Gantt header uses) and pushes the month letters down, growing the chart's height by a
   real 16 units. `date-week` and `week` render the same tier because the tier labels
   COLUMNS, not days; the two modes diverge only where a DAY is named (today's marker,
   the blown-buffer tick, the hover readout, the day strip).
3. **It is stored in a COOKIE, resolved server-side, distributed by a provider** —
   `DATE_LABELS` in the #31 registry, `lib/dateLabels.ts`, `DateLabelsProvider`. The two
   server components that render days (`LatestTeasers`, `PartnerProgramRows`) take it as a
   prop, exactly as they take `locale`.

**Alternatives rejected.**

* **localStorage + a pre-paint boot script**, like theme and style — killed by SSR. Those
  two resolve onto `<html>` as attributes CSS can act on; this one changes WORDS the
  server already rendered, so a client-only read repaints every date on the page one
  frame after hydration.
* **Render both forms and reveal one with CSS**, from a `data-date-labels` attribute —
  the same shape §8c mandates for style-conditional graphics. It solves SSR and needs no
  cookie, and it cannot work here: the CSS-hidden copy is measured by nobody, so
  `keepNonOverlapping` would thin the axis against text the reader is not being shown.
  Geometry has to know the mode, which means JS has to know it.
* **Applying the mode to every date-shaped string**, including the AI briefings — a brief
  is written once and read by everyone, so a per-reader format cannot reach it without
  re-generating it per reader.
* **Localizing the "W" prefix** (KW in German, 週 in Japanese) — `W22` is the ISO 8601
  designator, it is already this codebase's spelling in `isoWeekLabel`, and a
  locale-dependent width would make every chart's label boxes locale-dependent too. The
  picker's own OPTION labels are localized; the data is not.
* **Week numbers with no year anywhere** — rejected for CELLS, where a column of "W22"
  spanning 2018–2028 is unreadable, so `dayLabel(..., { year: true })` gives "W22 2026"
  wherever the date form carried a year. Kept for the AXIS, where the month letters below
  carry the frame and the existing month tier prints no year either.

**Consequences.**

* Adding a day-granular surface means calling `dayLabel`, not `localDate` — enforced for
  `DataTable` hosts by `tests/dataTableConvention.test.ts`, which now names `dayLabel` as
  the one legitimate date render.
* The ISO week and the ISO week-numbering YEAR travel together (`isoWeekParts`). They
  disagree at the turn of the year — 2024-12-30 is 2025-W01 — and a year taken from
  `getUTCFullYear()` names a week that does not exist.
* `DateCell`'s machine/reading-form split becomes a SWAP rather than a fixed pair: the
  `title` carries whichever half the visible text dropped (`dayLabelTitle`). `dateTime`
  stays ISO in every mode — a display preference may not reach the value assistive tech
  announces or a copy-paste yields.
* Chart sign-off now has a mode axis. `tests/labelCollisionSweep.test.tsx` §6 re-runs the
  crowding fixtures in all three modes; a new chart owes the same (AGENTS lesson 19).
* This deliberately gives up making the preference shareable in a URL. There is no
  `?dateLabels=` to match locale's `?lang=`: a link that silently rewrote how the
  recipient reads dates is the opposite of a per-user preference.

**Receipts.** Bead autoknow-dn8. Signed off from screenshots at 1440px and 360px, both
themes, across the seeded red/amber/green programs (`/programs/13`, `/programs/1`,
`/programs/6`) in all three modes, with per-label bounding boxes measured from real font
metrics in the browser rather than from `estimateTextWidth`: heights 334→350, 538→554 and
368→384, no label off-frame, and no collision introduced in any combination. The one
overlap that measurement did find — the blown-buffer tick's date printing through the
"% spent" reading — reproduces in the DEFAULT mode and is filed separately as
autoknow-lffd. Related: [ADR: Instants are stored in UTC and localized only at the point
of display](2026-07-29-instants-are-stored-in-utc-and-localized-only-for-display.md) —
`dayLabel` inherits that pin, so a week number cannot drift a day either side of midnight.
