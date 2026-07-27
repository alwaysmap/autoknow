# AutoKnow — Operational Setup

Everything an operator needs to run AutoKnow with all integrations. Each section
says what breaks (honestly) when it's skipped — the app degrades feature-by-feature
rather than failing to start.

Sections at a glance:

- **§1–§5, active everywhere** — database, Gemini, Google sign-in, refresh
  worker, Drive share-to-ingest (service account).
- **§6, the Chat app** — working in production since 2026-07-19 (read §6.0
  first). Google Chat delivers events over public HTTPS, so a laptop deployment
  additionally needs a tunnel or relay before @mention ingestion works.
- **§8–§9, production (Cloud Run)** — custom domain, and the deploy / redeploy /
  rollback runbook.

---

## 1. Prerequisites & database (active)

- Node.js 18+ and Docker.
- Postgres with pgvector runs from the repo's compose file (service `db`, image
  `pgvector/pgvector:pg16`):

```bash
npm install
cp .env.sample .env  # DATABASE_URL is the only required var (below); the rest gate features
npm run db:up        # start Postgres (docker compose service "db")
npm run db:push      # apply prisma/schema.prisma (LOCAL dev DB only — prod is migrate-only, see CHANGE_PLAYBOOK)
npm run dev          # dev server on :3000   (production: npm run build && npm run start)
```

`.env` (gitignored) is the single configuration surface — copy `.env.sample` and
fill in the sections below. Minimum viable: `DATABASE_URL` alone boots the app with
AI features off.

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/autoknow?schema=public"
```

Seeding: open `/admin`. **Seed Core Data** is idempotent and non-destructive —
it upserts the reference rows (regions, partner types, the Google partner) and
never wipes, so it's safe to re-run on a live database. **Seed Mock Data** and
**Wipe All Data** ARE destructive (they clear everything first). In production the
seeding API (`/api/admin/seed`) requires the `x-admin-token` header matching
`ADMIN_TOKEN` in `.env`; without `ADMIN_TOKEN` set, those ops are allowed only in
non-production.

**Wipe/re-seed is fail-closed against the wrong database.** Independent of the
auth above, `wipeAllData` (which seeding also runs first) refuses unless the
resolved `DATABASE_URL` names a `*_test` database OR `DESTRUCTIVE_DB_ALLOWED`
equals the exact database name. So a fat-fingered `DATABASE_URL` can never be
wiped by a confirmation meant for a different database — to wipe/seed the demo DB
you must set `DESTRUCTIVE_DB_ALLOWED="<its exact name>"` in that environment.

---

## 2. Gemini API key (active)

Powers document digestion, classification, embeddings for search, and the
leadership summaries.

1. Go to https://aistudio.google.com/apikey (any Google account).
2. **Create API key** — pick or auto-create a Google Cloud project.
3. Put it in `.env`:

```
GEMINI_API_KEY="AIza…"
```

4. Restart the server (the key is read at boot).

Without it: summary panels show "AI summaries are off", link ingestion refuses
rather than faking a digest, and search falls back to deterministic embeddings.
Already-generated summaries and digests keep rendering from cache.

Models used (see `src/lib/gemini.ts`): `gemini-flash-latest` for text,
`gemini-embedding-001` at 768 dims for embeddings. AI Studio free-tier keys work;
watch rate limits if you point a cron at the refresh worker aggressively.

---

## 3. One GCP project for everything Google (active + prepared)

Create a single Google Cloud project to host the OAuth client (active), the
service account, and the Chat app (both prepared):

1. https://console.cloud.google.com → project picker → **New project** → name it
   (e.g. `autoknow`).
2. Enable APIs (**APIs & Services → Library**):
   - **Google Drive API** (service id `drive.googleapis.com`) — the plain
     "Google Drive API", nothing else. The Library also lists **Drive Activity
     API** and **Drive Labels API**; AutoKnow uses neither. Everything here —
     exporting a Doc's text (`/drive/v3/files/{id}/export`) and the future
     `changes.list` delta feed — is the core Drive API v3.
   - **Google Chat API** — only when you set up the Chat app (§6).

### 3.1 Google sign-in / OAuth client (active)

Sign-in is what lets the app fetch a pasted Google Doc *as the signed-in user*
(scope `drive.readonly`, requested in `src/auth.ts`).

1. **Google Auth Platform → Clients → Create client** → type **Web application**.
2. Authorized JavaScript origin: `http://localhost:3000` (plus your real origin).
3. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   (same path on your real origin).
   **The port must match wherever the app actually runs** — a production build on
   :3100 needs `http://localhost:3100` and
   `http://localhost:3100/api/auth/callback/google` registered too, or sign-in
   fails with `redirect_uri_mismatch`. Registering several localhost ports on one
   client is fine.
