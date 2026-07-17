import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { summarizeDocument, digestToText, embedText } from './gemini';
import { fetchWebUrl, hashContent } from './ingest';
import { parseGoogleDocId, fetchGoogleDocText } from './google-docs';
import { driveConfigured, getServiceAccountToken } from './googleAuth';
import { inferSource } from './sources';

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

  const kind = row.sourceRef?.startsWith('drive:') ? 'drive' : inferSource(row.url).kind;

  // ---- fetch (Gate 1 where the connector supports it) ----
  let text: string | null = null;
  let sourceVersion: string | null = row.sourceVersion;

  if (kind === 'drive') {
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
  await prisma.$transaction([
    prisma.contextUrl.update({
      where: { id: row.id },
      data: {
        ingestedText: digestText,
        contentHash: hash,
        sourceVersion,
        sourceStatus: digest.sourceStatus,
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
  ]);

  // Re-embed only on real digest change (plan §7).
  if (digestText !== row.ingestedText) {
    const vectorStr = `[${(await embedText(digestText)).join(',')}]`;
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "ContextUrl" SET "embedding" = ${vectorStr}::vector WHERE id = ${row.id}`,
    );
  }

  return resolved
    ? { ok: true, result: 'frozen', frozenReason: 'resolved', delta }
    : { ok: true, result: 'changed', delta };
}

// ---- Worker cycle (plan §6): fixed per-connector cadence, capped re-digests -------

const CADENCE_HOURS: Record<string, number> = { tracker: 6, web: 24 * 7 };
const MAX_REFRESHES_PER_CYCLE = 10;

export interface CycleReport {
  due: number;
  checked: number;
  changed: number;
  frozen: number;
  errors: number;
  skippedDrive: number;
}

export async function runRefreshCycle(): Promise<CycleReport> {
  const candidates = await prisma.contextUrl.findMany({
    where: { mode: 'watched', frozenAt: null },
    select: { id: true, url: true, sourceRef: true, lastCheckedAt: true },
    orderBy: { lastCheckedAt: 'asc' },
  });

  const now = Date.now();
  const due = candidates.filter((c) => {
    if (c.sourceRef?.startsWith('drive:')) return false; // needs the service account (slice 3)
    const kind = inferSource(c.url).kind;
    const cadenceH = CADENCE_HOURS[kind] ?? CADENCE_HOURS.web;
    const last = c.lastCheckedAt?.getTime() ?? 0;
    return now - last >= cadenceH * 3600_000;
  });
  const skippedDrive = candidates.filter((c) => c.sourceRef?.startsWith('drive:')).length;

  const report: CycleReport = { due: due.length, checked: 0, changed: 0, frozen: 0, errors: 0, skippedDrive };
  for (const c of due.slice(0, MAX_REFRESHES_PER_CYCLE)) {
    const outcome = await refreshSource(c.id);
    report.checked++;
    if (!outcome.ok) report.errors++;
    else if (outcome.result === 'changed') report.changed++;
    else if (outcome.result === 'frozen') report.frozen++;
  }
  return report;
}
