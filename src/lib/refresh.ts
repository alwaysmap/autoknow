import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { summarizeDocument, digestToText, embedForStorage, isQuotaError } from './gemini';
import { fetchWebUrl, hashContent } from './ingest';
import { isSourceRejected, isTruncated } from './ingestLimits';
import { parseGoogleDocId, fetchGoogleDocText } from './google-docs';
import { driveConfigured, getServiceAccountToken } from './googleAuth';
import { inferSource, LEGACY_TYPE_BY_KIND } from './sources';
import { getIngestionSettings } from './ingestionSettings';
import { perCycleBudget } from './ingestBudget';
import { destructiveDbAllowed } from './dbSafety';
import { MOCK_REF_PREFIX, mockSourceByRef, mockVersion, mockVersionIndex } from './mockCorpus';

// Refresh a watched source (docs/INGEST_FRESHNESS_PLAN.md §4, §6, §7): Gate 1 (did
// the source say it changed — conditional GET / version), Gate 2 (did the TEXT
// change — content hash), and only then a re-distillation that appends a
// ContextRevision and re-embeds. Freezing happens here too: resolved bugs, deleted
// pages, auth walls. Used by both the manual Refresh-now action and the cron worker.

export interface RefreshOutcome {
  ok: boolean;
  error?: string;
  /** What the check concluded. */
  result?: 'unchanged' | 'changed' | 'frozen';
  /** This check actually called Gemini (distil + embed). NOT implied by `result`: a doc
   *  whose digest reads `resolved` spends both calls and then reports 'frozen', so
   *  counting 'changed' alone under-reports the spend — and the cron divides one shared
   *  allowance by exactly this number (api/cron/refresh). */
  distilled?: boolean;
  frozenReason?: string | null;
  delta?: string | null;
}

async function freeze(id: number, reason: string): Promise<RefreshOutcome> {
  await prisma.contextUrl.update({
    where: { id },
    data: { frozenAt: new Date(), frozenReason: reason, lastCheckedAt: new Date() },
  });
  return { ok: true, result: 'frozen', frozenReason: reason };
}

