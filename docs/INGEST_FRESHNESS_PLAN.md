# Ingested Content Freshness — Design Plan

Status: **Plan only** (no code written yet). Decisions below are proposed; the one
explicitly flagged for review is §3 (how volatility is decided and what users see).

## Goal

Keep ingested context (Drive docs, chat messages, web pages, bugs, change requests)
fresh **without re-indexing vast amounts of information**: re-read only sources that
plausibly changed, re-distill only content that actually changed, and make every
refresh visible as product signal (activity feed + summary staleness) rather than a
silent database write.

Non-goals: real-time sync, full-text archival of sources (we store digests, never
originals), crawling anything not explicitly shared/linked.

---

## 1. What already exists

One-shot snapshot ingestion (`src/lib/ingest.ts`):

- `/ingest` accepts a pasted URL or raw text. Google Docs are exported as plain text
  using **the signed-in user's OAuth token** (`src/lib/google-docs.ts`). ⚠️ unusable
  from a background worker — no user session there.
- Gemini distills a digest (`summarizeDocument`), classifies it to a program/partner
  (`classifyContext`), embeds the digest (`embedText`).
- Result is **one immutable `ContextUrl` row**: `url`, `type` ("Chat"|"Doc"|"Gerrit"),
  `title`, `ingestedText` (the digest), `embedding`, `createdAt`. No source version,
  no content hash, no re-check schedule, no revision history.
- Leadership summaries already compute staleness from "scope-relevant rows newer than
  the cached summary" (`src/lib/summaries.ts`) — refreshed context automatically makes
  summaries regenerate. ✅ no new plumbing needed downstream.

---

## 2. Volatility model

Every watched source gets a **volatility class** — a property of the *source*, not of
the schedule:

| Class | Meaning | Refresh behavior |
|---|---|---|
| `immutable` | A point-in-time event. The content it had at ingest is the content it will always have. | Never re-checked. Zero standing cost. |
| `living` | An artifact people keep editing (running notes, specs). | Re-checked on the adaptive schedule (§6). |
| `until-closed` | An artifact with a lifecycle that ends (bug, change request). | Re-checked while open; **frozen** (→ effectively immutable) when it reaches a terminal state. Reopening unfreezes. |

Freezing is a one-way state transition recorded on the row (`frozenAt`,
`frozenReason`: `closed` | `merged` | `access-revoked` | `deleted` | `user-paused`),
so the UI can say honestly *why* a source is no longer tracked.

This single classification removes most re-indexing pressure: chat messages and closed
CRs — the bulk of volume over time — cost nothing forever.

---

## 3. DECISION — who decides volatility, and what the user sees

**Decision: the system infers volatility deterministically from the source type;
users see the *consequence* (freshness provenance), never the class as a required
input.** A per-item override exists, tucked away, for the one genuinely ambiguous
case (generic web URLs).

Rationale:

- At ingest time, a user pasting a link neither knows nor cares about our taxonomy.
  A required "how volatile is this?" picker is friction that will be answered wrong
  and then be sticky — worse than a good default.
- For four of the five source types the class is not a judgment call; it is a fact
  about the medium (a sent chat message does not change; a Gerrit change merges).
  Asking the user to confirm a fact is noise.
- What users *do* care about is trust: "is this fresh?" So the UI surfaces
  **provenance, not taxonomy**: "checked 2h ago · last changed Jul 12", a frozen
  badge with its reason, and a manual **Refresh now** on living items.

### 3.1 Inference table (per source, keyed on URL shape / connector)

