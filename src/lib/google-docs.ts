import 'server-only';

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

/** Export a Google Doc as plain text via the Drive API using the user's access token. */
export async function fetchGoogleDocText(docId: string, accessToken: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Drive export failed (${res.status}). ${body.slice(0, 200)}`);
  }
  return res.text();
}
