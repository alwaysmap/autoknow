---
name: gcp-debug
description: Debugging or verifying the LIVE GCP deployment — deploy status, logs, errors, cron ticks, Chat delivery, rollback. Load when anything in production needs checking.
---

# Debugging production (GCP)

Constants: project `autoknow-prod-1895f1` · service `autoknow` · region
`us-central1` · https://autoknow.alwaysmap.com

## First question: what is prod actually running?

```bash
curl -s https://autoknow.alwaysmap.com/api/health   # {ok, sha, db} — sha must match `git log origin/main -1`
```

Green Actions runs are NOT proof of deployment (2026-07-20: parallel deploys
finished out of order and prod served the oldest commit while newer runs showed
green — deploy.yml's concurrency group exists because of this; never remove it).

## Deploys

- Merge to `main` auto-deploys — but the workflow is path-filtered: docs-only
  merges deploy nothing, by design.
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