| Source | Detected by | Class | Why |
|---|---|---|---|
| Google Drive file (Doc/Sheet/Slide) | `docs.google.com/…`, `drive.google.com/file/…`, Drive fileId | `living` | Drive exposes `version`/`modifiedTime` and a delta feed; docs are edited indefinitely. Meeting-notes docs are the canonical case. |
| Google Drive **folder** | folder URL / shared with service account | `living` (a *subscription*, §5) | New children appear; children are classified individually. |
| Chat message (Google Chat permalink, pasted transcript) | `chat.google.com/…` / raw text paste | `immutable` | A sent message is an event. Edits are rare and immaterial to leadership signal. Pasted raw text has no re-fetchable source at all. |
| Bug / issue (Buganizer, GitHub issue) | `b.corp.google.com/issues/…`, `github.com/../issues/…` | `until-closed` | Status + comments move while open; terminal on `FIXED`/`closed`. Reopen events unfreeze. |
| Change request (Gerrit, GitHub PR) | `…-review.googlesource.com/c/…`, `github.com/../pull/…` | `until-closed` | Active until `merged`/`abandoned`, then permanently frozen. |
| Generic web URL | anything else | `living`, **low confidence** | No reliable change metadata. Conditional GET (`ETag`/`If-Modified-Since`) where the server supports it, else content hash on a slow cadence that decays fast (§6). |

Each row stores `volatilitySource: 'inferred' | 'user'` so an override is never
silently re-inferred away.

### 3.2 Where it surfaces in the UI

- **Quick-ingest component (§5.2)**: on paste, the inferred tracking mode appears as
  a **visible, tappable chip** — "Watched (Google Doc)" / "Until closed (bug)" /
  "Snapshot (chat message)". Inference prefills it; clicking Add accepts it; tapping
  the chip cycles Snapshot / Watch / Until closed. Never a required question — but
  always visible and correctable at the moment the user has the most context.
- **Ingest result** (existing `/ingest` flow): same chip, same behavior.
- **Context items in feeds/search**: freshness provenance on hover/subtitle
  ("checked 2h ago"), frozen badge where applicable ("frozen — merged Jul 3").
- **Manage → Sources** (new page, consistent with Manage → Prompts): the full watch
  list — every tracked source, class, cadence, `lastCheckedAt`/`lastChangedAt`, next
  check, and per-row actions **Refresh now** / **Pause** / **Change tracking**. This
  is the operator view; day-to-day users never need it.

---

## 4. Change detection — cheap metadata first, content hash second

Two gates before any Gemini spend:

**Gate 1 — did the source *say* it changed?** (no content fetch)

- **Drive**: one `changes.list` call per refresh cycle with a stored `pageToken` —
  returns only fileIds changed since the last cycle, for the whole corpus, O(1) calls
  regardless of corpus size. Also reports new shares and removals (§5). Per-file
  fallback: `files.get?fields=version,modifiedTime`.
- **Web**: conditional GET with stored `ETag`/`Last-Modified`; a `304` costs ~nothing.
  Servers without either → fetch and rely on Gate 2.
- **Gerrit / issues**: status endpoint (`GET /changes/<id>?o=CURRENT_REVISION` etc.);
  compare `status` + `updated`. Terminal status → freeze, skip Gate 2 forever.
- **Chat**: no gate — never checked.

**Gate 2 — did the *text* change?** `modifiedTime` moves on renames, comment
resolutions, permission tweaks. So: fetch, normalize (strip whitespace runs, export
artifacts), SHA-256, compare to stored `contentHash`. Unchanged → touch
`lastCheckedAt`, widen the interval (§6), stop. Changed → §7.

---

## 5. Ingest triggers — sharing with the app's identity

**DECIDED: the app's Drive identity is a GCP service account.** Alternatives
considered and rejected:

- *Dedicated Workspace user* (e.g. `autoknow@alwaysmap.com`): in-domain email (nicer
  sharing UX, immune to external-sharing blocks) but headless auth rides on an
  interactively-minted OAuth refresh token — a fragile artifact subject to expiry,
  admin revocation, and human-account policy (2FA/password rotation/inactive-account
  sweeps) — plus a seat license and a full Gmail-bearing attack surface.
- *Service account + domain-wide delegation* (key-based auth impersonating a domain
  user): the impersonation grant is a far bigger security ask than the problem
  warrants.

