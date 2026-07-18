# Deploying AutoKnow to GCP (Cloud Run + Terraform + GitHub CI/CD)

A plan for hosting AutoKnow on Google Cloud, declared end-to-end in Terraform, with
a GitHub Actions pipeline. Written to answer three things up front:

- **Is there a Next.js-native job manager for the AI updates?** No. Next.js has no
  built-in scheduler for self-hosted deployments (Vercel Cron is Vercel-only). The
  right GCP answer is **Cloud Scheduler** → an HTTP endpoint. It is fully declarative
  in Terraform and is the "very simple Google service" you're after.
- **Can everything be Terraform?** Yes, to within ~2 org-level items Google refuses to
  expose to any automation. **§4b is the full console-vs-Terraform inventory** and is
  the answer to your "as little UI as possible" requirement: every GCP resource is a
  Terraform resource; the handful Google restricts (OAuth consent, Chat app config,
  Workspace allowlist) are either Terraform-native via IAP resources, driven by a
  `terraform apply` that shells to the REST API (`null_resource`/`local-exec`), or — for
  the one genuinely org-admin toggle — a documented one-time click. There is **no
  routine console work**: deploys, schedules, secrets, DB, IAM, identity are all HCL.
- **Does this fix Google Chat?** Largely yes — see §7. On Cloud Run the app has a
  stable, reputable `*.run.app` HTTPS URL, which removes the reason the Cloud Run
  relay + Tailscale funnel existed. What remains is a Workspace-admin step outside GCP.

---

## 1. Target architecture

```
                        ┌────────────────────── Terraform (all of this) ──────────────────────┐
  GitHub push ──▶ GitHub Actions ──(Workload Identity Federation, keyless)──▶ GCP
       │                │
       │                ├─▶ build image ─▶ Artifact Registry
       │                └─▶ terraform apply / gcloud run deploy
       ▼
  ┌─────────────────┐        ┌────────────────────┐        ┌───────────────────┐
  │ Cloud Scheduler │──HTTP─▶│  Cloud Run service │──socket▶│ Cloud SQL Postgres│
  │  (hourly cron)  │ bearer │   autoknow (web)   │        │  + pgvector       │
  └─────────────────┘        │  Next.js standalone│        └───────────────────┘
                             └─────────┬──────────┘
  Google Chat ──POST /api/chat/events──┘   ▲
  (JWT-verified at app layer)              └── Secret Manager (all secrets as env)
```

- **One Cloud Run service** runs the whole app (UI + API routes + the cron endpoint).
  It is a user-facing web app, so it must be reachable by browsers → the service
  allows unauthenticated ingress and **the app's own auth is the boundary** (next-auth
  session gate, `requireRouteAuth` on mutations, `CRON_SECRET`, `ADMIN_TOKEN`, Chat
  JWT verification). This is exactly what the app was hardened for.
- **Cloud SQL for PostgreSQL** with the `vector` extension, reached over the built-in
  Cloud SQL unix socket (no public IP, no TCP).
- **Cloud Scheduler** drives the AI-update pipeline on a schedule.
- **Secret Manager** holds every secret; Cloud Run mounts them as env vars.
- **Artifact Registry** holds the container image.
- **Google Chat** posts directly to the Cloud Run URL — no relay.

Why one public service instead of a load balancer + IAP (the 2021 pattern): Cloud Run
auth is service-level, not path-level. Chat and the browser both need public reach, so
IAP-gating the service would break sign-in and Chat. App-layer auth is the correct
boundary here and is already fail-closed. (IAP in front of the UI is possible but only
by splitting Chat/cron onto a second ingress — added complexity for little gain.)

---

## 2. The AI-update state machine (make this explicit)

Every scope — the ecosystem, each partner, each program — has one summary with a
lifecycle:

```
   (no row) ─generate─▶ FRESH ─scope activity arrives─▶ STALE ─regenerate─▶ FRESH
      ▲                                                              │
      └──────────────────── append-only history ────────────────────┘
```

