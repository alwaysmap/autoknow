---
name: ui-design
description: Building or changing any AutoKnow UI/UX — components, pages, dialogs, tables, charts, styling, copy. Load BEFORE writing UI code.
---

# UI / UX work

**Read [docs/design.md](../../../docs/design.md) in full first** (~125 lines — it is
the law, not a suggestion): everything-is-a-URL, Tufte data-ink ratios,
percentage-free gauges/hill charts, 2-column detail grids, the table grammar
(§6: per-column funnels, shareable URL state, `PersonCell`, and `DateCell` —
ISO in `dateTime`, locale-short visible), one-line facts (§7),
and the ✦ AI-provenance mark (§8).

**Before styling, check the findings.** [docs/knowledge/](../../../docs/knowledge/README.md)
carries notes triggered by `src/**/*.module.css`, `src/components/**`, and
symptoms like "right classes, wrong position". List the directory and read the
slugs; open only the few that match what you are about to touch.

## Rules that repeatedly caught agents here

- **Reach for the existing component before you build a new one.** This app has a
  deliberate set of shared UI primitives; a fresh near-duplicate silently re-opens
  the exact bugs the shared one already killed. Scan `src/components/` first — a
  genuinely reusable primitive announces itself in its header comment ("the ONE …",
  "the shared grammar/home/look"). The load-bearing ones: **`AnchoredPopover`** (any
  trigger→anchored panel — menus, filter popups; it flips + clamps so nothing opens
  off-screen), **`KebabMenu`** (the ⋯ header menu, built on it), **`DataTable`**
  (sortable, per-column funnel filters, shareable URL state — design.md §6),
  **`AnchorHeading`** (a deep-linkable `<h2>` with an `actions` slot for its ⋯/ⓘ),
  **`StatTile`** (the ecosystem-strip figure grammar, §1/§7), **`SearchField`** (the
  one live-filter box look), **`DateCell`** (ISO + calendar-week-on-hover),
  **`PhaseInvolvementEditor`** (changing WHO is on a phase — partner or person, chips
  + picker + role, on any of the three surfaces that offer the edit), and
  **`OverlayDialog`** (every modal — it owns `max-height`, the single scroll region,
  the body-scroll lock and one dismiss contract). That these were worth consolidating
  is recorded in their own headers: `AnchoredPopover` replaced FOUR hand-rolled
  popovers (two opened off-screen at ordinary widths), `SearchField` replaced THREE
  drifted copies of one input, `PhaseInvolvementEditor` replaced THREE (only one of
  which said why a section was empty, and none of which could show a server refusal),
  and `initialsOf`/avatars each had two divergent copies.
  If a primitive is close but not exact, **add a prop — never fork it.** This is
  AGENTS lesson 7's creation-side twin: the fix for "the same control exists in three
  hand-rolled variants" is to not author the third.

  The cost is not hypothetical and not historical. `PhaseTrack` hand-rolled its own
  scrim + popover **while already importing `OverlayDialog` forty lines away** for its
  legend — and the hand-rolled one had no `max-height`, so it ran off the bottom of
  the viewport and put a second scrollbar on the page. A user reported it; the fix was
  deleting 47 lines of CSS and an entire `useEffect` that re-implemented Escape and the
  body-scroll lock (`autoknow-wja`).
- **A menu item that navigates needs NOTHING from you** — render a plain `<Link>`.
  `AnchoredPopover` dismisses on a link activation that replaces the page, and only on
  that; buttons and server-action forms still keep the panel open, which is the rule the
  component exists to protect. Adding `onClick={close}` to a link is re-authoring the
  variant that caused `autoknow-6mn`
  ([ADR: Navigation is the one inner activation that dismisses a popover](../../../docs/adr/2026-07-26-navigation-is-the-one-inner-activation-that-dismisses.md)).
- **Scrolling the PAGE goes through `useSteadyPageScroll` (`src/lib/useSteadyPageScroll.ts`).**
  `html { scroll-behavior: smooth }` makes every document scroll an animation, and one
  whose frame lands between a press and its release hands that click to a common
  ancestor — the handler never runs and nothing errors
  ([note](../../../docs/knowledge/a-page-scroll-between-press-and-release-loses-the-click.md)).
  An inner scrollport (a listbox keeping its option in view) is instant and needs none
  of this.