The service account authenticates by key (no session, no consent flow, no token to
lose), costs no seat, and can do exactly one thing: read what was shared with it.
**Prerequisite this creates**: the service-account address is *external* to the
Workspace domain — the domain's Drive sharing policy must permit sharing to it
(Admin console → Drive → Sharing settings; allowlist the address/domain if external
sharing is otherwise blocked). Slice 3 of the rollout starts with verifying this.

The service account gives the app a shareable email address
(`autoknow@<gcp-project>.iam.gserviceaccount.com`). Sharing a file or folder with
that address *is* the consent boundary and the discovery mechanism:

- Shared **file** → ingested as a normal `living` source.
- Shared **folder** → a standing subscription: children (current and future) are
  discovered via the same `changes.list` feed, ingested and classified individually,
  announced in the activity feed ("3 documents shared via *EX90 Weekly Notes*").
- **Unsharing** appears in the delta feed → row frozen as `access-revoked` (honest
  state, not an error loop).
- The service account's own credential also fixes the background-identity gap in
  §1 — scheduled refresh cannot use a user's session token.

Manual `/ingest` paste stays as the second trigger (and the only one for web, bugs,
CRs).

### 5.1 Google Chat mechanics — the app is the mentionable identity

A service-account *email* cannot be mentioned or shared-to inside Google Chat; the
mentionable identity is a **Chat app** ("AutoKnow"), configured on the same GCP
project and authenticating with the same service-account credentials (`chat.bot`
scope, app auth). One GCP project therefore yields both share targets: the SA email
for Drive, the app name for Chat.

Two directional facts shape the design:

- **Incoming webhooks are the wrong direction.** Chat webhooks only POST messages
  *into* a space; nothing pushes messages *out*. The Chat app's HTTP endpoint is the
  receiving mechanism, and by design it only receives events addressed to the app
  (@mention, DM, command) — apps never get a space's firehose.
- **App auth can read a space's messages only where the app is a member** (`chat.bot`
  works in spaces the app has been added to; the broader
  `chat.app.messages.readonly` scope needs admin approval and is public-message-only).

**Primary gesture (GA today): add the app to the space once, then `@AutoKnow` on the
message or as a thread reply.** The app receives the MESSAGE event (text, thread,
space, sender), fetches the surrounding thread via app auth (it is now a member),
ingests thread-as-of-now through the normal digest→classify→embed pipeline, and
replies in-thread with one line: "Saved — linked to *Volvo EX90 AAOS Refresh*". The
confirmation doubles as discoverability for everyone else in the space.