- **FRESH**: the latest `Summary.generatedAt` ≥ the newest scope-relevant timestamp.
- **STALE**: some scope-relevant record is newer than the summary. "Scope-relevant"
  is *not just ingests* — it is any of: a needle update (`ProjectState`), a hill/phase
  update (`PhaseState`), a relationship update (`PartnerState`), or an ingested doc
  (`ContextUrl`). Partner scope also rolls up its programs; ecosystem rolls up all.
- Summaries are **append-only**; regeneration writes a new row.

**Three triggers move the machine — all converge on `createSummary`:**

1. **Scheduler (background driver).** Cloud Scheduler → `GET /api/cron/refresh`. That
   handler runs, in order: `runDriveSync()` (discover/refresh shared Docs, capped) →
   `runRefreshCycle()` (re-check watched web/tracker sources, content-hash gated, cap
   10) → `runSummaryCycle()` (regenerate MISSING first, then STALE, **cap 10/tick**).
2. **On view.** `SummaryPanel` regenerates on mount if the summary is missing or
   stale (once per mount) — so opening a page with stale data refreshes it.
3. **Manual.** The reload control on the panel.

`createSummary` is a pure function of (evidence in the window, prompt) → a zod-validated
structured result with citations. Window = last summary's `generatedAt` → now (30-day
fallback). Model output is schema-validated (`parseRawSummary`); a bad response degrades
to an honest empty state.

**One change this design needs for Cloud Run: single-flight.** On a laptop, launchd ran
one instance so ticks never overlapped. On Cloud Run (autoscaling, Scheduler retries) a
slow tick could overlap the next. Wrap the cron handler in a Postgres advisory lock so
overlaps no-op:

```ts
// at the top of GET /api/cron/refresh, after auth
const [{ locked }] = await prisma.$queryRaw<{locked: boolean}[]>`SELECT pg_try_advisory_lock(4771) AS locked`;
if (!locked) return NextResponse.json({ skipped: 'already running' }, { status: 200 });
try { /* drive → refresh → summaries */ } finally { await prisma.$queryRaw`SELECT pg_advisory_unlock(4771)`; }
```

Set the Cloud Run request timeout to ~300s; the per-cycle caps (10 refreshes + ~10
Gemini calls) keep a tick well under that. If the corpus outgrows a single request,
promote the pipeline to a **Cloud Run Job** (run-to-completion, up to 24h, same image,
still triggered by Cloud Scheduler) — the code already separates the logic into
`lib/refresh`, `lib/driveSync`, `lib/summaries`, so a job entrypoint is a thin wrapper.

---

## 3. Scheduling: why Cloud Scheduler

| Option | Declarable in TF | Fit |
|---|---|---|
| **Cloud Scheduler → HTTP** | ✅ `google_cloud_scheduler_job` | **Recommended.** Managed cron, one line of HCL, hits the existing endpoint. |
| Cloud Run **Jobs** + Scheduler | ✅ | Best if the tick outgrows a request timeout; needs a small job entrypoint. |
| Pub/Sub + push subscription | ✅ | Overkill here; useful only if you want fan-out/retries decoupled. |
| Next.js built-in cron | ❌ | Doesn't exist self-hosted. Vercel Cron is Vercel-only. |
| A `node-cron` inside the server | ❌ (in spirit) | Runs per-instance → duplicates when Cloud Run scales; avoid. |

Cloud Scheduler sends `Authorization: Bearer <CRON_SECRET>`. Terraform is the single
source of truth for that secret: `random_password` → written to **both** a Secret
Manager version (the app reads it as env) **and** the scheduler job's header. (OIDC
tokens are the usual pattern for *private* services; since this service is public for
Chat/browser reasons, the app-layer `CRON_SECRET` is what actually gates the endpoint,
so a bearer header is the honest mechanism.)

---

## 4. GCP resource inventory (all Terraform)

