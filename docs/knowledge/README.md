# Knowledge notes — things this system taught us the hard way

A knowledge note records **a fact about how this system actually behaves** that
cost someone real time to discover, so the next person pays for it once instead
of every time. Not a decision (that is an [ADR](../adr/README.md)) and not a
rule (that is AGENTS.md or a skill) — a *finding*.

The test: **"I lost an hour to this, and nothing in the repo would have warned
me."** If a test, a type, or a lint rule could enforce it instead, write the
enforcement — an enforced fact needs no note (AGENTS lesson 2).

## The contract: front matter is the interface, the body is the payload

These notes exist to be **absent from context until they earn their way in**.
AGENTS.md is loaded into every session, so every line there taxes every session
forever; a knowledge note costs nothing until someone matches it. That asymmetry
is the entire design, and it only works if you can decide *whether to read a note
without reading it*.

So the front matter carries the two retrieval keys, and nothing decorative:

```yaml
---
title: The lesson itself, stated as a claim you could act on
status: current                      # current | superseded | retired
updated: 2026-07-22                  # living document — this is the reader's staleness signal
applies_to:                          # WHAT YOU ARE ABOUT TO TOUCH — matched while planning
  - src/**/*.module.css
symptoms:                            # WHAT YOU ARE SEEING — matched while stuck
  - element has the right classes but renders in the wrong place
verified_by: tests/usability.spec.ts "the dial reports the SEARCH"; PR #20
---
```

* **`applies_to` and `symptoms` are triggers, not topics.** A tag like `css` is
  useless for retrieval, because nobody goes looking for "a note about CSS" —
  they are editing a file, or staring at a symptom. Write the condition under
  which this note would have saved you.
* **`verified_by` is mandatory.** A finding with no receipt is folklore, and
  folklore is exactly what these replace.
* **`updated` + `status`, because docs state their status or they lie**
  (AGENTS lesson 10). A note whose subject was fixed upstream becomes
  `retired` — it is not deleted, because "we used to have to do X, and no longer
  do" is itself worth knowing.

## How to use them

1. **Planning a change**: scan the index below for rows whose trigger overlaps
   what you are about to touch. Open only those.
2. **Stuck on a surprise**: grep the `symptoms:` blocks —
   `grep -A4 '^symptoms:' docs/knowledge/*.md`.
3. **Never bulk-read this directory.** If you find yourself opening every note,
   the index rows are too vague — fix the rows.

## Notes vs. ADRs: living vs. immutable

| | ADR | Knowledge note |
|---|---|---|
| Records | a decision, with alternatives rejected | a finding about how things behave |
| Filename | `YYYY-MM-DD-slug.md` — dated | `slug.md` — **never dated** |
| Changes | never; a reversal is a NEW record | edited in place as understanding improves |
| Identity | the slug, cited by prose forever | the slug |

The date prefix is the visible marker of that difference: an ADR is a historical
act and carries the day it happened; a note is current understanding and carries
`updated:` instead. `tests/knowledgeNotes.test.ts` enforces the shape, the
required front matter, the index, and the length cap.

## Index

