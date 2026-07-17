# AutoKnow — Operational Setup

Everything an operator needs to run AutoKnow with all integrations. Each section
says what breaks (honestly) when it's skipped — the app degrades feature-by-feature
rather than failing to start.

Two kinds of sections:

- **Active today** — used by the running app: database, Gemini, Google sign-in,
  refresh worker.
- **Prepared (not yet active)** — the service account and Chat app power the
  upcoming Drive/Chat sync (docs/INGEST_FRESHNESS_PLAN.md slices 3–4). You can
  provision them now; the app only starts using them when those slices ship.

---

## 1. Prerequisites & database (active)

- Node.js 18+ and Docker.
- Postgres with pgvector runs from the repo's compose file (service `db`, image
  `pgvector/pgvector:pg16`):

```bash
npm install
npm run db:up      # start Postgres (docker compose service "db")
npm run db:push    # apply prisma/schema.prisma
npm run dev        # dev server on :3000   (production: npm run build && npm run start)
```

`.env` (gitignored) is the single configuration surface — copy `.env.sample` and
fill in the sections below. Minimum viable: `DATABASE_URL` alone boots the app with
AI features off.

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/autoknow?schema=public"
```

Mock data: open `/admin` and click **Seed Mock Data**. In production the seeding
API (`/api/admin/seed`) requires the `x-admin-token` header matching `ADMIN_TOKEN`
in `.env`; without `ADMIN_TOKEN` set, destructive admin ops are allowed only in
non-production.

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
openssl rand -hex 24        # hex on purpose: no +/= characters (see note below)
```

Put it in `.env` and restart the app:

```
CRON_SECRET="6f2a…"
```

**Step 2 — verify by hand** before scheduling anything:

```bash
curl -s -H "Authorization: Bearer $YOUR_SECRET" https://YOUR_HOST/api/cron/refresh
```

- Correct secret → a JSON report: `{"due":0,"checked":0,"changed":0,"frozen":0,"errors":0,"skippedDrive":0}`
- Wrong/missing secret → `{"error":"Unauthorized"}` (401)
- `CRON_SECRET` not set server-side → 503 telling you so

Prefer the `Authorization: Bearer` header. `?secret=` also works, but if your
secret is base64 (from `openssl rand -base64 …` or `npx auth secret`) its `+`
characters decode as spaces in a query string and the match fails — the header
carries any characters verbatim; hex secrets are safe either way.

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

Google Docs are skipped by the worker until the service account (§5) is active —
refresh those manually from **Manage → Sources** while signed in. The worker route
is exempt from the sign-in gate (`src/proxy.ts`) precisely because a scheduler can
never hold a session; the secret is its authentication.

---

## 5. Service account for Drive sync (prepared — not yet active)

This is the identity users will *share docs and folders with* so AutoKnow can
discover and re-index them in the background. Decision record: plan §5 (service
account over a dedicated Workspace user or domain-wide delegation).

1. In the GCP project: **IAM & Admin → Service Accounts → Create service account**.
   Name e.g. `autoknow`. **Grant it NO roles** — Drive access comes purely from
   users sharing files with it, which is the consent boundary.
2. Note its email: `autoknow@<project-id>.iam.gserviceaccount.com`.
3. **Keys → Add key → Create new key → JSON** — download once, treat as a secret.
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

Today the key's presence only switches the notice on **Manage → Sources**; the
Drive delta feed, folder subscriptions, and background Doc refresh land with plan
slice 3.

---

## 6. Google Chat app (prepared — not yet active)

The mentionable identity for chat ingestion (`@AutoKnow` on a message → thread
saved). A service-account email can't be mentioned in Chat; the Chat *app* is the
share target, backed by the same GCP project.

1. Enable the **Google Chat API** in the project (APIs & Services → Library).
2. **APIs & Services → Google Chat API → Configuration** tab:
   - App name `AutoKnow`, avatar URL, description.
   - **Interactive features** → App URL: `https://YOUR_HOST/api/chat/events`
     (the route ships with plan slice 4 — configuring earlier is harmless; Chat
     just gets errors until it exists).
   - Optionally register a `/autoknow` slash command, and a message action
     ("Save to AutoKnow") — message actions are Developer Preview as of mid-2026.
   - **Visibility**: make the app available to your domain.
3. Users then add the app to a space and `@AutoKnow` messages to ingest them.

Scopes for the Chat paths, for reference:

| Path | Who authenticates | Scope | Where it's configured |
|---|---|---|---|
| `@AutoKnow` in a space (primary) | the app, as the service account | `https://www.googleapis.com/auth/chat.bot` | nowhere in the console — requested by the app's own credentials at call time |
| Copied message link pasted into `/ingest` (fallback) | the signed-in user | `https://www.googleapis.com/auth/chat.messages.readonly` | OAuth client **Data Access** screen (§3.1) |

There is also an existing plain-webhook endpoint `POST /api/integrations/chat`
(see README) that accepts pasted chat text today, independent of the Chat app.

---

## 7. Production notes

- `npm run build && npm run start -- -p <port>`. The dev server is not suitable
  for long-running demo use (it accumulates memory); use a production build.
- All env vars are read at server boot — restart after editing `.env`.
- Databases: e2e tests use a dedicated `<name>_test` database derived from
  `DATABASE_URL` and wipe it; they never touch the main one.
- Secrets recap (all in `.env`, all optional except `DATABASE_URL`):

| Var | Enables | Off ⇒ |
|---|---|---|
| `DATABASE_URL` | everything | app won't run |
| `GEMINI_API_KEY` | digests, summaries, semantic search | honest "AI off" states |
| `AUTH_SECRET` + `AUTH_GOOGLE_ID/SECRET` | Google sign-in, user-token Doc fetch | Doc links refuse; rest works |
| `AUTH_ALLOWED_DOMAIN` | domain-restricted sign-in | any Google account may sign in |
| `CRON_SECRET` | refresh worker route | worker refuses (503) |
| `ADMIN_TOKEN` | seeding API in production | destructive ops blocked in prod |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` | future Drive sync (slice 3) | Manage → Sources shows "Drive sync off" |
