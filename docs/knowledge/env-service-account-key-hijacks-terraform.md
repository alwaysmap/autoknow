---
title: Terraform authenticates as the app's service account, because `.env` sets GOOGLE_APPLICATION_CREDENTIALS and the provider prefers it over your gcloud login
status: current
updated: 2026-07-26
applies_to:
  - infra/terraform/**
  - terraform init / plan / apply from a shell that has sourced .env
  - any gcloud-authenticated tool run from this repo
symptoms:
  - "Error 403: autoknow@….iam.gserviceaccount.com does not have storage.objects.list access to the bucket"
  - a 403 naming a service account you did not choose, when you expected your own login
  - "(or it may not exist)" on a bucket you can see in the console
  - terraform init fails on the backend while `gcloud auth list` shows the right account active
verified_by: 'scripts/infra/terraform.sh (identity assertion, both branches exercised 2026-07-26); the apply of the REFRESH_CRON_SCHEDULE export'
---

# `.env` hands Terraform the app's service-account key, and the provider prefers it to your login

**The lesson.** `.env` sets `GOOGLE_APPLICATION_CREDENTIALS` to the Drive service-account
key (`lib/googleAuth` mode 2). The Google Terraform provider — and every Google client
library — reads that variable **before** falling back to gcloud Application Default
Credentials. So in any shell that has sourced `.env`, `terraform` authenticates as
`autoknow@<project>.iam.gserviceaccount.com`, not as you, no matter what
`gcloud auth list` or `gcloud auth application-default login` say.

**Why it bites.** The runtime SA correctly has *no* access to the state bucket — that is
least privilege working. But the resulting error names the bucket and adds
"(or it may not exist)", so it reads as a missing bucket, a wrong `-backend-config`, or a
broken remote state. Every one of those is a plausible thing to go and check, and none of
them is the problem. Meanwhile `gcloud auth list` shows the right human account active,
which actively argues against the real explanation. The variable is doing exactly what it
is documented to do; it is simply scoped to the whole shell rather than to the app.

**What to do.** Use `npm run infra:plan` / `npm run infra:apply`
(`scripts/infra/terraform.sh`). They unset `GOOGLE_APPLICATION_CREDENTIALS`,
`GOOGLE_CREDENTIALS` and `GOOGLE_OAUTH_ACCESS_TOKEN`, then **assert** the ADC principal is
an `@alwaysmap.com` user before touching the backend — so a wrong identity fails with a
sentence naming the identity, instead of a 403 about storage. Running `terraform` directly
still works if you strip the variable yourself:

```bash
env -u GOOGLE_APPLICATION_CREDENTIALS -u GOOGLE_CREDENTIALS terraform plan …
```

The same hazard applies to any Google-authenticated CLI run from this repo, which is why
the guard lives in a wrapper rather than in a paragraph someone has to have read.

**How we found out.** A `terraform apply` of the `REFRESH_CRON_SCHEDULE` export failed with
the 403 above. Both credentials had also genuinely expired (`invalid_rapt`), so
`gcloud auth application-default login` was necessary — and, being necessary, looked
sufficient. It was not: the login fixed ADC while the environment variable kept overriding
it, so the second failure looked identical to the first.
