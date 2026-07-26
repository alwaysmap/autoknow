import 'server-only';

// A latch that remembers "Gemini is refusing to spend" so the NEXT caller can be told
// before it starts, instead of discovering it halfway through a mutation.
//
// Why this exists: a project over its monthly spend cap answers every call with
// HTTP 429 / RESOURCE_EXHAUSTED. Without a latch, each interactive request rediscovers
// that the expensive way — some of them after a digest call has already succeeded, which
// is precisely the window where a half-completed ingest could damage a healthy row.
// Checking first turns "it broke" into "it declined, and nothing changed".
//
// Deliberately in-process, not a table. It is a CACHE of a fact the API owns, never the
// source of truth: the worst a stale latch can do is refuse one interactive request that
// would have succeeded, or let one request through that then fails cleanly and re-latches.
// Both are cheap. A row would add a write to every cycle, and on Cloud Run each instance
// learns on its own first failure anyway — the cron is single-flighted, so the instance
// that matters is one instance.
//
// The TTL is what stops the latch becoming its own outage. A spend cap can be raised at
// any moment and nothing tells us; expiring the latch means we re-probe on our own rather
// than staying dark until a redeploy.

const LATCH_TTL_MS = 10 * 60_000;

interface QuotaBlock {
  at: number;
  reason: string;
}

let block: QuotaBlock | null = null;

/** Record that Gemini refused to spend. Called from the API wrapper on any quota-shaped
 *  error, so every entry point latches without having to remember to. */
export function noteQuotaExhausted(reason: string): void {
  block = { at: Date.now(), reason };
}

/** Any successful call proves the cap is no longer biting — clear immediately rather than
 *  serving refusals for the rest of the TTL. */
export function noteQuotaRecovered(): void {
  block = null;
}

/**
 * Is Gemini known to be refusing spend right now? Null means "no reason to think so" —
 * which includes "the latch expired", i.e. go ahead and find out.
 */
export function quotaBlocked(): { since: Date; reason: string } | null {
  if (!block) return null;
  if (Date.now() - block.at >= LATCH_TTL_MS) {
    block = null; // TTL elapsed: re-probe rather than stay dark on a cap that may be lifted
    return null;
  }
  return { since: new Date(block.at), reason: block.reason };
}

/** The one sentence every decline site says, so the link and the tone live in one place.
 *  `whatSurvived` is the only per-site difference. Prefer declineIfQuotaBlocked below,
 *  which says it AND does the check; call this directly only where the refusal is
 *  discovered rather than predicted (a 429 that beat the latch). */
export function quotaDeclineMessage(whatSurvived: string): string {
  return `Gemini is over its quota or spending cap — ${whatSurvived}. Check the cap at ai.studio/spend, then try again.`;
}

/**
 * The WHOLE preflight, not just its sentence: check the latch, log what the API said
 * and when we latched it, and hand back the decline — or `null`, meaning go ahead.
 *
 * This is AGENTS lesson 7 caught mid-recurrence. Three hand-rolled variants of the
 * DECLINE had appeared across ingest, quick-ingest and the summaries route, so the
 * sentence was extracted — but the latch check and the log line beside it were not, and
 * by the fourth caller those existed in four places again. An operator reading Cloud
 * Logging needs that line to be one grep, and `since` + `reason` are the only reason the
 * latch carries a payload at all.
 *
 * @param what          who is declining, for the log line — distinct per ENTRY POINT, not
 *                      per operation ('summary regenerate (action)' vs '… (api)'), or the
 *                      grep cannot tell two surfaces of one operation apart
 * @param whatSurvived  what is still intact, for the user: 'the link was not saved'
 */
export function declineIfQuotaBlocked(what: string, whatSurvived: string): string | null {
  const blocked = quotaBlocked();
  if (!blocked) return null;
  console.warn(`${what} declined: Gemini quota latched at ${blocked.since.toISOString()} — ${blocked.reason}`);
  return quotaDeclineMessage(whatSurvived);
}

/** Test seam — the latch is module state, and a test that sets it must be able to clear
 *  it without waiting out the TTL. */
export function resetQuotaLatchForTests(): void {
  block = null;
}