- Dedupe on thread: re-mentioning the same thread later creates a **ContextRevision**
  on the existing row (with a what's-new delta), not a duplicate. Chat therefore
  stays `immutable`-class — no polling; freshness is user-pulled by re-mentioning,
  which fits chat's episodic nature.
- **Message action** ("Save to AutoKnow" in a message's ⋮ menu) is the ideal
  zero-typing gesture but is **Developer Preview** as of mid-2026 — register the
  command config now if convenient, treat as progressive enhancement, adopt at GA.
- A **slash command** (`/autoknow`) and DM-the-app both fall out of the same event
  handler for free.

**Fallback (app not in the space): copy message link → paste into `/ingest`.** The
app isn't a member, so app auth cannot read it; the fetch uses the *signed-in
user's* token (`chat.messages.readonly` user scope) — the same pattern as manual
Doc ingestion today. Link parsing maps `chat.google.com/room/<space>/<thread>/<msg>`
to the API resource name.

Implementation scope (extends slice 3): Chat app configuration in the GCP console
(name, avatar, HTTP endpoint URL, slash command + preview-registered message
action), a `POST /api/chat/events` route verifying the request's bearer token,
thread fetch + dedupe + in-thread ack, and the link-paste fallback in `/ingest`.

### 5.2 Scoped quick-ingest component — "paste a link" everywhere it has context

A small reusable client component, `<QuickIngest scope={{kind, id}}>`, embedded on
the pages where links naturally arrive: program page, partner page, and the phase
detail popover. Collapsed to a quiet "+ Add link" affordance (Tufte: no standing
form chrome); expands to input + tracking chip + Add.

**The host page IS the classification.** Today's `/ingest` runs a Gemini classifier
to guess which program/partner a document belongs to. Pasted from a program page,
there is nothing to guess: the link attaches to that program (phase scope also
records the phase). The classifier step is skipped entirely — cheaper, and never
wrong. The global `/ingest` page keeps the classifier for unscoped pastes.

**The tracking chip** (§3.2) shows the inferred volatility on paste and is tappable:

- `Snapshot` — index once, never re-check (chat, one-off exports).
- `Watched` — living document behavior (§6 cadence).
- `Until closed` — bug/CR behavior; see lifecycle below.

Inference from the URL prefills the chip (§3.1); the user corrects it only when they
know better — e.g. marking a generic tracker URL as `Until closed`. `volatilitySource`
records the correction so re-inference never undoes it.

### 5.3 Until-closed lifecycle — how a resolved bug stops reading as a blocker

Three layers, in order of reliability:

1. **Connectored trackers** (Gerrit, GitHub issues/PRs): status is machine-readable.
   The §6 worker polls the status endpoint (6h cadence while active); a terminal
   status (`FIXED`/`merged`/`closed`/`abandoned`) freezes the row with
   `frozenReason: closed`, writes a final revision whose delta records the
   resolution, and emits a feed event ("Bug 4711 resolved").
2. **Unconnectored URLs marked `Until closed`** (the chip on a generic tracker
   link): no status API exists, so the row is watched like a living doc — and every
   re-digest asks Gemini to also extract a structured `sourceStatus:
   open | resolved | unknown` from the page text. A `resolved` extraction triggers
   the same freeze + final revision + feed event. Reopen (visible on a later manual
   refresh or via the connectored feed) unfreezes.
3. **Summary evidence carries lifecycle, not just text.** Evidence lines for tracked
   sources are prefixed with their live state — `OPEN bug (since May 3): …` vs
   `RESOLVED Jun 30: …` — and the summary prompts already forbid synthesizing
   beyond the evidence. The moment a resolution revision lands, the scope's summary
   goes stale, SummaryPanel auto-regenerates, and the "blocker" disappears from
   Risks (typically resurfacing once under Progress as "resolved"). This is the
   precise mechanism by which AutoKnow *stops believing* stale blockers: freshness
   invalidation is already wired from revisions → staleness → regeneration; the
   lifecycle layers above just make revisions happen at the right moments.

Implementation scope for the service account (slice 3):

- Operator provisions the account (GCP console; no roles/IAM grants needed — Drive
  access comes purely from sharing) and puts the key in env:
  `GOOGLE_SERVICE_ACCOUNT_JSON` (inline) or `GOOGLE_APPLICATION_CREDENTIALS` (path).
  `.env.sample` documents both; absent key ⇒ share-to-ingest degrades honestly
  (Manage → Sources shows "Drive sync off", manual ingest unaffected) — same pattern
  as `GEMINI_API_KEY`.
- `src/lib/googleAuth.ts`: mint access tokens from the key (JWT grant, cached until
  expiry). `src/lib/google-docs.ts` fetches with the service-account token for
  watched sources; the signed-in user's token remains only as the fallback for
  one-off manual ingests of docs not shared with the app.
- Startup/settings surface shows the shareable address (copy button) so users know
  what to share to; the address is also printed in Manage → Sources.
- Drive `changes.list` cursor stored in `SyncCursor` (§8); the same feed drives
  new-share discovery, edit detection, and unshare-freezing.

---

## 6. Adaptive scheduling

A refresh worker (cron-hit route, e.g. `GET /api/cron/refresh`, guarded by a shared
secret) processes rows where `nextCheckAt <= now()`, oldest first, budget-capped.

- **Interval algorithm (AIMD-flavored)**: on *unchanged* check, `interval = min(interval × 2, 30d)`;
  on *changed* check, `interval = base` (per class: Drive 1d, web 3d, until-closed 6h
  when active). A weekly-edited notes doc settles at a 2–4 day rhythm; an abandoned
  doc decays to monthly metadata peeks; a hot doc tightens automatically.
- **Jitter** ±20% so checks don't convoy.
- **Budget guards**: per cycle, max N content fetches and M Gemini re-digests
  (overflow simply waits — `nextCheckAt` ordering makes this fair). Drive Gate 1 is
  exempt (single delta call).
- **Manual Refresh now** bypasses the schedule but still honors both gates.

---

## 7. Re-distill incrementally; keep revisions; emit signal

When Gate 2 finds real change:

- **Incremental digest**: prompt Gemini with the *previous digest* + the fetched text
  (and, for appende-style docs like running notes, the tail diff) → returns an
  **updated digest** and a **"what's new" delta** (1–3 bullets).
- **Revisions, not overwrites**: new `ContextRevision` row (digest, contentHash,
  sourceVersion, checkedAt); `ContextUrl.ingestedText` becomes the *latest* digest
  (search keeps working unmodified). Append-only history matches the
  ProjectState/PartnerState pattern.
- **Re-embed** only if the digest text hash changed (a content edit that doesn't move
  the digest costs no embedding call).
- **Activity feed event** per revision: "Meeting notes updated — decision to move
  cert to Q3" (the delta), linked to the source. This is the product payoff: a doc
  update becomes a first-class signal.
- **Summaries**: nothing to do — new revision rows make scope summaries stale, and
  SummaryPanel already auto-regenerates.

---

## 8. Data model (sketch)

```prisma
model ContextUrl {
  // …existing fields…
  volatility       String    @default("immutable") // immutable | living | until-closed
  volatilitySource String    @default("inferred")  // inferred | user
  sourceRef        String?   // Drive fileId / Gerrit change / issue id
  sourceVersion    String?   // Drive version / ETag / patchset
  contentHash      String?   // sha256 of normalized text
  lastCheckedAt    DateTime?
  lastChangedAt    DateTime?
  nextCheckAt      DateTime? // null = never check (immutable/frozen)
  checkIntervalH   Int       @default(24)
  sourceStatus     String?   // open | resolved | unknown (until-closed rows, §5.3)
  frozenAt         DateTime?
  frozenReason     String?   // closed | merged | access-revoked | deleted | user-paused
  revisions        ContextRevision[]
  @@index([nextCheckAt])
}

model ContextRevision {
  id            Int        @id @default(autoincrement())
  contextUrlId  Int
  contextUrl    ContextUrl @relation(fields: [contextUrlId], references: [id])
  checkedAt     DateTime   @default(now())
  sourceVersion String?
  contentHash   String
  digest        String     // full digest at this revision
  delta         String?    // "what's new" bullets; null for the initial ingest
}

model SyncCursor { // one row per feed (Drive changes pageToken, etc.)
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

Existing rows migrate as `immutable` (their current de-facto behavior); a backfill
pass re-infers classes from stored URLs and schedules living ones.

---

## 9. Failure handling

- `403`/`404` from source → freeze as `access-revoked`/`deleted`; surface the badge;
  never retry-loop.
- Quota/5xx → leave `nextCheckAt` untouched plus backoff bump; budget guard already
  bounds blast radius.
- A revision whose digest fails validation → keep previous digest, log, retry next
  cycle (never replace good data with a failed distillation).

## 10. Rollout

1. **Foundation**: volatility columns + inference + content-hash gate + revisions
   (manual Refresh-now button as the only trigger), plus the scoped `<QuickIngest>`
   component with its tracking chip (§5.2) — it exercises inference and override
   end-to-end before any worker exists. Pure additions; no new infra.
2. **Worker + cadence**: cron route, AIMD scheduling, budget guards, until-closed
   status polling + extraction (§5.3), evidence lifecycle prefixes in summaries,
   Manage → Sources.
3. **Service account** (decided, §5): first verify the Workspace domain's sharing
   policy permits sharing to the external service-account address, then provision
   the account and build share-to-ingest, folder subscriptions, and the Drive delta
   feed.
4. **Until-closed connectors**: Gerrit/issue status polling + freeze transitions.