4. On the **Data Access / scopes** screen add:
   - `https://www.googleapis.com/auth/drive.readonly` — used today (fetching a
     pasted Doc's text as the signed-in user).
   - `https://www.googleapis.com/auth/chat.messages.readonly` — prepared for the
     Chat link-paste fallback (plan slice 4): reading a copied Chat message link
     with the *user's* token when the AutoKnow app isn't in that space. Harmless
     to add now; the code doesn't request it yet (`src/auth.ts` will, in slice 4).

   These user scopes are separate from the Chat app's own scope: when the app
   itself calls the Chat API (reading @mentioned threads, replying), it
   authenticates as the service account with
   `https://www.googleapis.com/auth/chat.bot` — an app-auth scope that is NOT
   added on this screen and needs no user consent.
5. Fill `.env`:

```
AUTH_SECRET=""            # npx auth secret   (or: openssl rand -base64 32)
AUTH_GOOGLE_ID="…apps.googleusercontent.com"
AUTH_GOOGLE_SECRET="…"
AUTH_ALLOWED_DOMAIN=""    # e.g. yourcompany.com to restrict sign-in; empty = any Google account
```

Without it: everything works except fetching Google Doc links — pasting one
returns "sign in with Google first".

Note: while the OAuth consent screen is in **Testing** status, refresh tokens
expire after 7 days and only listed test users can sign in. **Publish** the app
for real use.

---

## 4. Refresh worker (active)

Watched sources (web pages, trackers) are re-checked by `GET /api/cron/refresh`.
The whole mechanism is **one shared string in two places**: the app's `.env` (so
the route can verify callers) and the scheduler's job definition (so it can present
it). Nothing else — no account, no OAuth.

**Step 1 — generate and configure:**

```bash
openssl rand -hex 24        # any random string works; hex is just tidy
```

Put it in `.env` and restart the app:

```
CRON_SECRET="6f2a…"
```

**Step 2 — verify by hand** before scheduling anything:

```bash
curl -s -H "Authorization: Bearer $YOUR_SECRET" https://YOUR_HOST/api/cron/refresh
```

- Correct secret → a JSON report combining the refresh counts with the Drive-sweep
  and summary-cycle results, e.g.
  `{"due":0,"checked":0,"changed":0,"frozen":0,"errors":0,"skippedDrive":0,"drive":{…},"summaries":{…}}`
- Wrong/missing secret → `{"error":"Unauthorized"}` (401)
- `CRON_SECRET` not set server-side → 503 telling you so

The secret is accepted **only** in the `Authorization: Bearer` header — a
`?secret=` query parameter is not supported (query strings land in access/tunnel
logs). The header carries any characters verbatim, so a base64 secret is fine; the
comparison is constant-time.

**Step 3 — schedule it.** Hourly is right; the per-connector cadences (trackers
6h, generic web weekly, snapshots never) are enforced inside the route, so calling
often is cheap.

*macOS — launchd (recommended over cron):* it's the native scheduler, and if the
Mac was asleep at the scheduled time launchd runs the job on wake, where cron
silently skips it. Save as `~/Library/LaunchAgents/com.autoknow.refresh.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.autoknow.refresh</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/curl</string>
    <string>-s</string>
    <string>-H</string><string>Authorization: Bearer PASTE_SECRET_HERE</string>
    <string>http://localhost:3100/api/cron/refresh</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>/tmp/autoknow-refresh.log</string>
  <key>StandardErrorPath</key><string>/tmp/autoknow-refresh.log</string>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.autoknow.refresh.plist   # install + start
launchctl start com.autoknow.refresh                               # fire once to test
tail /tmp/autoknow-refresh.log                                     # should show the JSON report
```

