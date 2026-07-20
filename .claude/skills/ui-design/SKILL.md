---
name: ui-design
description: Building or changing any AutoKnow UI/UX — components, pages, dialogs, tables, charts, styling, copy. Load BEFORE writing UI code.
---

# UI / UX work

**Read [docs/design.md](../../../docs/design.md) in full first** (~125 lines — it is
the law, not a suggestion): everything-is-a-URL, Tufte data-ink ratios,
percentage-free gauges/hill charts, 2-column detail grids, the table grammar
(§6: per-column funnels, shareable URL state, ISO dates), one-line facts (§7),
and the ✦ AI-provenance mark (§8).

## Rules that repeatedly caught agents here

- **Entity displays are links; entity inputs are pickers.** People →
  `/people/:id`, partners → `/partners/:id`. A field naming another entity is a
  `<select>` over existing rows + server-side resolution (`requireOwnerEmail` /
  `resolvePerson` in `src/lib/`), never free text (PR #11).
- **Hydration-safe browser state.** localStorage/matchMedia reads use
  `useSyncExternalStore` with a neutral server snapshot —
  `src/components/ThemeToggle.tsx` is the reference. setState-in-effect is a
  lint ERROR and will fail `npm run lint`.
- **CSS-module misses are silent.** `styles.notARealClass` renders as no class,
  no error. After fixing any styling defect, grep for sibling call-sites — the
  oversized-checkbox bug existed twice, differently, in two files (PR #12).
- **Every user-facing string goes through `t()`** (`src/lib/i18n.ts`, EN/DE/JA/KO).
  Adding UI text = adding a key with all four locales. Remove keys you orphan.
- **rem-first sizing (design.md §9).** All sizes in `rem`; `px` only for 1px
  hairlines/SVG strokes, SVG geometry, and media queries. Layouts must comply at
  360 / 768 / 1024 / 1440px viewports; the only breakpoints are `max-width: 960px`
  (collapse 2-col) and `max-width: 560px` (phone). Wide content scrolls in its
  own container — the page never scrolls horizontally. Convert stray px/breakpoints
  opportunistically in files you touch.

## Workflow

1. `npm run dev` (or the preview server) — build against the running app, and
   drive it in the browser freely: click the actual dialog, submit the actual
   form, read computed styles. Several past bugs passed tests and died on
   first real page load. (Deployed-app checks need the `alwaysmap.com`
   sign-in — identity rules in AGENTS.md.)
2. Verify visually in BOTH themes (`data-theme` light/dark) — tokens live in
   `globals.css`; components must not hard-code colors.
3. `npm run lint && npm run typecheck`.
4. e2e for behavior: `npm run test:e2e` — first interaction after a page load
   must be a hydration-guarded retry (`expect(async () => {...}).toPass()`
   pattern in `tests/project_details.spec.ts`); an unguarded first click is this
   suite's #1 flake source.