export async function refreshSource(
  contextUrlId: number,
  opts?: { userAccessToken?: string | null },
): Promise<RefreshOutcome> {
  const row = await prisma.contextUrl.findUnique({ where: { id: contextUrlId } });
  if (!row) return { ok: false, error: 'Unknown source.' };
  if (row.mode !== 'watched') return { ok: false, error: 'Snapshots are never re-checked.' };

  // The mock check comes FIRST and keys off sourceRef, not the URL: corpus documents
  // carry realistic docs.google.com / buganizer links, so URL inference would route them
  // to the Drive or web fetcher and try to reach the real internet.
  const isMock = !!row.sourceRef?.startsWith(MOCK_REF_PREFIX);
  const kind = row.sourceRef?.startsWith('drive:') ? 'drive' : inferSource(row.url).kind;

  // ---- fetch (Gate 1 where the connector supports it) ----
  let text: string | null = null;
  let sourceVersion: string | null = row.sourceVersion;

  if (isMock) {
    // The seed-only connector (lib/mockCorpus): serves the NEXT authored revision so the
    // whole real path below — content hash, re-distillation, delta, re-embed, appended
    // ContextRevision, freeze-on-resolved — runs against seeded data without a network.
    //
    // Fail closed on the same policy that permits a wipe (lib/dbSafety): fixture prose
    // reaching a real deployment would be indexed, summarized and cited as if it were
    // ingested fact (AGENTS lesson 5). `destructiveDbAllowed()` is already the app's
    // "this database is disposable" signal, and the seed that creates these rows is gated
    // on it too — so a mock row and a live connector only ever coexist legitimately.
    if (!destructiveDbAllowed()) {
      return { ok: false, error: 'Mock sources are refreshable only in a demo/test database.' };
    }
    const mock = mockSourceByRef(row.sourceRef);
    if (!mock) return freeze(row.id, 'deleted'); // corpus entry retired out from under the row
    const next = mockVersionIndex(row.sourceVersion) + 1;
    if (next >= mock.revisions.length) {
      // Gate 1, honestly: the fixture has nothing newer, which is exactly the
      // "source says it has not changed" answer a conditional GET gives.
      await prisma.contextUrl.update({ where: { id: row.id }, data: { lastCheckedAt: new Date() } });
      return { ok: true, result: 'unchanged' };
    }
    text = mock.revisions[next].text;
    sourceVersion = mockVersion(next);
  } else if (kind === 'drive') {
    // Prefer the caller's user token (manual Refresh now while signed in); fall back
    // to the service account (background sync — plan slice 3).
    const token =
      opts?.userAccessToken ?? (driveConfigured ? await getServiceAccountToken() : null);
    if (!token) {
      return { ok: false, error: 'Drive refresh needs a signed-in session or the service account (docs/OPERATIONS.md §5).' };
    }
    const docId = row.sourceRef?.slice('drive:'.length) || parseGoogleDocId(row.url);
    if (!docId) return { ok: false, error: 'No Drive file id on this source.' };
    try {
      text = await fetchGoogleDocText(docId, token);
    } catch (e) {
      // A typed media refusal is NOT an access problem: the file is still there and still
      // shared, it just isn't text. Freezing it as access-revoked would blame the sharer.
      if (isSourceRejected(e)) return { ok: false, error: e.message };
      const msg = (e as Error).message;
      if (/\b404\b/.test(msg)) return freeze(row.id, 'deleted');
      if (/\b40[13]\b/.test(msg)) return freeze(row.id, 'access-revoked');
      return { ok: false, error: msg };
    }
  } else {
    const fetched = await fetchWebUrl(row.url, row.sourceVersion);
    if (fetched.notModified) {
      await prisma.contextUrl.update({ where: { id: row.id }, data: { lastCheckedAt: new Date() } });
      return { ok: true, result: 'unchanged' };
    }
    if (fetched.authWall) return freeze(row.id, 'auth-required');
    if (!fetched.ok) {
      if (fetched.status === 404 || fetched.status === 410) return freeze(row.id, 'deleted');
      return { ok: false, error: fetched.error };
    }
    text = fetched.text!;
    sourceVersion = fetched.etag ?? null;
  }

  // ---- Gate 2: content hash ----
  const hash = hashContent(text!);
  if (hash === row.contentHash) {
    await prisma.contextUrl.update({
      where: { id: row.id },
      data: { lastCheckedAt: new Date(), sourceVersion, frozenAt: null, frozenReason: null },
    });
    return { ok: true, result: 'unchanged' };
  }

  // ---- real change: re-distill with the previous digest, append a revision ----
  const digest = await summarizeDocument(text!, row.ingestedText ?? undefined);
  const digestText = digestToText(digest);
  const delta = (digest.delta ?? '').trim() || null;
  const now = new Date();

  const resolved = digest.sourceStatus === 'resolved';

  // The embedding is computed BEFORE the digest commits and written in the same
  // transaction: if the embed write sat outside and failed, contentHash would already
  // match on the next cycle ('unchanged' forever) and search would serve the stale
  // vector with no recovery path. Re-embed only on real digest change (plan §7).
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  if (digestText !== row.ingestedText) {
    const vectorStr = `[${(await embedForStorage(digestText)).join(',')}]`;
    writes.push(
      prisma.$executeRaw(
        Prisma.sql`UPDATE "ContextUrl" SET "embedding" = ${vectorStr}::vector WHERE id = ${row.id}`,
      ),
    );
  }

  await prisma.$transaction([
    prisma.contextUrl.update({
      where: { id: row.id },
      data: {
        ingestedText: digestText,
        contentHash: hash,
        sourceVersion,
        sourceStatus: digest.sourceStatus,
        // Re-evaluated every revision: a document that grew past the 30K distillation cap
        // becomes lossy, and one that was trimmed back below it stops being lossy (#56).
        truncated: isTruncated(text!),
        lastCheckedAt: now,
        lastChangedAt: now,
        // A manual refresh on a frozen row that finds live content unfreezes it —
        // unless this very change IS the resolution.
        frozenAt: resolved ? now : null,
        frozenReason: resolved ? 'resolved' : null,
      },
    }),
    prisma.contextRevision.create({
      data: {
        contextUrlId: row.id,
        sourceVersion,
        contentHash: hash,
        sourceStatus: digest.sourceStatus,
        digest: digestText,
        delta,
      },
    }),
    ...writes,
  ]);

  return resolved
    ? { ok: true, result: 'frozen', frozenReason: 'resolved', delta, distilled: true }
    : { ok: true, result: 'changed', delta, distilled: true };
}

