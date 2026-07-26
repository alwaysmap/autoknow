import 'server-only';
import { readCapped, SourceRejected } from './ingestLimits';

// Fetch a Google Doc's text with the signed-in user's Drive token. We export the doc
// as plain text (we only need the content for Gemini to distill — never the formatting).

/** Extract a Google Doc id from a share URL, or accept a bare id. */
export function parseGoogleDocId(input: string): string | null {
  const trimmed = input.trim();
  const m = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

const DOC_MIME = 'application/vnd.google-apps.document';

/** What Drive says this file actually is. Asked ONLY after an export failed, to tell the
 *  two 403s apart: `export` answers 403 both for "you can't see this" and for "this isn't a
 *  Docs-editor file", and only the second one is a media limit we should name. Returns null
 *  when the probe itself is denied — i.e. a genuine access problem. */
async function probeMimeType(docId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${docId}?fields=mimeType&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { mimeType?: string }).mimeType ?? null;
  } catch {
    return null;
  }
}

/**
 * Export a Google Doc as plain text via the Drive API using the user's access token.
 *
 * Two limits are enforced here rather than left to chance (#56 / the scaling ADR's
 * decision 3): a shared video, PDF or spreadsheet fails the export with a bare 403, so it
 * is re-classified into a typed `SourceRejected('unsupported-media')` naming what the file
 * IS — and the export body is read through the boundary's byte ceiling instead of an
 * unbounded `res.text()`.
 */
export async function fetchGoogleDocText(docId: string, accessToken: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403) {
      // Ask what it is before blaming permissions. A binary answers with its real MIME;
      // a file we genuinely cannot see answers nothing, and falls through to the 403 below
      // (which refresh.ts still reads as access-revoked).
      const mimeType = await probeMimeType(docId, accessToken);
      if (mimeType && mimeType !== DOC_MIME) {
        throw new SourceRejected('unsupported-media', { type: mimeType });
      }
    }
    throw new Error(`Google Drive export failed (${res.status}). ${body.slice(0, 200)}`);
  }
  return readCapped(res);
}
