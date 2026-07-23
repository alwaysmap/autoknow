import 'server-only';
import { prisma } from './db';
import { driveConfigured, getServiceAccountToken } from './googleAuth';
import { fetchGoogleDocText } from './google-docs';
import { isQuotaError } from './gemini';
import { ingestContent } from './ingest';
import { refreshSource } from './refresh';
import { getIngestionSettings } from './ingestionSettings';
import { perCycleBudget } from './ingestBudget';

// Share-to-ingest (plan §5): whatever is shared with the service account gets
// discovered, indexed, and kept fresh. v1 uses a SWEEP rather than the changes.list
// delta feed: one files.list of everything shared with the account, then a BOUNDED
// walk of shared folders (#38: down to MAX_FOLDER_DEPTH, never unbounded), per cycle.
// At this corpus size that is a handful of API calls and it sidesteps the delta feed's
// shared-with-me coverage risk flagged in plan §4; the sweep doubles as Gate 1, since
// every entry carries version/modifiedTime.
//
// #38 makes the sweep's limits HONEST and VISIBLE instead of silent: every shared file
// that is NOT ingested — the wrong type, or inside a folder deeper than the followed
// depth — is recorded in SkippedSource (shown in Manage → Sources), so sharing never
// looks like it worked when it did not (AGENTS lesson 5). And the per-cycle Gemini spend
// is bounded by the admin's daily budget (lib/ingestBudget), keeping the free tier safe.

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  version?: string;
  modifiedTime?: string;
  sharingUser?: { emailAddress?: string; displayName?: string };
}

const FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,version,modifiedTime,sharingUser(emailAddress,displayName))';
const DOC_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
// #38: how many folder levels below a shared item we follow. Was one (a silent limit);
// expanded to a bounded, documented depth — realistic Drive nesting is 2–4 levels, and a
// bound keeps the sweep's cost predictable (an unbounded walk of a shared tree is exactly
// the O(unknown) cost the ingestion-health ADR refuses). A subfolder found AT this depth
// is recorded as skipped ("beyond-folder-depth") rather than descended, so the user can
// see that its contents were not followed.
const MAX_FOLDER_DEPTH = 5;
// Safety bound on a pathological or shortcut-looping tree — cap folders scanned per sweep.
const MAX_FOLDERS_SCANNED = 500;

type SkipReason = 'unsupported-type' | 'beyond-folder-depth';
interface SkipRecord {
  file: DriveFile;
  reason: SkipReason;
  depth?: number;
}

const sharerOf = (f: DriveFile): string | null =>
  f.sharingUser?.emailAddress ?? f.sharingUser?.displayName ?? null;