Enable APIs with `google_project_service`: `run`, `sqladmin`, `secretmanager`,
`artifactregistry`, `cloudscheduler`, `iam`, `iamcredentials`, `sts`, `chat` (§7),
`cloudbuild` only if you build in Cloud Build instead of Actions.

| Concern | Terraform resource(s) |
|---|---|
| Image registry | `google_artifact_registry_repository` (Docker) |
| Database | `google_sql_database_instance` (POSTGRES_16, no public IP), `google_sql_database`, `google_sql_user` |
| App runtime | `google_cloud_run_v2_service` (+ `..._service_iam_member` `run.invoker=allUsers` for public ingress) |
| Schedule | `google_cloud_scheduler_job` |
| Secrets | `google_secret_manager_secret` + `..._version` (one per secret); `random_password` for the generated ones |
| Identities | `google_service_account` ×3: run-runtime, scheduler-invoker, ci-deployer |
| IAM | `google_project_iam_member` (runtime → `secretmanager.secretAccessor`, `cloudsql.client`); scheduler SA → nothing extra when using a bearer header |
| Keyless CI auth | `google_iam_workload_identity_pool` + `..._provider` (GitHub OIDC), `google_service_account_iam_member` binding the CI SA to the pool |
| Networking | (optional) Serverless VPC connector only if you choose **private IP** Cloud SQL; the unix-socket path needs none |

**File layout** (following terraforming-101: `main.tf` / `variables.tf` /
`terraform.tfvars`, explicit provider version, **GCS remote state** for a real
deployment rather than local):

```
infra/terraform/
  backend.tf         # backend "gcs" { bucket = "autoknow-tfstate" }
  providers.tf       # google + google-beta, pinned versions
  variables.tf       # project_id, region, image, domains, oauth ids…
  terraform.tfvars   # concrete values (secrets NOT here — see §5)
  apis.tf            # google_project_service ×N
  registry.tf        # artifact registry
  database.tf        # cloud sql instance + db + user
  secrets.tf         # secret manager + random_password
  run.tf             # cloud run service + iam
  scheduler.tf       # cloud scheduler job
  iam.tf             # service accounts + role bindings + WIF pool
  outputs.tf         # service URL, sql connection name, etc.
```

Keep infra changes rare; keep app deploys frequent (§8).

---

## 4b. Minimizing the console (near-100% Terraform)

The goal: **no routine console work, and the one-time setup as close to `terraform
apply` as Google allows.** Here is every setup action and how it's done:

| Setup action | Mechanism | Console? |
|---|---|---|
| Enable all APIs | `google_project_service` | ❌ never |
| Artifact Registry, Cloud SQL, DB, users | native resources | ❌ |
| Cloud Run service + ingress IAM | native resources | ❌ |
| Cloud Scheduler + its SA | native resources | ❌ |
| Every secret + generated values | `google_secret_manager_secret[_version]` + `random_password` | ❌ |
| Service accounts + all role bindings | native resources | ❌ |
| GitHub→GCP auth (keyless) | Workload Identity Federation resources | ❌ |
| DB migrations | `prisma migrate deploy` in CI | ❌ |
| Cloud SQL backups/PITR, custom domain, TLS | native resources | ❌ |
| **Human sign-in identity** | **IAP** (`google_iap_brand` + `google_iap_client`) — see below | ❌ (IAP path) |
| **Chat app configuration** | `null_resource` + `local-exec` → Chat REST API, run by `terraform apply` | ❌ if the API accepts it; else one 2-min click |
| **Workspace Chat/Marketplace allowlist** | `googleworkspace` provider if covered; else org-admin | ⚠️ one org-admin toggle |

**The identity decision is what determines whether auth is Terraform-native.**

- **next-auth (current app):** requires a **Console-only** "OAuth 2.0 Client (Web)"
  — Google exposes no API/gcloud/Terraform to create general consumer OAuth clients.
  That's one irreducible console action (create client, set redirect URIs, publish the
  internal consent screen).
