# Ingested Content Freshness — Design Rationale

Status: **Implemented** — the refresh worker runs hourly in production
(`/api/cron/refresh` → `lib/driveSync`, `lib/refresh`, `lib/summaries`; ops:
OPERATIONS §4). This doc preserves the *decisions and invariants* — the why.
Mechanics live in the code; the full v2 design (schema sketches, rollout
slices, the ten-gap adversarial-review changelog) lives in git history.
Section numbers are stable — code comments cite them (`plan §5.2` etc.).

## Goal

Keep ingested context (Drive docs, chat messages, web pages, bugs) fresh
**without re-indexing vast amounts of information**: re-read only sources that
plausibly changed, re-distill only content that actually changed, and surface
every refresh as product signal (feed event + summary staleness), never a
silent write. Non-goals: real-time sync, storing originals (digests only),
crawling anything not explicitly shared or pasted.

## 1. Historical context

(Removed — described the pre-implementation state. See git history.)

## 2. Tracking model: two modes, one terminal state

- Every source is `snapshot` (indexed once, never re-checked; zero standing
  cost) or `watched` (re-checked on its connector's cadence until frozen).
- **Freeze is terminal**, always with a reason (`resolved`, `access-revoked`,
  `deleted`, `auth-required`, `user-paused`). Frozen rows are never checked;
  the ONLY unfreeze is a human "Refresh now". Deliberate: v1 had automated
  reopen detection that could never fire (frozen rows aren't checked) —
  don't reintroduce it.
- Mode is inferred from URL shape and user-correctable; a user's correction
  (`modeSource: 'user'`) is never re-inferred away.

### 2.2 What the user sees

Mode as a tappable two-state chip on QuickIngest; freshness provenance and
frozen badges on context items; Manage → Sources as the operator view
(last/next check, Refresh now, Pause, mode toggle).

## 3. Anchor + constrained enrichment (classification)

The host page provides the **anchor**, not the whole truth: a scoped paste
(program/partner page, phase popover) sets the anchor deterministically and
SKIPS the global classifier; one small enrichment call then chooses only
*within* the anchor's space ("which of this program's ~5 phases?") — cheaper
and more accurate than classifying across the whole portfolio. Unscoped
pastes (Manage → Sources, Chat @mention) run the global classifier first.
Wrong-page pastes: delete + re-paste, by design — mismatch detection would
add a model call to every ingest to catch a rare, self-evident error.

## 4. Change detection — two gates before any Gemini spend (INVARIANT)

1. **Gate 1 — did the source say it changed?** No content fetch: Drive delta
   feed (one `changes.list` per cycle for the whole corpus), conditional GET
   for web, status endpoint for trackers. Snapshots: never checked.
2. **Gate 2 — did the text change?** Fetch, normalize (whitespace, export
   artifacts, URL canonicalization), SHA-256 vs `contentHash`. Unchanged →
   touch `lastCheckedAt`, stop.

Fetch guards, non-negotiable: **SSRF** (reject private address space before
connecting — see `lib/ssrfGuard`) and **auth walls** (a login page must never
be hashed or digested — it would record a bogus change and poison the digest;
freeze `auth-required` instead).

## 5. The app's Drive identity — decision record

**A GCP service account**, key-auth, zero IAM roles; sharing a file/folder
with it IS the consent boundary and discovery mechanism (folder = standing
subscription; unshare = freeze `access-revoked`). Rejected alternatives:

- *Dedicated Workspace user*: headless auth rides on an interactively-minted
  refresh token — fragile (expiry, revocation, 2FA/rotation policy), costs a
  seat, carries a Gmail attack surface.
- *Service account + domain-wide delegation*: impersonation is a far bigger
  security grant than the problem warrants.

**Dedupe invariant**: `sourceRef` (Drive fileId / Chat thread / normalized
URL) is unique — one source = one row = one anchor; re-pastes point at the
existing item.

### 5.1 Google Chat — the app is the mentionable identity

A service-account email can't be @mentioned; the Chat *app* is the share
target (same GCP project, `chat.bot` app auth). `@AutoKnow` on a message →
event → fetch thread → ingest → in-thread ack; re-mentions write revisions on
the same row (`sourceRef` = thread name). Chat stays `snapshot` mode —
freshness is user-pulled, matching chat's episodic nature. Ops reality of
getting delivery to work: OPERATIONS §6.0.

### 5.2 Scoped quick-ingest

`<QuickIngest scope>` wherever links arrive (program/partner page, phase
popover): host page sets the anchor (§3), chip records mode corrections
(§2.2), `sourceRef` hits link to the existing item instead of duplicating.

### 5.3 Lifecycle — how a resolved bug stops reading as a blocker

Every digest (all sources, no special case) extracts
`sourceStatus: open | resolved | not-applicable`. Terminal connector status or
an extracted `resolved` freezes the row, writes a final revision recording the
resolution, and emits a feed event. Summary evidence lines carry lifecycle
prefixes (`OPEN bug (since May 3)` / `RESOLVED Jun 30`), and the existing
revision → staleness → regeneration chain drops the blocker from Risks.

## 6. Scheduling — fixed per-connector cadence, deliberately dumb

Drive every cycle (one delta call covers the corpus), trackers 6h, generic web
weekly, snapshots/frozen never; per-cycle cap on re-digests (overflow carries,
oldest first). v1's AIMD adaptive scheduling with per-row `nextCheckAt` was
**killed on review**: the corpus is hundreds of sources, the expensive work is
already double-gated, and Drive's delta feed makes per-row schedules pointless.
Don't rebuild adaptive scheduling without new evidence.

## 7. Re-distill on change; revisions are append-only

On a real change: send Gemini the full current text + the previous digest, get
an updated digest + a "what's new" delta (v1's incremental tail-diff needed
the previous full text, which we deliberately don't store — impossible as
specified). New `ContextRevision` per change; `ContextUrl.ingestedText` holds
the latest digest so search works unmodified; re-embed only when the digest
text changed; every revision emits a feed event. Summaries need nothing —
staleness + auto-regeneration were already wired.

## 8. Data model

(Sketch removed — `prisma/schema.prisma` is the truth: see `ContextUrl`'s
mode/sourceRef/contentHash/frozen* fields, `ContextRevision`, `SyncCursor`.)

## 9. Failure handling

`403/404` → freeze (`access-revoked`/`deleted`), never retry-loop. Auth-wall
content → freeze `auth-required`, never hash/digest. Quota/5xx → skip the
cycle; fixed cadence retries naturally. Invalid digest → keep the previous
one, log, retry next cycle.

## 10–11. Rollout & adversarial-review changelog

(Removed — rollout completed; the v2 review's ten gaps and four
simplifications are in git history. The method is the keeper: the adversarial
review *deleted* mechanisms — three volatility classes → two modes, AIMD →
fixed cadence — before a line was built. See AGENTS.md compounding lesson 12.)
