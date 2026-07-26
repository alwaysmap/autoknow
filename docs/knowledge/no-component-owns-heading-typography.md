---
title: No component owns heading typography — every page module redeclares it, so headings drift page to page
status: current
updated: 2026-07-25
applies_to:
  - src/app/**/page.module.css
  - src/components/AnchorHeading.module.css
  - adding a section or card heading to a page
symptoms:
  - the same heading level looks different on two pages
  - a heading is uppercase, tinted or a different size from every other one
  - a CSS-module class on a heading appears to be ignored
verified_by: 'tests/headings.test.ts "no heading paints itself from the brand-green ramp" (fails on either instance if reintroduced); the /ecosystem + /partners/:id fix, 2026-07-25'
---

# No component owns heading typography — every page module redeclares it

**The lesson.** `AnchorHeading` owns the heading's MARKUP — the row, the `#` anchor, the
trailing graticule — and deliberately sets only `margin` and `line-height`
(`.row .heading`). It does not set font, size or colour. Those come from a **page-level
descendant rule** that each page module writes for itself: `.historySection h2`,
`.projectsSection h2`, `.helpSection h2`, `.section h2`, `.sectionHeader h2`. Four of
those agree on head-font 1.375rem/600 in `--fg`. Nothing makes them agree, and two had
already drifted: `/ecosystem`'s `.sectionHeader h2` and `/partners/:id`'s
`.sidebarCard h3` both painted themselves `var(--p-600)` — the brand green that
design.md §6 reserves for semantic positives (on track, early, saved).

**Why it bites.** Two mechanisms, and the second is the nasty one.

*Specificity.* A page rule like `.sectionHeader h2` is (0,1,1); `AnchorHeading`'s own
`.heading` is (0,1,0). The page wins any property they both declare — which is exactly
why `.row .heading` is written as two classes (0,2,0), a workaround its own comment
explains for margins. The typography properties have no such defence.

*Silence.* Because the shared component never declares a colour or a size, a page that
declares its own is not "overriding" anything a reader can see it fighting. There is no
conflict in DevTools, no losing rule struck through — just one page quietly dressed
differently, discovered by a human noticing a green heading months later. A green
heading is worse than a cosmetic drift: green is this app's *status* ink, so it paints a
health signal onto a label that has none.

**What to do.** When adding a section heading, copy the standard rather than inventing
one: `font-family: var(--head-font); font-size: 1.375rem; font-weight: 600;
color: var(--fg);`. For the smaller uppercase card/subsection heading, copy
`SummaryPanel.module.css .sectionTitle`: `0.6875rem / 700 / 0.05em uppercase /
var(--muted)`. Those two are the whole vocabulary — a third variant is a bug, and a
heading tinted from the `--p-*` ramp is always a bug.
`tests/headings.test.ts` enforces only that last part, because it is the one with no
legitimate case; the size/weight drift is still on review to catch.

**How we found out.** The user pointed at a green `PEOPLE` heading on `/partners/:id`
and said it should use the standard decoration. The sweep for `var(--p-600)` across
`src/**/*.css` found a second heading doing the same thing on `/ecosystem` — in the
empty state, so nobody with data in the app had ever seen it (AGENTS lesson 7).
