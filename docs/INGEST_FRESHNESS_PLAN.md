# Ingested Content Freshness — Design Plan (v2)

Status: **Plan only** (no code written yet). v2 = v1 after an adversarial review;
§11 lists what the review found and what got simplified away.

## Goal

Keep ingested context (Drive docs, chat messages, web pages, bugs, change requests)
fresh **without re-indexing vast amounts of information**: re-read only sources that
plausibly changed, re-distill only content that actually changed, and make every
refresh visible as product signal (activity feed + summary staleness) rather than a
silent database write.

Non-goals: real-time sync, full-text archival of sources (we store digests, never
originals), crawling anything not explicitly shared/linked, cross-entity many-to-many
attachment (see §11 G3).

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
- Feed items are already deletable — that plus re-paste is the v1 correction path for
  a link attached to the wrong entity.

---

## 2. Tracking model: two modes, one terminal state

Every source is either:

| Mode | Meaning | Standing cost |
|---|---|---|
| `snapshot` | Indexed once, never re-checked (chat messages, pasted text, one-off exports). | Zero. |
| `watched` | Re-checked on its connector's cadence (§6) until frozen. | One metadata check per cadence tick. |

**Freezing** is the terminal state for watched sources, always with a recorded reason:
`resolved` (bug fixed / CR merged — see §5.3), `access-revoked`, `deleted`,
`auth-required`, `user-paused`. Frozen rows are never checked again; the only
unfreeze is a human clicking **Refresh now** (reopened bugs are rare; a stale
"resolved" is visible and cheap to fix by hand — v1 had automated reopen detection
that could never fire because frozen rows aren't checked).

> v1 had a third class, `until-closed`. It's gone as a *class*: bug/CR behavior is
> now **emergent** — a watched source freezes when its connector reports a terminal
> status or its digest's extracted `sourceStatus` says `resolved` (§5.3). One less
> concept for users and code alike.

### 2.1 Mode inference (URL shape → mode; user-correctable)

| Source | Detected by | Mode |
|---|---|---|
| Google Drive file / folder | `docs.google.com`, `drive.google.com`, fileId | `watched` |
| Chat message / pasted raw text | `chat.google.com` permalink / text paste | `snapshot` |
| Bug / issue / change request | Gerrit, GitHub issue/PR, Buganizer URL shapes | `watched` (freezes on terminal status) |
| Generic web URL | anything else | `watched` |

`modeSource: 'inferred' | 'user'` — a user correction is never re-inferred away.

### 2.2 What the user sees

- **Quick-ingest chip (§5.2)**: the inferred mode as a visible, tappable
  **two-state toggle** — `Watched` / `Snapshot` — prefilled, never required.
- **Context items**: freshness provenance ("checked 2h ago · changed Jul 12") and a
  frozen badge with its reason ("frozen — resolved Jul 3").
- **Manage → Sources**: the operator view — full watch list, last/next check,
  **Refresh now** / **Pause** / mode toggle per row.

---

## 3. Anchor + constrained enrichment (classification)

The host page provides the **anchor**, not the whole truth: a link pasted on
program X's page is *about* program X, but which phase, and which partner it
implicates, are still open questions.

- **Scoped paste** (§5.2): anchor is set deterministically from the host page —
  `projectId` (program page), `partnerId` (partner page), `projectId+phaseId`
  (phase popover). The global Gemini classifier is **skipped**.
- **Enrichment, constrained**: after digesting, one small classification call runs
  *within the anchor's space only* — program anchor → "which of this program's
  phases, if any?"; partner anchor → "which of this partner's programs, if any?".
  Choosing among ~5 named phases is a far easier task than guessing across the whole
  portfolio, so this is both cheaper *and* more accurate than v1's global classify.
- **Unscoped paste** (Manage → Sources add-link, Chat @mention): global classifier
  runs, then the same constrained enrichment. (The standalone /ingest page is
  retired — the QuickIngest control covers both scoped and unscoped pastes.)
- **Wrong-page pastes**: no mismatch detection in v1 — items are deletable from the
  feed and re-pasteable on the right page. (Deliberate: detection adds a model call
  and a UI flow to every ingest to catch a rare, self-evident, cheaply-fixed error.)

---

## 4. Change detection — cheap metadata first, content hash second

Two gates before any Gemini spend:

**Gate 1 — did the source *say* it changed?** (no content fetch)

- **Drive**: one `changes.list` call per worker cycle with a stored `pageToken` —
  all changed fileIds, new shares, and removals for the whole corpus in O(1) calls.
  ⚠️ implementation risk to verify early: the delta feed must cover *shared-with-me*
  items for the service account; fallback is batched `files.get?fields=version,modifiedTime`.
- **Web**: conditional GET (`ETag`/`If-Modified-Since`); `304` costs ~nothing.
  No validators → fetch and rely on Gate 2.
- **Gerrit / GitHub**: status endpoint; terminal status → freeze, no Gate 2 needed.
- **Snapshots**: no gate — never checked.

**Gate 2 — did the *text* change?** `modifiedTime` moves on renames and
comment-resolutions too. Fetch, normalize (whitespace, export artifacts, and URL
canonicalization — strip tracking params/fragments so the same page hashes the
same), SHA-256, compare `contentHash`. Unchanged → touch `lastCheckedAt`, stop.

**Fetch guards** (both new in v2):

- **SSRF**: server-side fetch of user-pasted URLs must resolve-and-reject private
  address space (localhost, RFC-1918, link-local/metadata IPs) before connecting.
- **Auth walls**: a fetch that lands on a login page (SSO redirect, `401/403`,
  sign-in HTML heuristics) must NOT hash-compare or digest it — that would record a
  bogus "change" and poison the digest with login-page text. Freeze as
  `auth-required`, surface the badge.

---

## 5. Ingest triggers — sharing with the app's identity

**DECIDED: the app's Drive identity is a GCP service account.** Alternatives
considered and rejected:

- *Dedicated Workspace user* (e.g. `autoknow@alwaysmap.com`): in-domain email (nicer
  sharing UX, immune to external-sharing blocks) but headless auth rides on an
  interactively-minted OAuth refresh token — a fragile artifact subject to expiry,
  admin revocation, and human-account policy (2FA/password rotation/inactive-account
  sweeps) — plus a seat license and a full Gmail-bearing attack surface.
- *Service account + domain-wide delegation*: the impersonation grant is a far
  bigger security ask than the problem warrants.

The service account authenticates by key (no session, no consent flow, no token to
lose), costs no seat, and can do exactly one thing: read what was shared with it.
**Prerequisite**: the address is *external* to the Workspace domain — the domain's
Drive sharing policy must permit sharing to it (allowlist if external sharing is
blocked). Slice 3 starts by verifying this.

Sharing a file or folder with `autoknow@<gcp-project>.iam.gserviceaccount.com` *is*
the consent boundary and the discovery mechanism:

- Shared **file** → ingested as a `watched` source.
- Shared **folder** → standing subscription: current and future children discovered
  via the same delta feed, announced in the activity feed.
- **Unsharing** appears in the delta feed → freeze as `access-revoked`.
- The SA credential is also the background identity — scheduled refresh cannot use a
  user's session token (§1 gap).

**Dedupe (new in v2)**: every source gets a canonical `sourceRef` (Drive fileId /
Chat thread name / Gerrit change / normalized URL). `sourceRef` is unique: pasting a
link that's already tracked — on any page, or already discovered via a folder
subscription — does not create a second row; the UI points at the existing item
("Already tracked — attached to *Volvo EX90*"). One source = one row = one anchor;
cross-entity visibility already exists because partner-scoped queries include the
partner's programs' context.

Implementation scope (slice 3): operator provisions the account (no IAM roles —
access comes purely from sharing); key in `GOOGLE_SERVICE_ACCOUNT_JSON` or
`GOOGLE_APPLICATION_CREDENTIALS` (documented in `.env.sample`; absent key ⇒
share-to-ingest degrades honestly, manual ingest unaffected — same pattern as
`GEMINI_API_KEY`). `src/lib/googleAuth.ts` mints cached JWT-grant tokens;
`google-docs.ts` uses the SA token for watched sources, the user token only for
one-off manual ingests of unshared docs. The shareable address is displayed with a
copy button in Manage → Sources. Drive cursor lives in `SyncCursor` (§8).

### 5.1 Google Chat mechanics — the app is the mentionable identity

A service-account *email* cannot be mentioned in Chat; the mentionable identity is a
**Chat app** ("AutoKnow") on the same GCP project, authenticating with the same SA
credentials (`chat.bot`, app auth). One GCP project = both share targets: SA email
for Drive, app name for Chat.

Directional facts: incoming webhooks only POST *into* spaces (wrong direction); the
Chat app's HTTP endpoint is the receiving mechanism and only receives events
addressed to the app — never a space firehose. App auth reads messages only in
spaces the app is a member of. Caveat: thread fetch needs the space's history
setting on; degrade to the mentioning message alone when off.

**Primary gesture (GA today)**: add the app to the space once, then `@AutoKnow` a
message or thread-reply. The app receives the event, fetches the thread (it's a
member now), ingests thread-as-of-now, and acks in-thread: "Saved — linked to
*Volvo EX90 AAOS Refresh*". Re-mentioning the same thread later writes a
**ContextRevision** on the existing row (dedupe via `sourceRef` = thread name) —
chat stays `snapshot`-mode; freshness is user-pulled, which fits chat's episodic
nature. A slash command and DM-the-app fall out of the same handler. **Message
actions** (⋮ menu "Save to AutoKnow") are Developer Preview as of mid-2026 —
register now, treat as progressive enhancement.

**Fallback (app not in the space)**: copy message link → paste into an Add-link control;
fetch with the signed-in user's token (`chat.messages.readonly`), like manual Doc
ingestion today.

Implementation scope (extends slice 3): Chat app config in GCP console, a
`POST /api/chat/events` route verifying the request bearer token, thread fetch +
dedupe + in-thread ack, link-paste fallback in the QuickIngest control.

### 5.2 Scoped quick-ingest component

`<QuickIngest scope={{kind, id}}>` embedded where links arrive: program page,
partner page, phase popover. Collapsed to "+ Add link"; expands to input + the
two-state mode chip (§2.2) + Add. The host page sets the anchor (§3); constrained
enrichment fills in the rest; the chip records mode corrections. On a `sourceRef`
hit it links to the existing item instead of duplicating.

### 5.3 Lifecycle — how a resolved bug stops reading as a blocker

- **Every digest extracts status.** The standard digest schema (all sources, not a
  special case) includes `sourceStatus: open | resolved | not-applicable`. Meeting
  notes come back `not-applicable`; a bug or CR page comes back `open`/`resolved`.
- **Freeze on terminal**: a connector's terminal status (Gerrit `MERGED`, GitHub
  `closed`) or an extracted `resolved` freezes the row (`frozenReason: resolved`),
  writes a final revision whose delta records the resolution, and emits a feed
  event ("Bug 4711 resolved").