- **IAP (recommended for this constraint):** the OAuth **brand and client ARE Terraform
  resources** (`google_iap_brand`, `google_iap_client`), so identity becomes HCL. IAP
  authenticates users at the edge and injects `X-Goog-Authenticated-User-Email`, which
  the app reads instead of a next-auth session (a contained change to `lib/session`).
  To keep the public machine callbacks working, front Cloud Run with a load balancer
  and route by path to **two backend services over the same serverless NEG** — one with
  IAP for the UI, one without for `/api/chat/events` and `/api/cron/refresh`. All of
  that (LB, URL map, NEG, two backends, IAP binding) is Terraform. This is the only way
  to get identity 100% declarative; the cost is the LB + a small auth-source change in
  the app.

**Recommendation given your requirement:** go **IAP + load balancer** so identity is
Terraform, and accept the app change (read the IAP header). If you'd rather keep
next-auth, that's exactly *one* console action, isolated and documented — everything
else is still HCL.

**The escape hatch for anything without a resource:** a `null_resource` with a
`local-exec` provisioner that calls `gcloud` or the REST API, keyed on a trigger so it
re-runs when inputs change. It's still declared in HCL and executed by `terraform
apply` — no clicking. Use it for the Chat app config (Chat REST API) and any
`googleworkspace` gap. The provider set is: `hashicorp/google`,
`hashicorp/google-beta`, and `hashicorp/googleworkspace` (Admin SDK — users, groups,
org units, and some app settings).

**Genuinely irreducible (Google policy, not a tooling gap):** the Workspace
**Marketplace/Chat allowlist** in admin.google.com is an org-admin decision the Admin
SDK may not expose; budget for one toggle there (with ~24h propagation). It is not a
GCP object and no IaC tool owns it. Everything else above is `terraform apply`.

---

## 5. Secrets & config mapping

Every value currently in `.env` maps to a Secret Manager secret, injected into Cloud
Run as an env var (`google_cloud_run_v2_service.template.containers.env` with
`value_source.secret_key_ref`). Never in `terraform.tfvars`, never in the image.

| Secret | Source | Notes |
|---|---|---|
| `DATABASE_URL` | Terraform-composed | `postgresql://app:<pw>@localhost/autoknow?host=/cloudsql/<CONNECTION_NAME>&schema=public` (unix socket) |
| `AUTH_SECRET`, `CRON_SECRET`, `ADMIN_TOKEN` | `random_password` | generated + versioned once; `CRON_SECRET` also feeds the scheduler header |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | only if you keep next-auth | the one console-created item; **skip entirely on the IAP path** (§4b) |
| `AUTH_ALLOWED_DOMAIN` | tfvars (not secret) | e.g. your Workspace domain |
| `GEMINI_API_KEY` | manual | AI Studio key |
| `GOOGLE_PROJECT_NUMBER` | `data.google_project` | for Chat JWT audience |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Secret Manager | Drive service-account key (but see the keyless note below) |
| `DESTRUCTIVE_DB_ALLOWED` | tfvars | set to the **exact** prod DB name only if you intend wipes to be possible there; leave unset to keep them impossible |

**Keyless Drive (future win).** The app authenticates to Drive with a JSON key
(`lib/googleAuth.getServiceAccountToken`). On GCP the cleaner path is the Cloud Run
runtime service account minting its own token from the metadata server — no key in
Secret Manager. That needs a small change in `lib/googleAuth` (use ADC /
`google-auth-library` ambient credentials instead of a parsed key). Recommended as a
follow-up; start with the key in Secret Manager to ship.

---

## 6. Database

- **Instance:** Cloud SQL for PostgreSQL 16, private IP or public-IP-disabled; Cloud
  Run attaches via `--add-cloudsql-instances` (v2: a `cloud_sql_instance` volume). The
  Cloud SQL Auth Proxy is built into Cloud Run — the socket appears at
  `/cloudsql/PROJECT:REGION:INSTANCE`. Prisma's `pg` adapter connects over it with
  `host=/cloudsql/...` in `DATABASE_URL`. No public exposure, auth handled by the proxy.
