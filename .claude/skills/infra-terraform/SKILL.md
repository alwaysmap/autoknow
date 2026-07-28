---
name: infra-terraform
description: GCP infrastructure work — infra/terraform/**, secrets, env vars, Cloud Run settings, Scheduler, IAM, domains. Load BEFORE proposing infra changes.
---

# Infrastructure (Terraform / GCP)

Relevant playbook recipes: CHANGE_PLAYBOOK §B (adding infra) and §C (removing).
Architecture rationale: DEPLOYMENT_GCP (read the STATUS block + the section you
need, not the whole doc).

## The ordering IS the safety model

- **Adding** infra the app needs: infra PR → human `terraform apply` → verify
  the resource exists → THEN the app PR (config-gated). One combined PR is
  unsafe: merge auto-deploys the app before anyone has applied.
- **Removing**: app PR (stop referencing) → then infra PR + apply.
- **CI enforces the split**: a PR touching both `infra/terraform/**` and app
  code fails the `change-ordering` gate. Genuinely-safe exceptions (a comment
  fix riding along) opt in with `allow-mixed-infra: <reason>` in a commit
  message — visible in review, like `-- allow-destructive`.
- `terraform apply` is ALWAYS human-run. PRs touching `infra/terraform/**` get
  an automatic read-only `terraform plan` (terraform.yml). Never run apply
  yourself; say what needs applying and stop.

## Mechanics

- Layout: `infra/terraform/` — `main.tf` (project, APIs, registries, SQL,
  secrets, IAM, Cloud Run, Scheduler, WIF), `monitoring.tf` (alarms),
  `apphub.tf` (App Hub grouping), `providers.tf`, `variables.tf`, `outputs.tf`,
  plus per-instance `instances/<name>.tfvars` + `instances/<name>.backend.hcl`
  (GCS remote state). Run it via `npm run infra:plan` / `infra:apply` —
  `scripts/infra/terraform.sh` unsets the app's SA credentials and asserts a
  human `@alwaysmap.com` identity before touching the backend.
- Secrets: Secret Manager resources in `main.tf` (`local.generated_secrets` /
  `local.external_secrets` → `google_secret_manager_secret.s`) + the Cloud Run
  env mapping; never in tfvars or the repo. A new secret also needs a
  `.env.sample` entry and a row in OPERATIONS §7's table.
- App code must gate on env presence (`fooConfigured = !!process.env.FOO`) and
  degrade with an honest message — features stay dark until infra exists.
- Known escape hatches: consumer OAuth clients are console-only (no API);
  `alwaysmap.com` DNS lives in Squarespace's UI (no API) — OPERATIONS §8 before
  touching domains. Don't fight these; document around them.

## After a merge

App deploys are automatic and serialized; confirm what's serving via
`curl -s https://autoknow.alwaysmap.com/api/health` (see the gcp-debug skill),
not the Actions UI.