- **Summary evidence carries lifecycle**: evidence lines are prefixed with live
  state — `OPEN bug (since May 3): …` vs `RESOLVED Jun 30: …` — and the prompts
  already forbid synthesizing beyond evidence. When the resolution revision lands,
  the scope summary goes stale and auto-regenerates; the blocker drops out of Risks
  (resurfacing once under Progress as "resolved"). The invalidation chain
  (revision → staleness → regeneration) already exists; the lifecycle just makes
  revisions land at the right moments.

---

## 6. Scheduling — fixed per-connector cadence

> v1 specified an AIMD adaptive-interval scheme with jitter. Killed: the corpus is
> hundreds of sources, not millions, and the expensive work is already gated twice.
> For Drive, per-row scheduling is pointless — the delta feed reports all changes in
> one call per cycle regardless of cadence. Adaptive intervals optimized the cheap
> part.

A worker (cron-hit `GET /api/cron/refresh`, shared-secret guarded) runs each cycle:

| Connector | Cadence | Cost per cycle |
|---|---|---|
| Drive (all files + folder discovery) | every cycle (~hourly) | 1 API call (delta feed) |
| Gerrit / GitHub (unfrozen) | 6h | 1 status call per open item |
| Generic web (unfrozen) | weekly | 1 conditional GET per item |
| Snapshots / frozen | never | 0 |

