---
title: A table's spacing is set by bare element rules in globals.css, so the component's own module tells you the wrong number
status: current
updated: 2026-07-25
applies_to:
  - src/components/DataTable.module.css
  - src/app/globals.css
  - src/**/*.module.css
symptoms:
  - the gap you measure is much larger than the declarations you can find add up to
  - tuning the only margin in the component's module barely moves the gap
  - a padding declared in a module never takes effect and DevTools shows a different value
verified_by: 'issue #158: a declaration audit predicted 38px on /people/:id, getBoundingClientRect measured 54px; fixed by DataTable.module.css `.table { margin: 0 }`'
---

# A table's spacing is set by bare element rules in globals.css, not by its component's module

**The lesson.** `globals.css` styles the bare elements — `table { margin: 1.5rem 0 }`
and `th, td { padding: 0.875rem 1.125rem !important }`. Only the padding is documented
(design.md §1's "generous breathing room"); the `table` margin is written down nowhere,
which is part of why it goes uncounted. Both reach inside every component that renders a table,
`DataTable` included. So two of the largest numbers in any table's vertical
rhythm appear in **no component's CSS module**, and a third — `DataTable`'s own
`.th { padding: 0.75rem 1rem }` — was **dead**, silently outranked by that
author `!important`. Reading the module gave 12px where the browser rendered 14.

**Why it bites.** A bare element selector carries no class to grep for, so a
spacing audit that reads the component's module and its host's module finds
neither of them and confidently sums the rest. Worse, the `table` margin cannot
be reasoned away as margin-collapse: it renders *inside* `.tableWrapper`, which
establishes a block formatting context (`overflow-x: auto`), so it is 24px of
real space above the header row and 24px below the last one, every time. That
is why #112 tightened the only margin it could see (16px → 8px) and the filter
box still read as detached — 38px of the 46 was never in play.

**What to do.** Measure the rendered rects between the two things a *reader*
sees (the last line of the intro and the header text), with
`getBoundingClientRect`, before proposing any spacing change — then attribute
the difference with `getComputedStyle` on each box in between. Grep `globals.css`
for bare selectors on the element family you are touching (`table`, `th`, `td`,
`tr`, `a`, `button`) as part of that attribution. If a component must own its own
box, reset the global with a class in its module (`.table { margin: 0 }`) rather
than re-declaring the value somewhere else.

**How we found out.** #158 was filed with a careful three-row table of declarations
totalling 38px. The browser said 54. The attribution that reconciles:

| px | Source |
|---|---|
| 16 | `.sectionIntro` margin-bottom (10) and `.tableWrapper` margin-top (16) are adjacent siblings, so they **collapse** to the larger — not 26 |
| 24 | `table { margin: 1.5rem 0 }` in globals.css — invisible to the audit, and it CANNOT collapse out (BFC) |
| 14 | `th, td` padding-top in globals.css — the module's dead `.th` rule said 12 |

The issue was wrong three ways at once: it **summed** two margins that collapse, it
missed the global `table` margin entirely, and it read a padding from a rule that never
applied. Two of the three errors are invisible from the files it cited.