// ---- Worker cycle (plan §6): fixed per-connector cadence, capped re-digests -------

// Two cadence classes, and only two — trackers move fast, everything else does not.
// The `?? CADENCE_HOURS.web` fallback at the call site is what makes chat/drive/text
// land on the slow one. tests/refreshCycle.test.ts ratchets this to two keys, because
// dueWhere() below can only express two: a third class needs a column that can tell it
// apart, and adding one here would silently schedule it as web (#58).
const CADENCE_HOURS: Record<string, number> = { tracker: 6, web: 24 * 7 };

/**
 * Compress the whole cadence table so a demo can watch a week of freshness go by in a
 * couple of minutes: set this to the number of seconds the SLOWEST class should take,
 * and every class scales proportionally (so trackers stay 28× quicker than the web).
 * Unset — the normal case, including production — leaves the hours above exactly as
 * written.
 *
 * Scheduling is the thing being compressed, so scheduling is the thing to compress —
 * backdating each row's `lastCheckedAt` to force it due was tried and rejected, because
 * that column is rendered ([ADR: a demo may compress the schedule but never a
 * timestamp](../../docs/adr/2026-07-25-seeded-content-runs-the-real-pipeline-and-fakes-only-the-schedule.md)).
 *
 * Deliberately not gated on the demo-database check that guards the mock connector: it
 * fabricates nothing and cannot corrupt anything. The worst a bad value does is make the
 * cron check sources more often, and the per-cycle budget (lib/ingestBudget) already
 * bounds what that can spend.
 */
function cadenceScale(): number {
  const raw = process.env.REFRESH_MAX_CADENCE_SECONDS;
  if (!raw) return 1;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return seconds / (CADENCE_HOURS.web * 3600);
}

const DRIVE_REF_PREFIX = 'drive:';

/** Watched and not frozen — the set the cron is allowed to touch at all. */
const WATCHED_ACTIVE = { mode: 'watched', frozenAt: null } satisfies Prisma.ContextUrlWhereInput;

/**
 * Drive rows are swept by runDriveSync with the service-account token, not here.
 * Spelled as an OR with null because `NOT (sourceRef LIKE …)` is NULL — and so EXCLUDES
 * the row — when sourceRef is null, where the JS filter it replaced included it.
 */
const NOT_DRIVE_MANAGED = {
  OR: [{ sourceRef: null }, { NOT: { sourceRef: { startsWith: DRIVE_REF_PREFIX } } }],
} satisfies Prisma.ContextUrlWhereInput;

/**
 * The due-source predicate, in SQL rather than in JS over the whole table (#58) — see
 * docs/adr/2026-07-22-ingestion-sized-for-hundreds-gate-the-10k-rebuild.md rec 2.
 *
 * WHY IT KEYS OFF `type` AND NOT `inferSource(url).kind`: the cadence class has to be
 * something Postgres can filter and index. `kind` is computed in JS from the URL by a set
 * of host+path regexes, so pushing it into SQL would mean either a second copy of those
 * regexes in another language, or a new materialized column. Neither is needed —
 * `type` ALREADY stores the classification made at ingest, and `LEGACY_TYPE_BY_KIND`
 * makes `type = 'Gerrit'` exactly `kind === 'tracker'`. Every other value maps to the web
 * cadence, which is the same fallback the JS filter used.
 *
 * The one behavioural difference, stated rather than hidden: cadence now follows the
 * classification recorded when the source was ingested, not one re-derived from its URL
 * on every tick. If `inferSource`'s tracker rules change, existing rows keep their
 * recorded class — the same way `mode` and `sourceRef` already do.
 */
