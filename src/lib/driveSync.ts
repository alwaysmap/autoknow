import 'server-only';
import { prisma } from './db';
import { driveConfigured, getServiceAccountToken } from './googleAuth';
import { fetchGoogleDocText } from './google-docs';
import { ingestContent } from './ingest';
import { refreshSource } from './refresh';

// Share-to-ingest (plan §5): whatever is shared with the service account gets
// discovered, indexed, and kept fresh. v1 uses a SWEEP rather than the changes.list
// delta feed: one files.list of everything shared with the account (plus one level
// of folder children) per cycle. At this corpus size that is 1–3 API calls and it
// sidesteps the delta feed's shared-with-me coverage risk flagged in plan §4; the
// sweep doubles as Gate 1, since every entry carries version/modifiedTime.

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
// Per-cycle caps bound Gemini spend; the hourly cadence drains any backlog fast.
const MAX_DISCOVERIES = 5;
const MAX_REFRESHES = 5;

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

export interface DriveSyncReport {
  configured: boolean;
  sharedSeen: number;
  discovered: number;
  refreshed: number;
  skippedOtherTypes: number;
  errors: number;
}

export async function runDriveSync(): Promise<DriveSyncReport> {
  const report: DriveSyncReport = {
    configured: driveConfigured,
    sharedSeen: 0,
    discovered: 0,
    refreshed: 0,
    skippedOtherTypes: 0,
    errors: 0,
  };
  if (!driveConfigured) return report;

  const token = await getServiceAccountToken();

  // Everything shared with the account, plus one level of folder children — a
  // shared folder is a standing subscription (documented limitation: one level).
  const top = await listFiles(token, 'sharedWithMe = true and trashed = false');
  const files: DriveFile[] = top.filter((f) => f.mimeType !== FOLDER_MIME);
  for (const folder of top.filter((f) => f.mimeType === FOLDER_MIME)) {
    try {
      files.push(...(await listFiles(token, `'${folder.id}' in parents and trashed = false`)));
    } catch {
      report.errors++;
    }
  }

  const docs = files.filter((f) => f.mimeType === DOC_MIME);
  report.sharedSeen = files.length;
  report.skippedOtherTypes = files.length - docs.length;

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
      if (report.discovered >= MAX_DISCOVERIES) continue;
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
        if (result.ok && !result.duplicateOf) report.discovered++;
      } catch {
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
    if (report.refreshed >= MAX_REFRESHES) continue;

    const outcome = await refreshSource(row.id); // drive branch uses the SA token
    if (!outcome.ok) report.errors++;
    else {
      report.refreshed++;
      // Record the Drive version the content now corresponds to.
      await prisma.contextUrl.update({ where: { id: row.id }, data: { sourceVersion: doc.version ?? null } });
    }
  }

  return report;
}