async function listFiles(token: string, q: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, fields: FILE_FIELDS, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive files.list failed (${res.status}).`);
    const data = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Everything shared with the account, plus a BOUNDED walk of shared folders. Returns the
 * candidate files (depth ≤ MAX_FOLDER_DEPTH) and collects, into `skips`, the subfolders
 * whose contents were too deep to follow. Guards against cycles (folder ids visited) and
 * a runaway tree (MAX_FOLDERS_SCANNED).
 */
async function collectShared(
  token: string,
  skips: SkipRecord[],
  onFolderError: () => void,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  const top = await listFiles(token, 'sharedWithMe = true and trashed = false');
  const queue: { folder: DriveFile; depth: number }[] = [];
  const visited = new Set<string>();
  for (const f of top) {
    if (f.mimeType === FOLDER_MIME) queue.push({ folder: f, depth: 1 });
    else files.push(f);
  }
  let scanned = 0;
  while (queue.length) {
    const { folder, depth } = queue.shift()!;
    if (visited.has(folder.id)) continue;
    visited.add(folder.id);
    if (scanned++ >= MAX_FOLDERS_SCANNED) {
      // Stop descending; record the folder we stopped at and everything still queued as
      // skipped, so the cap is visible rather than a silent truncation.
      skips.push({ file: folder, reason: 'beyond-folder-depth', depth });
      for (const q of queue) skips.push({ file: q.folder, reason: 'beyond-folder-depth', depth: q.depth });
      break;
    }
    let children: DriveFile[];
    try {
      children = await listFiles(token, `'${folder.id}' in parents and trashed = false`);
    } catch {
      onFolderError();
      continue;
    }
    for (const c of children) {
      if (c.mimeType === FOLDER_MIME) {
        if (depth >= MAX_FOLDER_DEPTH) skips.push({ file: c, reason: 'beyond-folder-depth', depth });
        else queue.push({ folder: c, depth: depth + 1 });
      } else {
        files.push(c);
      }
    }
  }
  return files;
}

/** Upsert this sweep's skips and prune rows no longer skipped (a file that stopped being
 *  shared, moved into range, or became ingestable drops out). Keeps SkippedSource a live
 *  picture of "shared but not ingested", bounded by the corpus, never a growing log. */
async function reconcileSkips(skips: SkipRecord[]): Promise<void> {
  const seen: string[] = [];
  for (const s of skips) {
    seen.push(s.file.id);
    await prisma.skippedSource.upsert({
      where: { fileId: s.file.id },
      update: {
        name: s.file.name,
        mimeType: s.file.mimeType,
        reason: s.reason,
        sharedBy: sharerOf(s.file),
        folderDepth: s.depth ?? null,
      },
      create: {
        fileId: s.file.id,
        name: s.file.name,
        mimeType: s.file.mimeType,
        reason: s.reason,
        sharedBy: sharerOf(s.file),
        folderDepth: s.depth ?? null,
      },
    });
  }
  if (seen.length === 0) await prisma.skippedSource.deleteMany({});
  else await prisma.skippedSource.deleteMany({ where: { fileId: { notIn: seen } } });
}

export interface DriveSyncReport {
  configured: boolean;
  sharedSeen: number;
  discovered: number;
  refreshed: number;
  skippedOtherTypes: number;
  skippedTooDeep: number;
  errors: number;
  /** Docs that needed discovery/refresh this cycle, before the budget cap. */
  demand: number;
  /** Docs actually (re)ingested — Gemini was spent this many times × calls-per-doc. */
  spent: number;
  /** demand − spent: what the budget could not fit this cycle (carried over). */
  backlog: number;
  /** The cycle stopped early on a Gemini quota (429) error (AGENTS lesson 5). */
  quotaStopped: boolean;
}

export async function runDriveSync(opts?: { maxIngests?: number }): Promise<DriveSyncReport> {
  const report: DriveSyncReport = {
    configured: driveConfigured,
    sharedSeen: 0,
    discovered: 0,
    refreshed: 0,
    skippedOtherTypes: 0,
    skippedTooDeep: 0,
    errors: 0,
    demand: 0,
    spent: 0,
    backlog: 0,
    quotaStopped: false,
  };
  if (!driveConfigured) return report;

  // Budget: how many docs this cycle may (re)ingest. Passed by the cron (shared across
  // Drive + web), or derived from the stored daily budget for a standalone call.
  const maxIngests =
    opts?.maxIngests ?? perCycleBudget((await getIngestionSettings()).dailyReingestBudgetDocs);

  const token = await getServiceAccountToken();

  const skips: SkipRecord[] = [];
  const files = await collectShared(token, skips, () => report.errors++);

  const docs = files.filter((f) => f.mimeType === DOC_MIME);
  // Every non-Doc shared file is a skip, not a silent drop (#38 / lesson 5).
  for (const f of files) {
    if (f.mimeType !== DOC_MIME) skips.push({ file: f, reason: 'unsupported-type' });
  }
  await reconcileSkips(skips);

  report.sharedSeen = files.length;
  report.skippedOtherTypes = skips.filter((s) => s.reason === 'unsupported-type').length;
  report.skippedTooDeep = skips.filter((s) => s.reason === 'beyond-folder-depth').length;

  const tracked = await prisma.contextUrl.findMany({
    where: { sourceRef: { startsWith: 'drive:' } },
    select: { id: true, sourceRef: true, sourceVersion: true, lastChangedAt: true, mode: true, frozenReason: true },
  });
  const byRef = new Map(tracked.map((t) => [t.sourceRef!, t]));

  for (const doc of docs) {
    const ref = `drive:${doc.id}`;
    const row = byRef.get(ref);

    if (!row) {
      // ---- newly shared: ingest (unanchored — the global classifier places it) ----
      report.demand++;
      if (report.spent >= maxIngests) continue; // over budget — carries to next cycle
      try {
        const text = await fetchGoogleDocText(doc.id, token);
        if (!text.trim()) continue;
        const result = await ingestContent({
          url: `https://docs.google.com/document/d/${doc.id}/edit`,
          title: doc.name,
          text,
          source: { kind: 'drive', mode: 'watched', sourceRef: ref },
          mode: 'watched',
          modeSource: 'inferred',
          sourceVersion: doc.version ?? null,
          anchor: null,
          // Attribution: the person who shared it with the account, when Drive says.
          addedBy: doc.sharingUser?.emailAddress ?? doc.sharingUser?.displayName ?? 'drive-share',
        });
        if (result.ok && !result.duplicateOf) {
          report.discovered++;
          report.spent++;
        }
      } catch (e) {
        if (isQuotaError(e)) { report.quotaStopped = true; break; }
        report.errors++;
      }
      continue;
    }

    // ---- already tracked: Gate 1 straight from the sweep metadata ----
    if (row.mode !== 'watched' || (row.frozenReason && row.frozenReason !== 'access-revoked')) continue;
    const versionMoved = doc.version && row.sourceVersion && doc.version !== row.sourceVersion;
    const timeMoved =
      doc.modifiedTime && row.lastChangedAt && new Date(doc.modifiedTime) > row.lastChangedAt;
    const unknown = !row.sourceVersion; // manually pasted before sync existed
    if (!versionMoved && !timeMoved && !unknown) continue;

    report.demand++;
    if (report.spent >= maxIngests) continue; // over budget — carries to next cycle

    const outcome = await refreshSource(row.id); // drive branch uses the SA token
    if (!outcome.ok) {
      if (isQuotaError(outcome.error)) { report.quotaStopped = true; break; }
      report.errors++;
    } else {
      report.refreshed++;
      report.spent++;
      // Record the Drive version the content now corresponds to.
      await prisma.contextUrl.update({ where: { id: row.id }, data: { sourceVersion: doc.version ?? null } });
    }
  }

  report.backlog = Math.max(0, report.demand - report.spent);
  return report;
}