function dueWhere(nowMs: number): Prisma.ContextUrlWhereInput {
  const scale = cadenceScale();
  const cutoff = (hours: number) => new Date(nowMs - hours * scale * 3600_000);
  const pastItsCadence = {
    OR: [
      { lastCheckedAt: null }, // never checked — the JS filter read this as epoch 0
      { type: LEGACY_TYPE_BY_KIND.tracker, lastCheckedAt: { lte: cutoff(CADENCE_HOURS.tracker) } },
      { type: { not: LEGACY_TYPE_BY_KIND.tracker }, lastCheckedAt: { lte: cutoff(CADENCE_HOURS.web) } },
    ],
  };
  return { ...WATCHED_ACTIVE, AND: [NOT_DRIVE_MANAGED, pastItsCadence] };
}

export interface CycleReport {
  due: number;
  checked: number;
  changed: number;
  frozen: number;
  errors: number;
  skippedDrive: number;
  /** Documents this cycle actually spent Gemini on — the number the shared per-cycle
   *  allowance is drawn down by, and the mirror of DriveSyncReport.spent. `changed` is NOT
   *  that number (see RefreshOutcome.distilled); the asymmetry with DriveSyncReport is what
   *  let the cron divide by the wrong one. */
  spent: number;
  /** due − checked: web sources that were due but did not fit the budget (carried over). */
  backlog: number;
  /** The cycle stopped early on a Gemini quota (429) error (AGENTS lesson 5). */
  quotaStopped: boolean;
}

export async function runRefreshCycle(opts?: { maxRefreshes?: number }): Promise<CycleReport> {
  // #38: the per-cycle cap is the admin's daily budget spread over the cycles, not a
  // hard-coded 10 — so daily Gemini spend stays under the free tier (lib/ingestBudget).
  // Capping CHECKS is safely conservative: a source only spends Gemini if it changed, so
  // Gemini calls ≤ checked ≤ budget. The cron passes the budget left after the Drive sweep.
  const budget =
    opts?.maxRefreshes ?? perCycleBudget((await getIngestionSettings()).dailyReingestBudgetDocs);

  const where = dueWhere(Date.now());
  // `due` and `skippedDrive` are report figures nobody iterates, so they stay counts —
  // the rows never come back over the wire.
  const [due, skippedDrive, page] = await Promise.all([
    prisma.contextUrl.count({ where }),
    prisma.contextUrl.count({
      where: { ...WATCHED_ACTIVE, sourceRef: { startsWith: DRIVE_REF_PREFIX } },
    }),
    prisma.contextUrl.findMany({
      where,
      select: { id: true, url: true },
      orderBy: { lastCheckedAt: 'asc' }, // oldest first — the same queue discipline as before
      take: Math.max(0, budget),
    }),
  ]);

  const report: CycleReport = {
    due, checked: 0, changed: 0, frozen: 0, errors: 0, skippedDrive, spent: 0,
    backlog: Math.max(0, due - Math.max(0, budget)), quotaStopped: false,
  };
  for (const c of page) {
    // One broken source must not abort the cycle: everything a source can hit —
    // fetch, distillation, embedding, its own writes — stays inside this try.
    let outcome: RefreshOutcome;
    try {
      outcome = await refreshSource(c.id);
    } catch (e) {
      if (isQuotaError(e)) { report.quotaStopped = true; break; } // out of free-tier quota — carry over
      console.error(`refresh: source ${c.id} (${c.url}) failed:`, e);
      outcome = { ok: false, error: (e as Error).message };
    }
    // A quota error surfaced by refreshSource itself (it swallows its errors into a string).
    if (!outcome.ok && isQuotaError(outcome.error)) { report.quotaStopped = true; break; }
    report.checked++;
    // Tallied before the ok/failed split: a source that distilled and then failed its
    // write still spent the requests, and an allowance that only counts successes is an
    // allowance that can be overspent by failing.
    if (outcome.distilled) report.spent++;
    if (!outcome.ok) {
      report.errors++;
      // Rotate the failing source to the back of the lastCheckedAt queue. Without
      // this, orderBy lastCheckedAt asc re-selects the same failing sources every
      // cycle until the budget's worth of them starve all healthy ones forever.
      await prisma.contextUrl
        .update({ where: { id: c.id }, data: { lastCheckedAt: new Date() } })
        .catch(() => {});
    } else if (outcome.result === 'changed') report.changed++;
    else if (outcome.result === 'frozen') report.frozen++;
  }
  return report;
}