- **pgvector:** Cloud SQL supports the `vector` extension. The DB user needs rights to
  `CREATE EXTENSION vector` (grant `cloudsqlsuperuser`, or run it once as admin). The
  app's `ensureVectorExtension()` already issues it idempotently on first use.
- **Migrations — switch off `db push`.** The app currently uses `prisma db push`
  (schema-sync, no history), which is fine for the demo but wrong for prod. Adopt
  `prisma migrate` (versioned migrations) and run **`prisma migrate deploy`** in the
  pipeline before the new revision serves traffic. Run it from the GitHub runner
  through the Cloud SQL Auth Proxy (short-lived), or as a one-off Cloud Run Job.
  `migrate deploy` never drops data; it is orthogonal to the `DESTRUCTIVE_DB_ALLOWED`
  wipe guard.
- **Add a pool error handler.** A stale idle connection on Cloud SQL can surface as an
  unhandled rejection and crash the instance. Attach `pool.on('error', …)` in
  `lib/db.ts` (small, worth doing before prod).

---

## 7. Google Chat — what changes on Cloud Run

The laptop deployment failed at Chat delivery ("code 13 before any HTTP call") — a mix
of (a) needing a reputable standard-port HTTPS endpoint, solved on the laptop by a
Cloud Run relay + Tailscale funnel, and (b) a Workspace admin policy. Cloud Run fixes
(a) outright and simplifies the whole thing:

