---
title: A blanket test cleanup breaks order-dependently when a later feature FK-pins rows it assumed deletable
status: current
updated: 2026-08-09
applies_to:
  - tests/**/*.spec.ts beforeAll/beforeEach cleanup
  - prisma.<model>.deleteMany with a broad or empty where
  - adding a new required FK onto an existing table
symptoms:
  - an e2e spec fails in the full suite but passes standalone
  - PrismaClientKnownRequestError "Foreign key constraint violated" inside a test's own cleanup, before its first assertion
  - the failure follows worker assignment, not load or retries
verified_by: 'tests/templates_ui.spec.ts beforeAll and tests/apiHardening.test.ts "concurrent seeding" carry the scoped deletes with the why; the autoknow-ws1 PR''s full e2e went red twice on the unscoped form and green once scoped'
---

# A blanket test cleanup breaks order-dependently when a later feature FK-pins rows it assumed deletable

**The lesson.** A `deleteMany` cleanup encodes an assumption about who may
reference the rows it deletes — and a feature shipped LATER can falsify that
assumption without touching the test. When it does, the failure is
order-dependent: it only fires when a spec that created the referencing rows
has already run on the same worker's database, so the spec passes standalone
and CI looks flaky.

**Why it bites.** Each worker owns its database (AGENTS lesson 9) but specs on
one worker share it serially, and cleanups written as "user rows start clean"
quietly become "rows nobody references start clean" the day a new FK arrives.
gh-286 did exactly this: an initiative's private template snapshot is a
non-built-in `ProgramTemplate` pinned by `Initiative.templateId`, so
`templates_ui.spec.ts`'s pre-gh-286 `deleteMany({ isBuiltIn: false })` died on
`Initiative_templateId_fkey` whenever an initiative spec preceded it — twice in
consecutive full-suite runs, never standalone.

**What to do.** Scope the cleanup with the same exclusion the app's own reads
use — for templates that is `initiative: null`, the filter every template list
applies — or delete the referencing table first the way `wipeAll` orders
Initiative before ProgramTemplate. And when a schema change ADDS an FK, grep
`tests/` for `deleteMany` on the newly-referenced model: the migration is the
moment the stale assumption is cheapest to find (both live sites here were
found with one grep).

**How we found out.** templates_ui failed in two consecutive full e2e runs on a
branch whose diff could not cause it; the error-context artifact showed the
cleanup itself throwing. The sweep found the same shape in
`tests/apiHardening.test.ts`. Fixed in the autoknow-ws1 PR.
