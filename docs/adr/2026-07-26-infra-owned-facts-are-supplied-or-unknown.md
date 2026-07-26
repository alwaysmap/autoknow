---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [infra, terraform, config, env, copy, budget]
---

# A fact owned by infrastructure is supplied at runtime or declared unknown — never a literal

**Context.** Three defects in one page, all the same shape. (1) Terraform creates a
Workspace group `autoknow@<domain>` with the runtime service account as a member and
establishes it as *the* Drive sharing address — but `serviceAccountEmail()` fell
through `GOOGLE_SHARE_ADDRESS ?? client_email ?? GOOGLE_SA_EMAIL`, so any deployment
missing the infra variable printed a raw `*.iam.gserviceaccount.com` address inside a
sentence calling it the address to share with. (2) The same sentence promised indexing
"within the hour", though `cron_schedule` is set on the Cloud Scheduler job and
**never exported to Cloud Run** — true on one deployment, false on every other and on
every local checkout, which has no scheduler at all. (3) The same assumption sits
under `CYCLES_PER_DAY = 24`, where it is load-bearing rather than cosmetic: every cap
divides a daily budget by it, so moving `cron_schedule` to every 30 minutes doubles
real spend while the slider holds still — the quota cap of
[the budget ADR](2026-07-26-one-gemini-budget-pool-ordered-freshness-first.md),
reachable through one line of HCL. That constant's own comment already said it should
"track the real cadence … instead of drifting from it". Prose lost.

**Decision.** A fact owned by infrastructure — an address it provisions, a schedule it
runs, a quota it holds — is either **supplied by infrastructure at runtime** or
**declared unknown**. It is never inferred from a neighbouring value that merely
coincides with it, and never written as a literal in app code or user-facing copy.

Three corollaries, each load-bearing:

- **Unknown is a branch, not a blank.** The app carries a distinct path with honest
  copy for "infrastructure did not tell us", instead of substituting a plausible
  stand-in. `driveShareAddress()` returns null and the page names the service account
  *as* a service account; no cadence is known, so the copy says "on its next run".
- **Coinciding values are not the same fact.** The address people share with and the
  identity the app authenticates as are different things that happen to match in a
  keyfile-only setup. They get separate functions.
- **A literal that cannot be removed yet gets pinned by a test.** Until the cadence is
  exported, `tests/ingestBudget.test.ts` parses `variables.tf` and fails if
  `CYCLES_PER_DAY` disagrees with the Terraform default — silent drift becomes a red
  build (AGENTS lesson 2: enforce in software, not prose).

**Alternatives rejected.**

- *Derive the share address as `autoknow@${AUTH_ALLOWED_DOMAIN}`.* Reconstructs the
  string Terraform builds, so it names a group that may not exist on a deployment that
  never created one. A confidently wrong address is worse than no address.
- *Keep the fallback chain, reword the sentence.* The chain itself is the defect: it
  conflates two facts, so any wording built on it inherits the conflation.
- *Ship the cadence as a second Terraform variable beside `cron_schedule`.* Two
  sources free to disagree — the failure mode being fixed.
- *Document the coupling in comments.* Already tried, verbatim, in the `CYCLES_PER_DAY`
  docstring. It drifted anyway.

**Consequences.** Infrastructure must export more, and each addition pays the ordering
rule — infra PR plus a human `terraform apply` first, app PR second and config-gated,
with `ci:lint-ordering` blocking a mixed PR. Every unknown branch needs real copy in
all four locales, so "we don't know" costs more to write than a confident guess. The
cron test guards only the **default**: a deployment overriding `var.cron_schedule`
still slips past it, and closing that needs the cadence genuinely exported. This
decision governs the dev-mode/production-mode configuration work that follows it.

*Closed since:* the cadence IS exported now (`REFRESH_CRON_SCHEDULE`), so
`CYCLES_PER_DAY` is gone and `lib/cronCadence` reads the real schedule; the
Terraform-default test survives as the guard on the FALLBACK. The corollary that cost
the most to discover is recorded separately:
[a shared function whose default reads `process.env` uses the fallback inside a client
component](../knowledge/an-env-derived-default-is-the-fallback-inside-a-client-component.md).

**Receipts.** Reported 2026-07-26 ("the terraform setup established autoknow@[domain]
as the account … ensure that tests validate this, and that the text on this page is
accurate regardless of deployment"). `src/lib/googleAuth.ts`,
`src/app/manage/sources/page.tsx`, `src/lib/i18n.ts`, `src/lib/ingestBudget.ts`;
`tests/driveShareAddress.test.ts`, `tests/ingestBudget.test.ts` ("CYCLES_PER_DAY
tracks the Cloud Scheduler cron" — verified to fail by flipping the default to
`*/30 * * * *`, which produced `Expected: 24, Received: 48`). Infra follow-up:
`autoknow-6be`.
