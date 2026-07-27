---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [ci, database, security, backfill, deploy]
---

# A backfill reaches production through one allowlisted dispatch runner, as the DML-only role

**Context.** The playbook has always said a backfill is a separate idempotent script and
never a statement inside `migrate deploy` — it makes judgements whose leftovers a human
must read. Nobody noticed that this left it with **nowhere to run**. #127 E6 shipped
`npm run db:backfill:owner-person` and it could not be executed against production: the
runtime image excludes `scripts/` and carries no ts-node, and the only two prod-DB paths
in the repo (`deploy.yml`'s migrate job, `harden-db.yml`) each do one hardcoded thing. The
tempting workaround — read the password out of Secret Manager and run the script from a
workstation — is precisely what the keyless Workload Identity Federation setup exists to
prevent, and it would have put a live production credential on a laptop to save an hour.

**Decision.** A backfill runs against production **only** through
`.github/workflows/db-backfill.yml` → `scripts/db/backfill.sh`, and that runner is:

1. **One runner for every backfill, gated by an allowlist in the script.** The workflow
   takes the backfill's name as an input, so #127 E8 and E9 cost two lines each instead of
   a new workflow each. What stops that from being a "run any npm script against prod"
   hatch is that the name must match `ALLOWED` in `scripts/db/backfill.sh`; the workflow's
   `choice` dropdown only mirrors that list, it does not define it. **The allowlist is a
   control against mistakes, not against people**: `workflow_dispatch` names its own ref
   and the WIF trust condition is repository-scoped, so anyone who can fire this could
   equally push a branch that widens the list. Run it from `main`. Making it a control
   against people means a protected GitHub `environment` with required reviewers — worth
   doing if this ever runs often, and deliberately not done for a handful of one-shots.
2. **`workflow_dispatch` only, with a required typed confirmation.** No push and no
   schedule; the API/`gh` dispatch is the same trigger and is the documented way to fire
   it. The confirmation defends against the *stray click* — the Run-workflow form arrives
   with every other input pre-filled — so an unconfirmed run writes nothing and opens no
   connection.
3. **Connected as `app_runtime`, never `app`.** A backfill is `SELECT` + `UPDATE`, so it
   uses the DML-only role from `harden-roles.sql` — a stray DDL statement dies with
   *permission denied* instead of altering prod's schema. `GRANT … ON ALL TABLES` is
   table-level, so a column added by a later migration is already writable and this needs
   no new grant, no Terraform, no IAM.
4. **Nobody holds a connection string.** WIF → Secret Manager → `db_password` extracts
   only the password (the stored URL is in Cloud SQL socket form and is rebuilt for the
   proxy). Two different scrubs, because they cover different artifacts: `::add-mask::`
   for the log stream, and an explicit `sed` over anything copied into the job summary,
   which masking does not reach.
5. **Its own output makes a bad run obvious.** It asks the *server* which database and
   role it got and refuses to write on a mismatch, echoes the report to the job summary,
   and on failure names the stop conditions — a permission error (do NOT retry as `app`),
   a missing column (the migration has not reached this database).

**Alternatives rejected.**

- *One workflow per backfill.* Honest but not free: three near-identical files by E9, and
  the divergence between them is where the confirmation or the role choice silently rots.
- *An input that takes an arbitrary npm script.* Same file, one word looser, and it turns
  a repo-write permission into arbitrary code execution against production.
- *A statement inside the migration.* Already rejected by the playbook, and the reason is
  sharper here: this backfill deliberately leaves rows alone and reports them, which
  `migrate deploy` has no way to surface.
- *Run it from a workstation, once, carefully.* One production password on a laptop, one
  run nobody can audit, and the next backfill starts the argument again.
- *A Cloud Run job off the app image.* Needs a second image built from a second Dockerfile
  plus its own infra, to run a script a CI runner already has the tree for.

**Consequences.**

- Adding a backfill to the prod path is a reviewed two-line diff (a `case` arm and a
  dropdown option) — deliberately not zero, because the allowlist IS the control.
- The runner is a CI job, so a backfill must run inside a job timeout on a hosted runner.
  Anything longer-running needs a different mechanism, and that is a good forcing
  function: a backfill that cannot finish in a job is one that should be batched.
- `scripts/db/harden.sh` no longer inlines its own copy of the password extraction; both
  roles now go through `db_password`, which grew an optional secret argument.
- Untested until first use, and honestly so: this cannot be exercised end-to-end without
  writing to production. Everything up to the network call is covered locally.

**Receipts.** Bead `autoknow-28n`, for #127 E6 (PR #210) → E7 (`autoknow-mnr`). The
refusals (bad confirmation, unknown backfill, unknown npm script) were run for real and
are pinned by `tests/backfillRunner.test.ts`. Everything after them was run against a
LOCAL scratch database with only `start_proxy` and `db_password` stubbed — two lines —
including a real `npm run db:backfill:owner-person` over seeded rows that reported
`linked: 2 / unmatched: 1 / ambiguous: 1` and then `linked: 0` on an immediate re-run.
NOT proven, and not provable without writing to production: the proxy hop, the Secret
Manager read and the WIF grant.