*Linux / anywhere with cron:* `crontab -e`, define the secret at the top (cron
does not read the app's `.env`):

```cron
AUTOKNOW_SECRET=6f2a…
0 * * * * curl -s -H "Authorization: Bearer $AUTOKNOW_SECRET" https://YOUR_HOST/api/cron/refresh > /dev/null
```

Without the service account (§5), Google Docs are skipped by the worker — refresh
those manually from **Manage → Sources** while signed in. With it, the same cycle
also runs the Drive sweep (the report gains a `drive` section). The worker route
is exempt from the sign-in gate (`src/proxy.ts`) precisely because a scheduler can
never hold a session; the secret is its authentication.

---

## 5. Service account for Drive sync (active)

This is the identity AutoKnow *authenticates as* to read Docs and folders in the
background. Decision record: plan §5 (service account over a dedicated Workspace
user or domain-wide delegation).

**It is not necessarily the address users share with.** On the Terraform-managed
deployment, sharing goes to a Workspace group — `autoknow@<domain>`
(`google_cloud_identity_group.share`) — that has this service account as a MEMBER,
because a service account cannot hold a vanity @domain email. Sharing with the group
grants the SA access, so users see a clean address and never a
`*.iam.gserviceaccount.com` one. Terraform passes the group to the app as
`GOOGLE_SHARE_ADDRESS`, which is the ONLY thing the Sources page will present as the
address to share with; without it the page names this service account explicitly as a
service account instead (`tests/driveShareAddress.test.ts` pins both halves). A manual
deployment with no group shares directly with the SA email below — that works, it is
just the fallback.

1. In the GCP project: **IAM & Admin → Service Accounts → Create service account**.
   Name e.g. `autoknow`. **Grant it NO roles** — Drive access comes purely from
   users sharing files with it, which is the consent boundary.
2. Note its email: `autoknow@<project-id>.iam.gserviceaccount.com`.
3. **Keys → Add key → Create new key → JSON** — download once, treat as a secret.
   If this is blocked, see §5.1 — new organizations block key creation by default.
4. Put the key in `.env`, either inline or as a path:

```
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account", …}'
# or
GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
```

5. **Check your Workspace sharing policy** (this is the one real gotcha): the
   service-account address is *external* to your domain. Admin console → Apps →
   Google Workspace → Drive and Docs → Sharing settings — external sharing must be
   allowed, or the address allowlisted, for users to share files with it.

### 5.1 "Service account key creation is disabled" — the sanctioned exception

New organizations ship with Google's Secure-by-Default org policy
`iam.disableServiceAccountKeyCreation` enforced, so step 3 fails with a policy
error. The console recommends Workload Identity Federation — the right answer
when the app runs somewhere with its own identity (GitHub Actions, AWS, GKE),
but a laptop/self-hosted deployment has no external identity provider to
federate from.

**Decision (recorded): use a key, via a project-scoped policy exception.** This
is proportionate because the account is designed with a tiny blast radius — zero
IAM roles; its only capability is reading documents explicitly shared with it. A
compromised key cannot touch the GCP project, billing, or infrastructure. This is
exactly the "if you must authenticate with a key" case in Google's own guidance.

As an org administrator (you may first need to grant yourself **Organization
Policy Administrator**, `roles/orgpolicy.policyAdmin`, on the *organization* node):

1. Console → select the **AutoKnow project** (not the org) →
   **IAM & Admin → Organization Policies**.
2. Search `iam.disableServiceAccountKeyCreation` → **Manage policy**.
3. **Override parent's policy** → rule: **Off (not enforced)** → **Set policy**.
4. Create the JSON key (§5 step 3), then optionally flip the override back
   **On** — existing keys keep working; you've only re-closed the door for
   future key creation.

Key hygiene that makes this genuinely fine:

- The key lives only in `.env` (mode `600`, gitignored) — never in a repo, chat,
  or doc.
- **Rotate ~90 days**: create new key → swap `.env` → restart → delete the old
  key in the console. Deleting a key kills it instantly org-wide — that is the
  kill switch if anything ever feels off.
- One key, one purpose: don't reuse this account or key for anything else.
- Keep secrets per-capability (this app already does: `CRON_SECRET`,
  `ADMIN_TOKEN`, `AUTH_SECRET`, `GEMINI_API_KEY` are all separate) so revoking
  one never breaks the rest.

Revisit keyless auth if the deployment moves off a personal machine: Workload
Identity Federation for CI/cloud hosts, or service-account impersonation via
`gcloud` ADC for a workstation (no stored key, but adds a gcloud dependency and
is not currently supported by `src/lib/googleAuth.ts`).

With the key in place (restart the app), every refresh-worker cycle (§4) sweeps
what's shared with the account: newly shared Google Docs are ingested and
classified automatically (folders count as subscriptions, one level deep), and
already-tracked Docs are re-checked when Drive metadata says they changed.
**Manage → Sources** shows the shareable address once the key is loaded. Current
limits: Google Docs only (Sheets/Slides are skipped), and per-cycle caps of 5
discoveries + 5 refreshes bound Gemini spend — the hourly cadence drains any
backlog quickly.

---

## 6. Google Chat app (WORKING in production since 2026-07-19 — read §6.0 first)

The mentionable identity for chat ingestion (`@AutoKnow` on a message → thread
saved). A service-account email can't be mentioned in Chat; the Chat *app* is the
share target.

### 6.0 The add-on era: what actually made delivery work (2026-07-19)

Every Chat app config the current console creates is **locked into the Google
Workspace add-on framework** ("Build this Chat app as a Workspace add-on" is
checked and immutable; the quickstart's "clear it" instruction is stale, and
disabling/re-enabling the Chat API does NOT reset the stored config). Two
consequences, each fatal on its own and both diagnosed red→green in prod:

1. **Delivery requires the add-on registration chain** — without it, every
   mention dies inside Google before any HTTP call (client shows "not
   responding"; error log shows code 13 + code 3 "can't handle the app's
   response"; your endpoint sees nothing). All console-only, in this order:
   - **OAuth consent screen** in the app's project (Google Auth Platform →
     Internal, app name, support email);
   - **Marketplace SDK** (`appsmarket-component.googleapis.com`) → App
     Configuration: visibility **Private** (immutable once saved!), integration
     "Google Workspace add-on" → **"Standalone Chat App (Configure Chat API)"**
     (Deployment ID stays empty — the gsuiteaddons deployment API has no `chat`
     section; standalone Chat apps live entirely in the Chat API config);
   - **Store Listing → Publish** (private = domain-only, no Google review;
     needs icons 32/48/96/128 + 220x140 banner + a screenshot + category +
     ToS/privacy/support URLs);
   - each user **installs** the app (the Install dialog only exists once the
     listing is published; find the app in Chat → New chat → search).
2. **The add-on runtime speaks a different protocol** (`User-Agent:
   Google-gsuiteaddons`), handled in `lib/chatEvents.ts` + the events route:
   - *Auth:* a standard Google **ID token** (issuer `accounts.google.com`) for
     `service-<PROJECT_NUMBER>@gcp-sa-gsuiteaddons.iam.gserviceaccount.com` —
     not the legacy `chat@system.gserviceaccount.com` JWT. Both are accepted;
     the add-on token is project-bound via that SA email claim.
   - *Events:* wrapped in `chat.messagePayload` / `chat.addedToSpacePayload`
     envelopes (no top-level `type`) — normalized by `normalizeChatEvent`.
   - *Replies:* must be wrapped as
     `hostAppDataAction.chatDataAction.createMessageAction` — `formatChatReply`.

**Self-test without a human** (the loop's reproducer): drive Chat web
(chat.google.com) with an authenticated browser session, DM the app, then read
`gcloud logging read '...httpRequest.requestUrl:"/api/chat/events"'` for the
POST + `textPayload:"[chat]"` for the JWT/type/reply verdicts. Green =
`200` + `jwt verified` + `type=MESSAGE addon=true` + `replied (text)` + an
in-thread reply.

**Duplicate apps:** every project that ever had a Chat config publishes its own
"AutoKnow". Dead ones (old projects) are disabled at the source (App status
DISABLED + Chat API off) but linger in clients — delete their DM threads
manually. The real app has the navy hill-logo avatar.

The sections below predate the add-on-era discovery; the admin-policy checks
remain valid prerequisites but were NOT sufficient on their own.

**Workspace admin prerequisites (checked first — these block delivery silently):**

- admin.google.com → Apps → **Google Workspace Marketplace apps → Settings**:
  app access must allow users to install and run apps (a new Secure-by-Default
  org ships allowlist-restricted; a restricted org lets an internal app be
  *installed and mentioned* while its event delivery fails with internal errors).
- admin.google.com → Apps → Google Workspace → **Google Chat**: Chat apps must be
  allowed for users.
- Admin policy changes propagate slowly — **up to 24 hours**. Do not judge a test
  minutes after changing these.

1. Enable the **Google Chat API** in the project (APIs & Services → Library).
   The Chat app may live in a **dedicated GCP project** — useful because a
   config that has been through heavy churn can end up in a corrupted server-side
   state that survives even disabling/re-enabling the API; a fresh project is a
   fresh app identity. If you do this, `GOOGLE_PROJECT_NUMBER` must be THAT
   project's number, while the service account stays wherever it is.
2. Set the project NUMBER in `.env` (the audience of the JWTs Chat sends):

```
GOOGLE_PROJECT_NUMBER=""   # gcloud projects describe <project-id> --format="value(projectNumber)"
```

3. **APIs & Services → Google Chat API → Configuration** tab:
   - App name `AutoKnow`, avatar URL, description.
   - **Interactive features** → App URL: `https://YOUR_PUBLIC_HOST/api/chat/events`.
     Google Chat calls this over public HTTPS — `localhost` will not work, and in
     practice Chat's delivery is only dependable to standard-port, reputable
     hosts. In production this is simply the Cloud Run/custom-domain URL.
     (The laptop-era relay — a Cloud Run proxy + Tailscale Funnel in
     `infra/chat-relay`, plus an `x-autoknow-original-host` shim in the events
     route — was removed 2026-07 once the app itself ran on Cloud Run; resurrect
     it from git history if a laptop deployment ever needs Chat again.)
     Cache warning: Chat aggressively caches app metadata/config — after config
     changes, wait (up to an hour) before judging a test; rapid edit/reinstall
     cycles keep hitting stale state and can themselves produce
     "internal error" delivery failures.
   - Optionally register a `/autoknow` slash command, and a message action
     ("Save to AutoKnow") — message actions are Developer Preview as of mid-2026.
   - **Visibility**: make the app available to your domain.
4. Users then add the app to a space and `@AutoKnow` messages to ingest them.
   The endpoint (`/api/chat/events`) verifies the JWT Chat sends (issuer
   `chat@system.gserviceaccount.com`, audience = your project number), saves the
   thread-as-of-now (re-mentions become revisions), and replies in-thread.

Scopes for the Chat paths, for reference:

| Path | Who authenticates | Scope | Where it's configured |
|---|---|---|---|
| `@AutoKnow` in a space (primary) | the app, as the service account | `https://www.googleapis.com/auth/chat.bot` | nowhere in the console — requested by the app's own credentials at call time |
| Copied message link pasted into an Add-link control (fallback) | the signed-in user | `https://www.googleapis.com/auth/chat.messages.readonly` | OAuth client **Data Access** screen (§3.1) |

**Troubleshooting delivery ("app not responding" / silence):**

- Enable **Log errors to Logging** in the Chat config, then read Google's own
  delivery errors:
  `gcloud logging read 'resource.type="chat.googleapis.com/Project"' --project=<chat-project> --freshness=1h`
- Error **code 13 ("internal error … processing the bot response")** paired with
  zero requests in your endpoint's logs means Chat failed *before making any
  HTTP call* — the endpoint, tunnel, and config values are innocent; suspect the
  Workspace admin prerequisites above (or their propagation window).
- Ground truth for "did Google ever call us": Cloud Run request logs —
  `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="autoknow" AND httpRequest.requestUrl:"/api/chat/events" AND httpRequest.requestMethod="POST"' --project=autoknow-prod-1895f1 --freshness=4h`
  (every POST with status + user agent; your own curl probes are identifiable).
- The app-side route logs every arrival and the precise JWT verdict (no bearer /
  bad issuer / audience mismatch with both values / unknown key).
- A mention only generates an event if the app was picked as a **chip** from the
  @-popup — typed plain "@autoknow" text posts silently and delivers nothing.

There is also an existing plain-webhook endpoint `POST /api/integrations/chat`
that accepts pasted chat text today, independent of the Chat app. It is NOT open —
it requires a signed-in session or the `x-admin-token` header — and it stores
briefings through the normal ingest pipeline (digest, embedding, revision history).
**The command is in [README](../README.md#ingesting-status-updates-via-chat-webhook);
probe the deployed origin, not `localhost`** — the perimeter gate does not exist
locally, so a local success proves nothing about production. Reading the result:

| Code | Meaning |
|---|---|
| `200` | Ingested. |
| `403` | Wrong or absent `ADMIN_TOKEN`, rejected at the perimeter before the handler. |
| `307` → `/login` | The gate lost its exemption for this path — the #157 regression. See `acceptsAdminToken` in `src/proxy.ts` and [the knowledge note](knowledge/machine-endpoint-needs-exemption-and-credential.md). |

The former `/ingest` page is retired — pasting links lives in
the **+ Add link** control on program/partner pages (scoped) and Manage → Sources
(unscoped).

---

## 7. Production notes

- `npm run build && npm run start -- -p <port>`. The dev server is not suitable
  for long-running demo use (it accumulates memory); use a production build.
- All env vars are read at server boot — restart after editing `.env`.
- The app serves baseline security headers (CSP, HSTS, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`) on every response — relevant if it sits behind a
  proxy that also sets them (avoid duplicates). See `next.config.ts`.
- Databases: e2e tests use a dedicated `<name>_test` database derived from
  `DATABASE_URL` and wipe it; they never touch the main one. Destructive app ops
  (wipe / mock-seed) additionally refuse any non-`*_test` database unless
  `DESTRUCTIVE_DB_ALLOWED` names it exactly (see §1).
- Secrets recap (all in `.env`, all optional except `DATABASE_URL`):

| Var | Enables | Off ⇒ |
|---|---|---|
| `DATABASE_URL` | everything | app won't run |
| `GEMINI_API_KEY` | digests, summaries, semantic search | honest "AI off" states |
| `AUTH_SECRET` + `AUTH_GOOGLE_ID/SECRET` | Google sign-in, user-token Doc fetch | Doc links refuse; rest works |
| `AUTH_ALLOWED_DOMAIN` | domain-restricted sign-in | any Google account may sign in |
| `CRON_SECRET` | refresh worker route (bearer only) | worker refuses (503) |
| `ADMIN_TOKEN` | admin API auth (seed/reindex/chat webhook) | in prod, admin ops need it; unset ⇒ blocked in prod |
| `DESTRUCTIVE_DB_ALLOWED` | wipe / mock-seed of a non-`*_test` DB | destructive ops refuse (fail closed) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` | Drive share-to-ingest + background Doc refresh | worker skips Docs; manual refresh only |
| `GOOGLE_PROJECT_NUMBER` | Chat event JWT verification (§6) | /api/chat/events refuses (503) |

---

## 8. Custom domain (Cloud Run production)

The production app serves on **https://autoknow.alwaysmap.com** (and continues to
serve on the canonical run.app URL). Split of responsibilities, and where to go
when something needs changing:

**Terraform** (`infra/terraform/`, var `custom_domain` in
`instances/<name>.tfvars`): the `google_cloud_run_domain_mapping` — free
Google-managed TLS, no load balancer — and `AUTH_URL`, which follows
`custom_domain` automatically. Changing or removing the domain is a tfvars edit
→ infra PR → `terraform apply`, per the CHANGE_PLAYBOOK.

**Deliberately NOT Terraform** (know where these live before touching anything):

- **DNS.** The `alwaysmap.com` zone is not in GCP. It is managed in
  **Squarespace's DNS UI** (account `dvhthomas@gmail.com` — the domain arrived in
  the Google Domains → Squarespace migration; the `ns-cloud-b*.googledomains.com`
  nameservers still serve it). It hosts the org's **Google Workspace MX records**
  and the GitHub Pages site records — which is exactly why we chose not to migrate
  the zone into Cloud DNS for the sake of one record. The one AutoKnow record:
  `CNAME autoknow → ghs.googlehosted.com` (TTL 4h). Squarespace has **no DNS
  API**, and every editing session demands a fresh authenticator-app 2FA code
  (step-up re-prompts per protected action; there is no email fallback).
- **OAuth redirect URIs.** The web client (`ak-webclient`, old project
  `autoknow-alwaysmap`) must list a callback per serving origin; both
  `https://autoknow-1009926574065.us-central1.run.app/api/auth/callback/google`
  and `https://autoknow.alwaysmap.com/api/auth/callback/google` are registered.
  Console-only (no API for consumer OAuth clients).

**Domain ownership.** Creating a Cloud Run domain mapping requires the applying
identity to be a **verified Search Console owner** of the parent domain.
`dylan@alwaysmap.com` already is — via the Workspace-era
`google-site-verification` TXT on the `alwaysmap.com` apex — so applies just
work; confirm with `gcloud domains list-user-verified`. A different operator
would need their own verification (Site Verification API DNS_TXT, or Search
Console) before `terraform apply` can create a mapping.

**TLS.** The managed certificate provisions itself once the mapping exists *and*
the CNAME resolves (15–60 min typical) and renews automatically — but only while
the CNAME stays in place. Status:

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/autoknow-prod-1895f1/domainmappings/autoknow.alwaysmap.com" \
  | jq '.status.conditions'   # Ready=True when live; CertificatePending while issuing
```

**Gotcha:** `alwaysmaps.com` (with an s) is a stranger's domain — Tucows-registered,
Route 53-hosted, nothing to do with us. Don't buy records, mappings, or
verifications against it.

---

## 9. Production deploys — redeploy, verify, roll back (Cloud Run)

How code reaches production, and what to do when it doesn't. Full pipeline rules:
[CHANGE_PLAYBOOK.md](CHANGE_PLAYBOOK.md); architecture: [DEPLOYMENT_GCP.md](DEPLOYMENT_GCP.md).

**What deploys, when.** Merging to `main` triggers `.github/workflows/deploy.yml`:
job `migrate` (forward-only `prisma migrate deploy`) then job `deploy`
(build → push to Artifact Registry → `gcloud run services update` with the
commit-SHA image tag). Two caveats operators trip on:

- **Path filter:** only changes under `src/`, `prisma/`, `public/`, the build
  files, `scripts/ci/`, or the workflow itself trigger a deploy. A docs-only or
  tests-only merge deploys nothing — that is by design, not a failure.
- **Serialization:** deploy runs share a workflow concurrency group (`deploy`),
  so exactly one runs at a time and the newest queued merge supersedes older
  queued ones. Before this existed (2026-07-20), five near-simultaneous merges
  raced their Cloud Run updates: runs finished out of order, one failed with
  `ABORTED: Conflict for resource 'autoknow': version ...`, and prod ended up
  serving the OLDEST commit while every newer run reported success. If you ever
  see that ABORTED conflict again, suspect parallel deploys and check what's
  actually serving (below).

**Verify what production is actually serving** (don't trust a green run — trust
the service). Quickest: the health endpoint reports the running commit —

```bash
curl -s https://autoknow.alwaysmap.com/api/health   # → {"ok":true,"sha":"<commit>","db":"ok"}
# the sha should match `git log origin/main -1`
```

or ask Cloud Run directly:

```bash
gcloud run services describe autoknow --region us-central1 \
  --project autoknow-prod-1895f1 \
  --format='value(status.latestCreatedRevisionName, spec.template.spec.containers[0].image)'
# the image tag is the git SHA — compare against `git log origin/main -1`
```

**Redeploy current `main`** (stale prod, superseded run, or a docs-merge day when
you want a rebuild anyway) — the workflow has `workflow_dispatch`:

```bash
gh workflow run deploy.yml --repo alwaysmap/autoknow --ref main
gh run watch --repo alwaysmap/autoknow   # or: gh run list --workflow=deploy.yml
```

Migrations are idempotent (`migrate deploy` re-applies nothing), so a redeploy is
always safe.

**Roll back.** Two options, in order of preference:

1. **Fix-forward or revert the commit** and let the pipeline deploy it — keeps
   `main` and prod in agreement.
2. **Emergency traffic shift** to the previous revision while the fix lands:

```bash
gcloud run revisions list --service autoknow --region us-central1 --project autoknow-prod-1895f1
gcloud run services update-traffic autoknow --region us-central1 \
  --project autoknow-prod-1895f1 --to-revisions <previous-revision>=100
```

Traffic shifting does NOT undo migrations — that's why the playbook requires every
migration to be safe for the previous revision too (expand → backfill → contract).
After the fix deploys, return traffic to latest:
`gcloud run services update-traffic autoknow --region us-central1 --project autoknow-prod-1895f1 --to-latest`.

**Deploy failed?** `migrate` red → the rollout never started; prod still serves
the old revision; fix forward (playbook §"If a migration fails in CI").
`deploy` red after a green `migrate` → the new image never took traffic; rerun via
`workflow_dispatch` once the cause (quota, registry, the old parallel-deploy race)
is addressed.

### Running a data backfill against production

A backfill is never part of `migrate deploy` — it makes judgements whose leftovers
somebody has to read. Run it from **Actions → Run DB backfill**, **with the branch left on
`main`**: pick the backfill, type `autoknow-pg` to confirm, Run workflow. A dispatch runs
the workflow AND the scripts from whatever ref you select, so a stale branch would run a
stale backfill. Nothing else can reach the prod database with it, and nobody needs a
password
([ADR](adr/2026-07-26-a-backfill-reaches-prod-through-an-allowlisted-dispatch-runner.md)).

**The one arm you must run from a BRANCH, and why that is not a hole.** A `db:check:*`
arm that gates a PR ships *inside* that PR, so on `main` the option does not exist yet and
the dropdown will not offer it. Dispatch it with an explicit ref:

```bash
gh workflow run db-backfill.yml --ref <the-PR-branch> -f backfill=<check> -f confirm=autoknow-pg
```

Run-from-`main` exists because a dispatch runs whatever code the ref carries, and a
`db:backfill:*` arm WRITES. A `db:check:*` arm only `SELECT`s, as the DML-only
`app_runtime` role, so the thing the rule protects is not at stake — and the alternative
(land the constraint, discover the conflict from a failed `migrate deploy`) is the outcome
the check exists to prevent. Read the branch's diff of `scripts/db/backfill.sh` and the
script the arm names before dispatching, exactly as you would trust any other code you are
about to point at production. **Never** use `--ref <branch>` for a `db:backfill:*` arm.

Before you fire it, the migration that adds the target column must already be in prod
(`curl -s https://autoknow.alwaysmap.com/api/health` for the serving sha). Afterwards the
report is on the run's **summary page**, not just in the log. Stop conditions: a
*permission denied* (the role model drifted — run `Harden DB role` with `MODE=diagnose`,
never retry as `app`), a missing column (the migration has not landed), or a large
`skipped:` count (something was writing concurrently — re-run and compare). Unmatched or
ambiguous rows are not failures: they are rows the script refused to guess at, left
untouched for you to fix at source. Re-running is always safe.

```bash
gh workflow run db-backfill.yml --ref main -f backfill=owner-person -f confirm=autoknow-pg
gh run watch   # or read the summary page for the report
```

#### The backfills, and what their reports mean

| `backfill=` | Fills | Ships with | Its gate |
|---|---|---|---|
| `owner-person` | `Project.ownerPersonId` from the `ownerName` text | #127 E6, migration `20260726232108_project_owner_person_id` | zero unmatched + zero ambiguous before E7 retires the `ownerName` readers |
| `affiliation-email` | `PersonAffiliation.email` from `Person.email` | #127 E8, migration `20260727020837_affiliation_email` | zero uncovered + zero ambiguous before E9 adds the unique-at-an-instant constraint |
| `email-conflicts` | **nothing — READ-ONLY.** Reports addresses recorded against two people over overlapping periods | #127 E9, migration `20260727040058_unique_at_an_instant` | zero conflicts, or that migration fails and blocks the deploy |

**`email-conflicts` — the one arm that writes nothing.** It runs
`npm run db:check:email-conflicts`, which only SELECTs. It exists because an exclusion
constraint cannot be added `NOT VALID`: `ALTER TABLE … ADD CONSTRAINT … EXCLUDE`
validates every existing row at once, and one offender fails `prisma migrate deploy` —
which runs BEFORE the deploy job, so it would block the release of everything merged
alongside it. Run it BEFORE merging anything that adds the constraint (which is the
branch-ref case above: while that PR is open, `main` does not offer this option yet).

```bash
gh workflow run db-backfill.yml --ref main -f backfill=email-conflicts -f confirm=autoknow-pg
```

A green run reporting `No conflicts` is the go-ahead. A **red run is the answer, not a
breakage**: this arm exits non-zero when it finds something, and the report on the summary
page names each address with both people and both periods. Nothing about the check changes
any data, so it can be run as often as you like.

Fixing what it finds depends on which periods clash, and only one case has an in-app path
today:

- **Both periods are CURRENT** (both `→ open`, or both covering today): edit the losing
  person on `/people/<id>` and give them the address they actually use. That corrects the
  period covering today along with the record (`updatePerson` since #127 E9).
- **Either period is CLOSED**: there is no editor for a historical period's address.
  Bead `autoknow-164` covers giving the dispatch runner a remediation arm; until it lands
  this needs a hand-written statement run by someone with database access, so **check
  before you merge** rather than discovering it from a failed deploy.

**If the migration already failed on it**, the failure is atomic — no data changed, the
constraint was not created — but `prisma migrate deploy` has recorded the attempt, so
every later deploy dies with **P3009 on this same migration** until you clear it:

```bash
npx prisma migrate resolve --rolled-back 20260727040058_unique_at_an_instant
```

That is safe HERE specifically because the migration runs in one transaction and raised
before any statement committed. It is not a general remedy — a migration that failed
part-way needs a human who knows what landed (the `db-change` skill).

It is also the one place these docs invoke `prisma` directly rather than through an npm
script, and deliberately: AGENTS.md's rule exists so routine work goes through reviewed,
repeatable scripts, and wrapping this would make a one-off recovery — which must be typed
by someone who has read the failure and understands what did NOT land — look routine.

**`affiliation-email` — reading the report.** The preflight and the stop conditions are
the ones above; what is specific to this one is what its numbers MEAN.

```bash
gh workflow run db-backfill.yml --ref main -f backfill=affiliation-email -f confirm=autoknow-pg
```

The report on the run's summary page looks like this, and every line of it is expected:

```
People with an address-less employment period: 12
  linked:          9
  already had one: 1
  uncovered:       1
  ambiguous:       1
  UNCOVERED  #4 Carla Reyes — no period covers today, so “carla@…” belongs to none of them
  AMBIGUOUS  #7 Dan Ito — 2 periods cover today: Google LLC (period #18), Bosch (period #22)

Past/future periods still with no address: 31.
```

Read it in this order:

- **`Past/future periods still with no address` is NOT a leftover to chase.** Nothing
  ever recorded what address those jobs used, and NULL says so honestly. Expect it to be
  the largest number on the page and to shrink only as people are edited from here on.
- **`AMBIGUOUS` is the one that means STOP.** Two periods covering the same day is
  overlapping affiliation data — a bug in its own right (bead `autoknow-2of`), not a
  naming problem. Fix the overlap on `/people/<id>`, then re-run.
- **`UNCOVERED` means look, not stop.** That person's career has a gap over today, or is
  entirely past or entirely future, so their current address belongs to none of the
  periods on file. Usually a missing period; sometimes simply true. Fix at source and
  re-run, or accept it.
- **A non-zero `linked` on a re-run is normal, not a bug.** The target is whichever
  period covers the RUN instant, so somebody who has changed jobs since the last run
  gets their new period stamped. The script only ever writes where the column is still
  NULL, so re-running is always safe.

---

## 10. Monitoring & logs — where to look, what to run

Everything an operator needs to answer "is it up, what's it running, what went
wrong" — as URLs to open and commands to paste. Project `autoknow-prod-1895f1`,
service `autoknow`, region `us-central1`.

### The health endpoint

`GET /api/health` — public (no sign-in), safe (no secrets), never cached:

```bash
curl -s https://autoknow.alwaysmap.com/api/health
# {"ok":true,"sha":"e9024c6…","db":"ok"}
```

- `sha` — the exact commit the running image was built from. **This is the
  fastest deploy check:** compare it to `git log origin/main -1` and you know
  whether the latest merge is actually serving (the 2026-07-20 out-of-order
  deploy would have been caught in one curl).
- `db` / HTTP 503 — Postgres unreachable from the app.
- It only *responds*, it doesn't *record* — history comes from an uptime check
  (below) or the request logs.

### Where to look (URLs)

| What | URL |
|---|---|
| Deploy pipeline runs | https://github.com/alwaysmap/autoknow/actions/workflows/deploy.yml |
| All CI runs (lint, terraform plan) | https://github.com/alwaysmap/autoknow/actions |
| Cloud Run service — logs tab (live, filterable) | https://console.cloud.google.com/run/detail/us-central1/autoknow/logs?project=autoknow-prod-1895f1 |
| Cloud Run — metrics (requests, latency, 5xx, instances) | https://console.cloud.google.com/run/detail/us-central1/autoknow/metrics?project=autoknow-prod-1895f1 |
| Cloud Run — revisions (what's deployed, traffic split) | https://console.cloud.google.com/run/detail/us-central1/autoknow/revisions?project=autoknow-prod-1895f1 |
| Logs Explorer (ad-hoc queries over everything) | https://console.cloud.google.com/logs/query?project=autoknow-prod-1895f1 |
| Error Reporting (deduped stack traces, auto-collected) | https://console.cloud.google.com/errors?project=autoknow-prod-1895f1 |
| Cloud Scheduler (cron tick history + last status) | https://console.cloud.google.com/cloudscheduler?project=autoknow-prod-1895f1 |

### How log severity works here (no code changes needed)

Cloud Run captures the container's output automatically: **stdout → severity
`DEFAULT`** (`console.log`), **stderr → severity `ERROR`** (`console.error` and
`console.warn` — Node sends both to stderr). Request/response lines (status,
latency, URL) are logged separately by Cloud Run itself as `httpRequest` entries.
So "warn and fatal without debug noise" is a *filter you apply when reading*,
not a logging config: query `severity>=WARNING` and you get app errors/warnings
plus 4xx/5xx requests, nothing else. (If per-level filtering ever matters more,
the upgrade is structured logging — print one JSON object per line with a
`severity` field and Cloud Logging adopts it — but it isn't needed for this.)

### Commands (CLI)

```bash
# Tail the service live (Ctrl-C to stop; needs the beta component once: gcloud components install beta)
gcloud beta run services logs tail autoknow --project autoknow-prod-1895f1

# Recent warnings + errors only — app stderr and failed requests, no info noise
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="autoknow" AND severity>=WARNING' \
  --project autoknow-prod-1895f1 --freshness=2h \
  --format='table(timestamp,severity,httpRequest.status,textPayload)'

# Only 5xx responses (who got errors, on which URLs)
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="autoknow" AND httpRequest.status>=500' \
  --project autoknow-prod-1895f1 --freshness=24h \
  --format='table(timestamp,httpRequest.status,httpRequest.requestMethod,httpRequest.requestUrl)'

# Did the hourly refresh worker run, and what did it report?
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="autoknow" AND httpRequest.requestUrl:"/api/cron/refresh"' \
  --project autoknow-prod-1895f1 --freshness=6h \
  --format='table(timestamp,httpRequest.status)'

# What is prod running right now? (also: curl /api/health and read .sha)
gcloud run services describe autoknow --region us-central1 \
  --project autoknow-prod-1895f1 \
  --format='value(status.latestCreatedRevisionName, spec.template.spec.containers[0].image)'

# Deploy pipeline from the terminal
gh run list --repo alwaysmap/autoknow --workflow=deploy.yml --limit 5
gh run watch --repo alwaysmap/autoknow          # attach to the running one
gh run view <run-id> --repo alwaysmap/autoknow --log-failed
```

Chat delivery debugging (a different log stream — Google's own delivery errors,
not the app's): see §6's troubleshooting block.

### Worth adding when you want paging, not just looking

A **Cloud Monitoring uptime check** against `/api/health` with an alerting
policy (email/SMS on failure) turns the endpoint into 24/7 monitoring, and an
**alert on log severity ≥ ERROR** catches app-level breakage between uptime
probes. Both are Terraform-able (`google_monitoring_uptime_check_config`,
`google_monitoring_alert_policy`) — infra PR + human `terraform apply` per the
playbook.