| Lesson | Load it when… |
|---|---|
| [A CSS-module class cannot win a `display` fight with a global `[data-*]` rule](css-module-loses-display-to-global-attribute-rule.md) | editing a `*.module.css` rule on an element that also carries a global `data-` attribute, or an element is correctly classed but mispositioned |
| [A global `[class*="foo"]` selector styles any CSS-module class whose name contains "foo"](global-class-substring-selector-catches-module-classes.md) | naming a new `*.module.css` class, or an element shows card/border/padding chrome no rule in its own module declares |
| [A table's spacing is set by bare element rules in globals.css, so the component's own module tells you the wrong number](table-spacing-comes-from-globals-not-the-module.md) | auditing or tuning the space around a table, or a measured gap is far larger than the declarations you can find add up to |
| [A container that normalizes children with descendant selectors also restyles a `<dialog>` nested inside it](menu-row-normalizer-restyles-nested-dialogs.md) | rendering a modal from inside a menu/popover, or a dialog's buttons are full-width, stacked and chromeless while the element has the right module class |
| [No component owns heading typography — every page module redeclares it, so headings drift page to page](no-component-owns-heading-typography.md) | adding a section or card heading to a page, or the same heading level looks different on two pages (tinted, uppercase, another size) |
| [A test that hard-codes the same answer the code hard-codes always passes](a-test-sharing-the-codes-hard-coded-answer-passes.md) | sweeping for fabricated/placeholder values, or a surface never changes with the data yet its test is green |
| [A lazy regex over a JSX opening tag stops at the first arrow function](source-scan-over-jsx-props-truncates-at-an-arrow.md) | writing a source-scan ratchet that reads component props, or a new guard passes immediately and keeps passing when you plant a violation |
| [Terraform authenticates as the app's service account, because `.env` sets GOOGLE_APPLICATION_CREDENTIALS](env-service-account-key-hijacks-terraform.md) | running terraform (or any Google CLI) from this repo — or a 403 names a service account you did not choose and says the bucket "may not exist" |
| [A server-action `redirect()` did not navigate the tab under `npm run demo`, while the prod build did](demo-server-does-not-follow-server-action-redirects.md) | verifying a form or mutation flow in `npm run demo` — or a submit leaves the page unchanged while the row it created is already in the database |
| [A machine-called endpoint needs three things in `src/proxy.ts`, not one](machine-endpoint-needs-exemption-and-credential.md) | adding or debugging an endpoint called by cron, a scheduler, Google, or curl — or a non-browser caller is getting redirected to `/login` |
| [Without a real embedding model, every "semantic" score is the same ~0.75 pedestal — noise, not signal](fallback-embedding-is-a-uniform-pedestal-not-signal.md) | touching search ranking in `src/lib/search.ts`, or search returns unrelated entities deep in the list (noisy in dev/demo, fine in prod) |
| [An explicit ARIA role replaces a native element's implicit role](aria-role-replaces-the-implicit-searchbox-role.md) | adding combobox/autocomplete ARIA to a search input, or `getByRole('searchbox')` times out / a debounced fetch "never fires" in e2e but works when you drive the page by hand |
| [A Postgres service container reports healthy before it accepts TCP — the DB layer must retry the connect](db-service-container-econnrefused-needs-connect-retry.md) | touching the CI DB service (`ci.yml`) or a `pg.Pool` (`src/lib/pgPool.ts`, `src/lib/db.ts`, `tests/helpers/db.ts`), or CI fails with `ECONNREFUSED`/`ECONNRESET` on an innocent change and re-runs green |
| [A viewBox-scaled SVG's type size is its container's width times a constant](svg-chart-type-size-is-container-width-times-a-constant.md) | changing sizes inside any `viewBox` chart (`PhaseHillChart`, `PhaseHillGauge`, `lib/hillLayout.ts`), or chart labels/dots read far bigger or smaller than the page type around them |
| [The preview browser tab is shared across worktrees and can move to another one's dev server mid-session](preview-browser-tab-can-move-to-another-worktrees-server.md) | verifying UI in the Browser pane from a worktree (`.claude/launch.json`, `npm run demo`), or a screenshot shows the pre-change behaviour while the tests are green |
| [A static `src/` import in a test is hoisted above the test's own env setup](static-src-import-in-a-test-preempts-its-env-setup.md) | writing a `tests/**/*.test.ts` that sets `GEMINI_API_KEY`/`DATABASE_URL` before importing `src/`, or a "deterministic no-key" test is seconds-slow, hits the network, or reports a JSON syntax error naming its own fixture text |
| [Editing a migration you already applied locally wedges the shared dev DB](edited-an-applied-migration-revert-and-reapply-never-reset.md) | about to edit a `prisma/migrations/**` file you have already run `db:migrate` on, or prisma says a migration "was modified after it was applied" and offers `migrate reset` |
| [`git checkout <file>` reverts a mutation and your uncommitted fix with it](git-checkout-reverts-a-mutation-and-your-fix-with-it.md) | mutation-testing a new guard, or the baseline run after restoring a mutation is still red and nothing explains it |
| [A fresh worktree has no `.env`, and the suite blames your diff for it](a-fresh-worktree-has-no-env-and-blames-your-diff.md) | running `npm test` for the first time in a new worktree, or one test fails in the full suite but passes alone and looks "pre-existing" |
| [A chart label placed at a data-derived coordinate collides on the HEALTHY dataset](a-chart-labels-crowding-case-is-usually-the-healthy-dataset.md) | adding or moving any SVG `<text>`/`<ChartLabel>` whose x or y comes from a datum (`CapacityChart`, `CycleTimeScatterPlot`, `ChainSchedule`, `lib/labelPlacement.ts`), or two captions print on top of each other / a label lands outside the plot |
| [A placement pass clears the labels you pass it, never the ink you didn't](a-placement-pass-clears-labels-not-the-ink-you-did-not-pass.md) | adding a gridline, threshold, boundary or crosshair to a chart that also places labels (`lib/labelPlacement.ts`, `ChainSchedule`, `CapacityChart`, `CycleTimeScatterPlot`), or a rule runs through a label / a label sits pinned on the line it was placed a fixed offset from, while every de-collision test is green |
| [A literal ink over a literal ground measures fine — both are wrong, and they cancel](a-literal-ink-over-a-literal-ground-measures-fine.md) | tokenising a colour in `src/components/**` or `globals.css`, or a chart/badge looks like a light-theme drawing pasted onto the dark page while the ink measures fine against what is under it |
| [CI wall clock is ONE job's critical path — measure per-step before optimizing anything](ci-wall-clock-is-one-job-find-it-before-optimizing.md) | about to edit `.github/workflows/ci.yml` to make CI faster or cheaper, or a PR takes ~6 minutes to go green and you do not know which step owns it |
| [An out-of-disk CI runner fails as whatever test it happened to be running](an-out-of-disk-runner-fails-as-the-test-it-was-running.md) | about to change the e2e job's disk guard, its thresholds or its reclaim step, about to re-run a red browser/e2e check, or one leg is red while every other job is green and its log just stops with no assertion |
| [A fixture whose point is "this is scheduled" must DERIVE the date from seed time](a-literal-future-date-in-a-fixture-expires.md) | seeding a future-dated row (`src/lib/seed.ts`, `tests/helpers/fixtures.ts`), or a "scheduled"/"incoming" demo case has quietly stopped demonstrating anything |
| [A shared function whose default reads `process.env` silently uses the FALLBACK inside a client component](an-env-derived-default-is-the-fallback-inside-a-client-component.md) | giving a `src/lib` function an env-derived default parameter, or adding a server-only env var that a page must also reflect — or the number the UI plots disagrees with the one the server enforces, with no error anywhere |
| [A server action a component fires on mount is on the PAGE's critical path — and its 500 is logged against the page URL](a-server-action-a-component-auto-fires-is-on-the-pages-critical-path.md) | writing or calling anything in `src/app/actions/**` from a `useEffect`/`startTransition`, or a page shows "This page couldn't load" while its GET returns 200 |
| [A Prisma back-relation has its own name, so grepping the forward field misses every reader on the other side](a-prisma-back-relation-hides-the-field-you-are-grepping-for.md) | sweeping every reader of a field before changing or deprecating it (`prisma/schema.prisma`), or a grep-driven sweep looked complete and a surface with the same bug survived it |
| [A modal over a scrolled page screenshots as a blank background — the capture misses the top layer](a-modal-over-a-scrolled-page-screenshots-as-a-blank-background.md) | signing off an `OverlayDialog`/`<dialog>` from the Browser pane, or a screenshot is one flat expanse of page background while the DOM says the dialog is open and positioned in the viewport |
| [A page scroll that steps between press and release hands the click to an ancestor](a-page-scroll-between-press-and-release-loses-the-click.md) | adding anything that scrolls the document from a click (`scrollIntoView`, an in-page `#hash` link) or writing a spec that clicks one surface twice, or a click reported as successful leaves the state untouched and only under full-suite load |
| [A hydration-guarded retry whose body navigates strands itself on the destination page](a-retry-loop-that-navigates-strands-itself-on-the-destination.md) | wrapping a click that NAVIGATES in `expect(async …).toPass()`, or a guard times out naming a control the page it is now on correctly does not have |
| [A ts-node script can import `src/lib` — but only with a CommonJS `--compilerOptions` override](a-ts-node-script-cannot-import-src-lib-without-a-compileroptions-override.md) | adding an npm script under `scripts/**` that wants to reuse application logic, or `ERR_MODULE_NOT_FOUND` names a real `src/lib` file and adding `.ts` turns it into TS5097 |
| [A seeded row whose author is 'seed' is invisible to every person-scoped surface](a-fixture-sourced-to-seed-is-invisible-to-every-person-scoped-surface.md) | building anything that filters by WHO recorded a row (`src/lib/activity.ts`, `src/lib/seed.ts`), or a person page's Activity section is empty in the demo while the program and partner feeds are full |
| [A test database built by `prisma db push` silently lacks every constraint Prisma cannot express](db-push-silently-drops-constraints-prisma-cannot-express.md) | hand-writing a constraint or index in `prisma/migrations/**` that `schema.prisma` has no syntax for, or a test happily writes a row production would refuse |
| [`npm run db:migrate` does not regenerate the Prisma client, so `typecheck` passes against the OLD schema types](db-migrate-does-not-regenerate-the-client-so-typecheck-lies.md) | editing `prisma/schema.prisma` — especially REMOVING a field, a model or a `@unique` — or a local `typecheck` is green and CI's fails on a Prisma type in a file you never opened |
| [A backfill's UNMATCHED rows may hold values that never named anybody](a-backfills-unmatched-rows-may-name-people-who-never-existed.md) | diagnosing UNMATCHED/ambiguous rows from a backfill (`src/lib/ownerBackfill.ts`, `scripts/db/backfill-*.ts`), or a value resolves against a fresh seed and matches nobody in prod, and widening a resolver tier is starting to look reasonable |
| [The shape audit between twin mutation boundaries is also the cheapest authorization audit](twin-mutation-boundaries-drift-on-guards-not-only-on-shape.md) | routing a `src/app/actions/**` action through the zod schema its twin already uses, or two boundaries write one table and only one of them refuses a bad reference / reaches a row the UI could never have named |
| [A file-scoped eslint exemption can silently not apply — a Next `[id]` path is a glob, and a later block REPLACES the rule](an-eslint-file-exemption-can-silently-not-apply.md) | adding or moving a file-scoped exemption in `eslint.config.mjs`, or a file you just exempted still reports the rule / a rule family stops being enforced in a file nobody exempted |