- **Entity displays are links; entity inputs are pickers.** People →
  `/people/:id`, partners → `/partners/:id`. A field naming another entity is a
  `<select>` over existing rows + server-side resolution (`requireOwner` /
  `resolvePerson` in `src/lib/`), never free text (PR #11).
- **Section affordances ride INSIDE the heading.** A ⓘ, ⋯ menu or any control
  belonging to an `<h2>` goes through `AnchorHeading`'s `actions` prop — never as
  a sibling of `<AnchorHeading>`. The heading row ends in a `::after` graticule,
  so a sibling renders after the rule: the control is flung to the far right and
  its popup opens off the container's edge (design.md §8c, third trap).
- **Identity is never a literal, and never re-derived at the call site.** "Me" comes
  from `getCurrentUser()`, and resolution uses `.email` — `.display` drops the domain,
  so `deriveEmail()` on it silently rewrites the address. `CurrentUser` carries every
  field the UI shows, so reaching into `session.user.*` for one is a lint error
  ([ADR: The signed-in session is the only source of "who I am"](../../../docs/adr/2026-07-21-session-is-the-only-source-of-who-i-am.md)).
- **Avatars: initials from `initialsOf` (`src/lib/people.ts`), never a local copy.**
  First + LAST name initial ('Dylan V. Thomas' → DT); a single-token name keeps its
  first two characters. Two divergent copies of this already existed. The signed-in
  user's photo comes from `/api/me/avatar`, never a googleusercontent URL
  ([ADR: Third-party images are proxied through our origin; `img-src` stays `'self'`](../../../docs/adr/2026-07-21-proxy-third-party-images-keep-csp-self.md));
  initials are the resting state, the photo an enhancement that may fail to load.
- **A correct element you cannot see is a bug, and the DOM will not tell you.**
  Three rail-overlay defects in a row rendered valid geometry with valid classes —
  a scripted audit counted 15 right-looking elements that were invisible (INK
  dashes over an already-INK line). Sign off any overlay, band, glow or animation
  from a SCREENSHOT in both themes; counting elements proves existence, not
  visibility. Same rule for direction: derive it from the data, never from the
  order a path happens to be authored in
  ([ADR: A semantic overlay derives from the data it means, never from the layer beneath](../../../docs/adr/2026-07-21-semantic-overlays-derive-from-data-not-from-the-layer-beneath.md)).
- **Chart text may never overlap anything — that is a blocking defect, not polish.**
  Every SVG `<text>` whose x or y comes from a datum goes through
  `src/lib/labelPlacement.ts` before it renders (`estimateTextWidth` for `halfW`,
  `baselineToCentreY`/`centreToBaselineY` because SVG places text by its BASELINE and
  the module reasons about box centres). **Which strategy is a SEMANTIC call:**
  `keepNonOverlapping` HIDES the loser — acceptable only where the reader still recovers
  the value from a scale — while `dodgeLabels` NUDGES in y and keeps every label, which
  is what a distinct fact requires — a per-bar variance, a phase name. Hand `dodgeLabels`
  the INK as well — gridlines, thresholds, boundary polylines as `inkBox`, never their
  tick captions: a caption is a ~30px box in the left gutter, so nothing inside the plot
  can ever overlap it in x and the pass reports success over a label printed straight
  through the rule. Never resolve a collision by shrinking type (chart sizes were raised
  once for legibility, #83), and ship the crowding fixture in the same PR — the dataset
  that crowds is the *healthy* one, so the demo seed never shows it to you. Sign off from
  a SCREENSHOT in both themes: the de-collision tests agreed with the bug for months,
  because they were built from the same wrong boxes. The two notes carry the mechanics —
  [label-on-label](../../../docs/knowledge/a-chart-labels-crowding-case-is-usually-the-healthy-dataset.md)
  and [label-on-ink](../../../docs/knowledge/a-placement-pass-clears-labels-not-the-ink-you-did-not-pass.md) —
  and `CapacityChart`/`CycleTimeScatterPlot` still clear their ink by arithmetic alone
  (bead `autoknow-fs3`). AGENTS lesson 19.
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

   **Seeded demo in one command: `npm run demo`** — a per-worktree
   `autoknow_<token>_demo` DB, schema synced, `next dev` with a stub signed-in
   identity, mock data seeded via the app's own API routes, on a per-worktree
   port ~3600 (`--reseed` to refresh). That is the whole recipe below, scripted;
   reach for it first. `scripts/dev/demo.ts` is the source of truth for the env.

   **A demo you need to OUTLIVE the current step goes under `preview_start`, not
   a background shell job.** A backgrounded `npm run demo` dies with its task and
   takes the server with it — which is silent until a later page load returns a
   blank screen, and is indistinguishable from "my change broke the page" (it cost
   a subagent a chunk of its verification here). Point `.claude/launch.json` at
   THIS worktree's demo DB + port and `preview_start` it. That file is gitignored
   BECAUSE it is per-worktree: a checked-out copy naming another worktree's
   `autoknow_<token>_demo` is stale — derive the pair the way `scripts/dev/demo.ts`
   does (sha1 of the checkout path) rather than trusting what is in the file.

   **Worktree preview recipe** — what `npm run demo` automates, and the path an
   AGENT uses when it can't hold a foreground server (drive via `preview_start`
   + `.claude/launch.json`): run the dev server with
   `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` set EMPTY (unconfigured auth = stub
   signed-in identity, no Google login) and `DATABASE_URL` pointed at a
   **scratch DB you create** — `CREATE DATABASE x` + `npm run db:migrate:deploy`,
   then seed by POSTing `{"mode":"mock"}` to `/api/admin/seed` on the running
   server (CLI `db:seed` can't: the seed runs through the API routes +
   `server-only`), with `DESTRUCTIVE_DB_ALLOWED=<scratch-db>` set so the wipe
   guard passes. NEVER this worktree's own `*_test` DB (e2e wipes it mid-demo —
   AGENTS lesson 9; the e2e DB/port are now per-worktree, see
   `tests/helpers/worktree`). Ports: :3000 dev default, :3100 long-lived demo.
   **e2e reserves a per-worktree BLOCK OF EIGHT — one per worker — somewhere in
   3130–3529**, derived from a hash of the checkout path (`testServerPort`), so
   "~3130" is NOT where yours is, and a literal here would be wrong for your
   checkout too — print your own block before choosing:
   `npx tsx -e "import {testServerPort} from './tests/helpers/worktree'; console.log([0,1,2,3,4,5,6,7].map(testServerPort))"`
   — and put the preview OUTSIDE 3130–3529 entirely (3600+ is safe). A preview
   parked on one of those eight does not fail loudly: Playwright dies with "port is
   already used", which reads as a stuck server rather than as your own preview.
   `NEXT_DIST_DIR` resolves RELATIVE to the project root even
   when absolute — use a short name like `.next-preview` and delete it after;
   `git checkout tsconfig.json` afterward (Next appends dist types to it).
   Fresh worktrees need `npm ci` first — and ONLY that: its postinstall links
   `.env` from the main checkout (a worktree cannot inherit a gitignored file,
   `scripts/dev/link-env.sh`) and generates the Prisma client.
   `launch.json` has no env field, so inject the vars by making the command
   `env` itself: `runtimeExecutable: "env"` with the assignments as leading
   `runtimeArgs` before `npm run dev -- -p <port>`.
2. Verify visually in BOTH themes (`data-theme` light/dark) — tokens live in
   `globals.css`; components must not hard-code colors. The BROWSER is the one
   thing in the chain that is NOT per-worktree, and a tab pointed at another
   worktree's server screenshots that worktree's code
   ([note](../../../docs/knowledge/preview-browser-tab-can-move-to-another-worktrees-server.md)) —
   read `location.origin` from inside the page in the same call that collects the
   data you are signing off.
3. `npm run lint && npm run typecheck`.
4. e2e for behavior: `npm run test:e2e` — first interaction after a page load
   must be a hydration-guarded retry (`expect(async () => {...}).toPass()`
   pattern in `tests/project_details.spec.ts`); an unguarded first click is this
   suite's #1 flake source. Tapping/clicking a date-driven SVG chart (e.g.
   `ChainSchedule.tsx`) at a fixed pixel offset can land on empty axis lead-in
   rather than real data — [note](../../../docs/knowledge/a-week-floored-chart-axis-can-start-before-its-first-real-data.md).
