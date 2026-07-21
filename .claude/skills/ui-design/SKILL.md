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
- **Section affordances ride INSIDE the heading.** A ⓘ, ⋯ menu or any control
  belonging to an `<h2>` goes through `AnchorHeading`'s `actions` prop — never as
  a sibling of `<AnchorHeading>`. The heading row ends in a `::after` graticule,
  so a sibling renders after the rule: the control is flung to the far right and
  its popup opens off the container's edge (design.md §8c, third trap).
- **Identity is never a literal, and never re-derived at the call site.** "Me" comes
  from `getCurrentUser()`, and resolution uses `.email` — `.display` drops the domain,
  so `deriveEmail()` on it silently rewrites the address. `CurrentUser` carries every
  field the UI shows, so reaching into `session.user.*` for one is a lint error
  ([ADR 0005](../../../docs/adr/0005-session-is-the-only-source-of-who-i-am.md)).
- **Avatars: initials from `initialsOf` (`src/lib/people.ts`), never a local copy.**
  First + LAST name initial ('Dylan V. Thomas' → DT); a single-token name keeps its
  first two characters. Two divergent copies of this already existed. The signed-in
  user's photo comes from `/api/me/avatar`, never a googleusercontent URL
  ([ADR 0006](../../../docs/adr/0006-proxy-third-party-images-keep-csp-self.md));
  initials are the resting state, the photo an enhancement that may fail to load.
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
   `tests/helpers/worktree`). Ports: :3000 dev default, :3100 long-lived demo,
   e2e is a per-worktree port ~3130 — pick something else for the preview.
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
   `globals.css`; components must not hard-code colors.
3. `npm run lint && npm run typecheck`.
4. e2e for behavior: `npm run test:e2e` — first interaction after a page load
   must be a hydration-guarded retry (`expect(async () => {...}).toPass()`
   pattern in `tests/project_details.spec.ts`); an unguarded first click is this
   suite's #1 flake source.
