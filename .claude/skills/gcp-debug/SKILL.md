---
name: gcp-debug
description: Debugging or verifying the LIVE GCP deployment — deploy status, logs, errors, cron ticks, Chat delivery, rollback. Load when anything in production needs checking.
---

# Debugging production (GCP)

Constants: project `autoknow-prod-1895f1` · service `autoknow` · region
`us-central1` · https://autoknow.alwaysmap.com

**Browser identity first.** Open every Google console URL as the
`alwaysmap.com` identity or you will see "project not found" / empty lists:
append `&authuser=dylan@alwaysmap.com` to console.cloud.google.com and
admin.google.com URLs, and confirm the top-right avatar before trusting the
page. Example:
`https://console.cloud.google.com/run/detail/us-central1/autoknow/logs?project=autoknow-prod-1895f1&authuser=dylan@alwaysmap.com`
(chat.google.com and other Workspace apps take `…/u/dylan@alwaysmap.com/`.)
Prefer looking at the live console/logs in the browser over speculating — the
loop is free.

## First question: what is prod actually running?

```bash
curl -s https://autoknow.alwaysmap.com/api/health   # {ok, sha, db}
```

The sha must match `git log origin/main -1` **only if that merge touched a
deploy-triggering path** (the allowlist is under Deploys below). When it did not,
prod correctly keeps serving the PREVIOUS sha and no `Deploy app` run exists for
the new one — that is success, not a stuck deploy. Diff the merge against the
allowlist BEFORE concluding anything failed; the wrong conclusion leads to a
`workflow_dispatch` that redeploys an unchanged image at prod to fix a non-problem
(2026-07-21: PR #18, 15 minutes spent polling for a deploy correctly never fired).

Green Actions runs are NOT proof of deployment (2026-07-20: parallel deploys
finished out of order and prod served the oldest commit while newer runs showed
green — deploy.yml's concurrency group exists because of this; never remove it).

## Deploys

- Merge to `main` auto-deploys — but only for the `paths` allowlist in
  `deploy.yml`: `src/**`, `prisma/**`, `public/**`, `package.json`,
  `package-lock.json`, `Dockerfile`, `next.config.ts`, `scripts/ci/**`,
  `.github/workflows/deploy.yml`. Anything else — `docs/**`, `AGENTS.md`,
  `.claude/**`, tests — deploys nothing, by design: the image would be identical.
- Redeploy current main: `gh workflow run deploy.yml --repo alwaysmap/autoknow --ref main`
- Watch: `gh run watch --repo alwaysmap/autoknow` · failures:
  `gh run view <id> --log-failed`
- Rollback: prefer revert-commit → auto-deploy. Emergency:
  `gcloud run services update-traffic autoknow --region us-central1 --project autoknow-prod-1895f1 --to-revisions <prev>=100`
  — traffic shifts never undo migrations (that's why the playbook splits
  destructive schema changes).

## Logs — warn/error visibility is a read-side filter, no config needed

stdout → severity DEFAULT; stderr (`console.warn`/`error`) → severity ERROR.

```bash
# live tail
gcloud beta run services logs tail autoknow --project autoknow-prod-1895f1
# warnings+errors, last 2h
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="autoknow" AND severity>=WARNING' \
  --project autoknow-prod-1895f1 --freshness=2h --format='table(timestamp,severity,httpRequest.status,textPayload)'
# did the hourly cron run?
gcloud logging read '… httpRequest.requestUrl:"/api/cron/refresh"' --freshness=6h
```

Full command set + console URLs (Cloud Run logs/metrics/revisions, Logs
Explorer, Error Reporting, Scheduler): **OPERATIONS §10** — read that section
only, not the whole doc.

## Chat delivery

Failures are usually Google-side: error code 13 + zero requests in our logs =
the event never reached us; Workspace admin toggles propagate for up to 24h —
don't judge a test early. The add-on-era checklist and Google-side log
commands: **OPERATIONS §6.0 + §6 troubleshooting**.