- **Drop the relay.** The app now has a stable public `https://autoknow-*.run.app/api/chat/events`
  (or a custom domain). Point the Chat app's **App URL** straight at it. Delete
  `infra/chat-relay` from the deployment; the `x-autoknow-original-host` shim in
  `/api/chat/events` becomes unnecessary (the `host` header is already the real host) —
  leave the code (it's harmless) or simplify it.
- **The endpoint stays public + JWT-verified.** Chat authenticates with its own JWT
  (issuer `chat@system.gserviceaccount.com`, audience = `GOOGLE_PROJECT_NUMBER`),
  which the app verifies — not Cloud Run IAM. This is why the service is public-ingress
  with app-layer auth (§1).
- **Terraform does:** enable the Chat API (`google_project_service "chat"`), set
  `GOOGLE_PROJECT_NUMBER` from `data.google_project`, keep the Drive/Chat service
  account, and drive the **Chat app configuration** (name, avatar, App URL, auth
  audience, slash commands) via a `null_resource` + `local-exec` that POSTs to the Chat
  REST API — declared in HCL, applied by `terraform apply`, no console (§4b). The App
  URL it sets is the Cloud Run service URL from `google_cloud_run_v2_service.uri`, so it
  updates automatically if the URL changes.
- **The one org-admin item:** the **Workspace Marketplace/Chat allowlist** in
  admin.google.com — an org decision the Admin SDK may not expose, ~24h propagation.
  This is the single genuinely-manual toggle and it is not a GCP object.

Net: on Cloud Run, Chat should work once the Chat app config points at the run.app URL
**and** the Workspace admin allowlist is in place. The infra half is now trivial and
declarative; the org-policy half is a checklist item, not an engineering problem.

---

## 7b. Single-domain access (alwaysmap.com now, google.com later)

Requirement: only people on one configured domain may use the app. This is **two
different gates for two different callers** — the Chat callback cannot use the same
gate as the browser, because Google Chat calls the app *as the Chat platform* (a JWT),
not as a signed-in domain user. IAP or a session would reject Google's own callback.

**Plane 1 — humans (UI + mutations).** Domain-gated by identity. Two ways, matching the
§4b decision:
- **next-auth (current):** `AUTH_ALLOWED_DOMAIN` already restricts sign-in to the
  Workspace `hd` claim (email-suffix fallback) in `src/auth.ts`. Set it to
  `alwaysmap.com`; flip to `google.com` later. App-layer, already implemented.
- **IAP (recommended):** enforce at the edge with an IAP access policy —
  `google_iap_web_backend_service_iam_member` granting `roles/iap.httpsResourceAccessor`
  to `domain:alwaysmap.com`. Requests off-domain never reach the app. Terraform-native;
  changing domains is a one-line HCL edit. This gate applies **only** to the IAP-fronted
  UI backend, not the public Chat/cron backend (§4b two-backend split).

**Plane 2 — Chat ingestion.** `/api/chat/events` stays public + JWT-verified and is
domain-restricted by three layers, not by the identity gate:
1. **Publish the Chat app as Internal** to the one Workspace — only that domain's users
   can add or @mention the bot. Primary control; the admin.google.com step.
2. **JWT audience = the GCP project number** — proves authenticity, ties events to this
   project.
3. **Sender-domain check in code — a gap to close (see §9).** `handleChatEvent` reads
   `event.message.sender.email` but does not yet verify its domain before ingesting.
   Add: reject unless `sender.email` ends with `AUTH_ALLOWED_DOMAIN`. This is the
   code-level guarantee that a cross-domain space can never inject content, independent
   of org config drift.

**Machine endpoints are never domain-gated:** `/api/chat/events` (Chat JWT) and
`/api/cron/refresh` (bearer `CRON_SECRET`) authenticate as machines, not domain users —
correct and expected. "Single-domain" is a statement about *humans*, enforced on the UI.

**The google.com move:** flip `AUTH_ALLOWED_DOMAIN` / the IAP `domain:` policy to
`google.com` and republish the Chat app in that Workspace. Caveat: `google.com` is
enormous, so domain-internal = any Googler (sign-in and bot @mentions). If you later
need tighter than the whole domain, IAP supports `group:` bindings for the UI and the
Chat app's availability can be scoped to groups — but a *group-level sender check* in the
Chat handler would need a Directory API lookup (a real project, not a config flip).

---

## 8. CI/CD (GitHub Actions)

**Auth: Workload Identity Federation, no JSON keys.** A `google_iam_workload_identity_pool`
+ provider trusts GitHub's OIDC issuer, scoped to your repo; the CI deployer SA is
bound to it. Actions gets short-lived GCP creds with `google-github-actions/auth` — no
long-lived secret in GitHub. (Consistent with the app's own move off SA keys.)

**Pipeline (`.github/workflows/deploy.yml`), on push to `main`:**

1. **Build** the standalone image (multi-stage; see §9), tag with the commit SHA.
2. **Push** to Artifact Registry.
3. **Migrate**: `prisma migrate deploy` via the Cloud SQL Auth Proxy (a job step) — or
   a Cloud Run Job — before the new revision takes traffic.
4. **Deploy** the image. Two strategies:
   - **Infra/app split (recommended for velocity):** Terraform owns everything but the
     Cloud Run *image tag* (`lifecycle { ignore_changes = [template[0].containers[0].image] }`);
     the deploy step runs `gcloud run deploy --image <sha>`. Infra applies are rare and
     reviewed; app deploys are fast.
   - **Everything-in-Terraform (max declarativeness):** pass `-var image=<sha>` and run
     `terraform apply` in CI. Cleaner single source of truth, but every deploy is a TF
     apply (slower, needs plan review discipline). Given your "declare everything"
     preference, this is defensible — just gate it behind a required plan on PRs.
5. **Smoke test**: curl `/login` (200) and `/api/cron/refresh` with the secret (200
   JSON) against the new revision before shifting 100% traffic.

Keep a separate **`plan.yml`** on PRs: `terraform plan` posted as a comment — the
101-post's "STOP and READ the plan" discipline, enforced in review.

Environments: one Terraform workspace/dir per env (`dev`, `prod`) with its own tfvars
and GCS state prefix; the pipeline targets `prod` on `main`, `dev` on a `dev` branch.

---

## 9. App changes to land before the first deploy

Small, mostly mechanical — none block the design:

1. **Dockerfile → standalone multi-stage.** Replace the current dev Dockerfile
   (`npm run dev`) with a builder → runner image: `output: 'standalone'` in
   `next.config.ts`, `npm ci --omit=dev`, copy `.next/standalone` + `.next/static` +
   `public`, run as non-root on `node:22-slim` (or distroless). ~150–200 MB, the real
   image-size win.
2. **Single-flight advisory lock** in `/api/cron/refresh` (§2).
3. **`prisma migrate`** instead of `db push` (§6); commit an initial migration.
4. **Pool error handler** in `lib/db.ts` (§6).
5. (Optional now) **Keyless Drive** in `lib/googleAuth` (§5).
6. Set the Cloud Run **request timeout** (~300s) and decide **min-instances**: `0` for
   cost (cold starts on first hit, incl. the hourly cron waking it), or `1` for warmth.
7. **If IAP path (§4b):** read `X-Goog-Authenticated-User-Email` in `lib/session`
   instead of the next-auth session (a contained change; keep the stub-identity
   fallback for local dev and tests), and drop the next-auth Google provider config.
8. **Chat sender-domain check** (§7b): in `handleChatEvent`, reject any event whose
   `message.sender.email` is not on `AUTH_ALLOWED_DOMAIN` before ingesting. A few lines
   plus a test; closes the one code-level gap in the single-domain requirement.

---

## 10. Cost & ops notes

- **Cheap at rest:** Cloud Run scales to zero; Cloud SQL is the main fixed cost (use
  the smallest shared-core tier for an internal tool). Cloud Scheduler and Secret
  Manager are effectively free at this volume.
- **Observability:** Cloud Run stdout → Cloud Logging (the cron already logs a JSON
  report; the proxy request log is gated behind `DEBUG_REQUESTS`). Add a Cloud
  Monitoring alert on cron 5xx or `errors > 0` in the report.
- **Backups:** enable Cloud SQL automated backups + PITR in Terraform
  (`settings.backup_configuration`).
- **Custom domain + managed TLS:** optional `google_cloud_run_domain_mapping` (or a
  load balancer) if you don't want the `run.app` URL; update OAuth redirect URIs and
  the Chat App URL to match.

---

## 11. What I'd do next (suggested order)

1. Land the app changes in §9 (Dockerfile, migrations, advisory lock, pool handler).
2. Scaffold `infra/terraform/` (§4) with GCS remote state; `apply` the base (APIs,
   registry, Cloud SQL, secrets, a placeholder Cloud Run service).
3. Wire GitHub Actions with WIF; get build → push → deploy green to `dev`.
4. Add Cloud Scheduler; confirm the AI-update pipeline runs and the advisory lock
   single-flights it.
5. Point Google Chat at the Cloud Run URL; complete the Workspace admin allowlist.
6. Promote to `prod`.

I can scaffold the Terraform files and the GitHub workflow whenever you want — this doc
is the plan they'd implement.

---

### Sources

- [Running services on a schedule — Cloud Run](https://docs.cloud.google.com/run/docs/triggering/using-scheduler)
- [`google_cloud_scheduler_job` — Terraform Registry](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_scheduler_job)
- [Execute Cloud Run jobs on a schedule](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)
- [Cloud Scheduler HTTP target auth (OIDC)](https://docs.cloud.google.com/scheduler/docs/http-target-auth)
- [Connect from Cloud Run — Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/connect-run)
- [Prisma + Cloud SQL PostgreSQL on Cloud Run](https://oneuptime.com/blog/post/2026-02-17-prisma-orm-cloud-sql-postgresql-node-js-cloud-run/view)
- [Next.js on Cloud Run + Cloud SQL: errors you'll hit](https://www.pranavbhatkar.me/blog/2026/nextjs-cloud-run/deploying-nextjs-on-cloud-run-with-cloud-sql)
- [Terraforming 101 (conventions reference)](https://bitsby.me/2021/06/terraforming-101/)