Plus: **Refresh now** on any item (bypasses cadence, honors both gates), and a
per-cycle cap on Gemini re-digests (overflow carries to the next cycle, oldest
first). That's the whole scheduler.

---

## 7. Re-distill on change; keep revisions; emit signal

> v1 said "incremental digest with the tail diff". Contradiction: diffing needs the
> previous *text*, and we deliberately store only digests. Dropped — on change, send
> Gemini the **full current text + the previous digest** and ask for an updated
> digest plus a "what's new vs. the previous digest" delta (1–3 bullets). Changes
> are rare events; a full re-distill per change is cheap and simpler.

- **Revisions, not overwrites**: new `ContextRevision` (digest, contentHash,
  sourceVersion, sourceStatus, delta); `ContextUrl.ingestedText` holds the latest
  digest so search works unmodified. Append-only, matching the State-row pattern.
- **Re-embed** only when the digest text actually changed.
- **Feed event per revision**: "Meeting notes updated — decision to move cert to Q3".
- **Summaries**: nothing to do — staleness + auto-regeneration already wired.

---

## 8. Data model (sketch)

```prisma
model ContextUrl {
  // …existing fields…
  mode          String    @default("snapshot") // snapshot | watched
  modeSource    String    @default("inferred") // inferred | user
  sourceRef     String?   @unique // canonical id: Drive fileId / Chat thread / normalized URL
  sourceVersion String?   // Drive version / ETag / patchset
  contentHash   String?   // sha256 of normalized text
  sourceStatus  String?   // open | resolved | not-applicable (extracted, §5.3)
  lastCheckedAt DateTime?
  lastChangedAt DateTime?
  frozenAt      DateTime?
  frozenReason  String?   // resolved | access-revoked | deleted | auth-required | user-paused
  revisions     ContextRevision[]
  @@index([mode, frozenAt])
}

model ContextRevision {
  id            Int        @id @default(autoincrement())
  contextUrlId  Int
  contextUrl    ContextUrl @relation(fields: [contextUrlId], references: [id])
  checkedAt     DateTime   @default(now())
  sourceVersion String?
  contentHash   String
  sourceStatus  String?
  digest        String     // full digest at this revision
  delta         String?    // "what's new" bullets; null for initial ingest
}

model SyncCursor { // one row per feed (Drive changes pageToken, etc.)
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

(No `nextCheckAt`/`checkIntervalH` — §6 killed per-row scheduling; cadence is a
property of the connector, derived from the URL/sourceRef at check time.)

Existing rows migrate as `snapshot` (their de-facto behavior); a backfill re-infers
mode from stored URLs and starts watching the living ones.

---

## 9. Failure handling

- `403`/`404` → freeze `access-revoked`/`deleted`; badge; never retry-loop.
- Login-page/auth-wall content → freeze `auth-required` (never hash or digest it).
- Quota/5xx → skip this cycle; the fixed cadence retries naturally next cycle.
- Digest that fails validation → keep the previous digest, log, retry next cycle.

## 10. Rollout

1. **Foundation**: mode columns + inference + hash gate + revisions + `sourceRef`
   dedupe + SSRF/auth-wall guards, plus `<QuickIngest>` with the mode chip and
   anchor+constrained-enrichment classification. Manual Refresh-now is the only
   trigger. Pure additions; no new infra.
2. **Worker**: cron route, fixed cadences, re-digest cap, `sourceStatus` extraction
   in the standard digest, evidence lifecycle prefixes, Manage → Sources.
3. **Service account** (§5): verify domain sharing policy → provision → Drive delta
   feed, folder subscriptions, unshare-freezing. Verify shared-with-me delta
   coverage first (§4 risk).
4. **Chat app + tracker connectors**: @mention ingestion (§5.1); Gerrit/GitHub
   status polling (§5.3).

---

## 11. v2 changelog — what the adversarial review found

Gaps fixed:

- **G1** "Host page IS the classification" overclaimed — the host gives an *anchor*;
  phase/partner enrichment still needs a (now constrained, cheaper, more accurate)
  classification step. (§3)
- **G2** Incremental "tail diff" digestion required the previous full text, which we
  deliberately don't store — impossible as specified. Replaced with full-text +
  previous-digest re-distillation. (§7)
- **G3** Duplicate rows: same doc pasted on two pages, or pasted *and* discovered
  via a folder subscription, created independent watchers. Fixed with canonical
  `sourceRef` dedupe; one row per source is an accepted, documented limitation. (§5)
- **G4** "Reopen events unfreeze" could never fire — frozen rows are never checked.
  Now: manual Refresh-now is the only unfreeze, deliberately. (§2)
- **G5** Auth-wall fetches (SSO redirects) would have hashed and digested login-page
  HTML as a "change". Detect and freeze `auth-required`. (§4)
- **G6** SSRF: the server fetches arbitrary pasted URLs; must reject private address
  space. (§4)
- **G7** URL canonicalization (tracking params, fragments) was unspecified — needed
  for both dedupe and hash stability. (§4)
- **G8** Drive delta-feed coverage of shared-with-me items flagged as a
  verify-early implementation risk with a stated fallback. (§4)
- **G9** Chat thread fetch silently assumed space history is on; degrade path
  stated. (§5.1)
- **G10** No correction path for wrong-page pastes; v1 answer is delete + re-paste
  (feed deletion already exists), stated as a deliberate cut. (§3)

Simplified away:

- **S1** Three volatility classes → **two modes** (`snapshot`/`watched`); bug/CR
  behavior is emergent from status, not a class; the chip is a two-state toggle.
- **S2** AIMD adaptive scheduling + jitter + per-row `nextCheckAt` → fixed
  per-connector cadences; Drive needs no per-row schedule at all. Two schema columns
  deleted.
- **S3** `sourceStatus` extraction is part of the standard digest for all sources —
  the until-closed special case disappears.
- **S4** Freeze semantics unified under one `frozenReason` enum; `immutable` vs
  `frozen` (behaviorally identical) merged.
