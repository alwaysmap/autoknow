import type { StringKey } from './i18n';

// The ingest BOUNDARY: the byte ceiling every fetcher shares, and the typed vocabulary for
// saying no ([ADR: Ingestion is sized for hundreds of sources; declare the limits, gate the
// 10K rebuild](../../docs/adr/2026-07-22-ingestion-sized-for-hundreds-gate-the-10k-rebuild.md)
// decision 3, #56).
//
// Two properties this module exists to hold:
//
//  1. **No-OOM is a GUARANTEE, not an accident.** `fetchWebUrl` used to buffer the whole
//     body with `res.text()` and only then slice it to 2 MB — the cap described a string
//     that had already been materialized inside a 512 MiB container, and the Drive export
//     had no cap at all. `readCapped` moves the ceiling onto the wire: bytes are counted as
//     they arrive and the body is CANCELLED the moment the total reaches the cap, so no
//     source can make the container allocate more than the cap no matter what it declares.
//  2. **A rejection is TYPED, so its message can be honest and localized.** A leaked
//     "Google Drive export failed (403)" tells the user who shared a video nothing about
//     why. Fetchers throw a `kind`; the mutation boundary maps it to a catalog key and the
//     UI renders that — lib prose never escapes into a page (AGENTS lesson 5).
//
// Deliberately isomorphic (no 'server-only'): the key map is what the client renders.

/** How many bytes AutoKnow will pull from ONE source. Same number as the old post-hoc
 *  2 MB slice — only the enforcement point moved (from "after buffering" to "on the wire").
 *  Content past it is dropped, which is always ALSO past the 30K distillation cap, so the
 *  row it produces is already flagged lossy: no separate signal is needed for this ceiling. */
/** The distillation input cap: only the first MAX_DOC_CHARS of a document reach Gemini.
 *  Lives here rather than in gemini.ts because the client renders it (Manage → Sources)
 *  and gemini.ts is `server-only`; gemini re-exports it for its own callers. */
export const MAX_DOC_CHARS = 30000;

/** One source = one digest = one embedding, so text past the cap never reached the
 *  index. Three writers set `ContextUrl.truncated`; they all ask HERE, so a fourth
 *  cannot quietly disagree. */
export const isTruncated = (text: string): boolean => text.length > MAX_DOC_CHARS;

export const MAX_FETCH_BYTES = 2_000_000;

/** Why a source was refused at the boundary. Each maps to one honest catalog string. */
export type RejectionKind = 'unsupported-media';

export const REJECTION_KEY: Record<RejectionKind, StringKey> = {
  'unsupported-media': 'ingestRejectMedia',
};

/** A boundary refusal that carries its reason. Thrown by the fetchers and mapped to
 *  `IngestResult.errorKey` by the ingest entry points. */
export class SourceRejected extends Error {
  constructor(
    readonly kind: RejectionKind,
    /** Interpolated into the catalog string (the media type) — data, never prose. */
    readonly vars: Record<string, string | number> = {},
  ) {
    super(`${kind}: ${JSON.stringify(vars)}`);
    this.name = 'SourceRejected';
  }
}

export function isSourceRejected(e: unknown): e is SourceRejected {
  return e instanceof SourceRejected;
}

/**
 * Read a response body as text, stopping HARD at `maxBytes`.
 *
 * Bytes are counted as they arrive and the body is cancelled once the cap is reached, so a
 * multi-GB source costs the cap and nothing more — a lying or absent Content-Length cannot
 * get past it. `res.text()` is used only when the runtime handed us no stream at all (a
 * hand-rolled Response in a test double); the result is sliced to the same ceiling.
 *
 * It truncates rather than refuses because every caller is on a TEXT path that is about to
 * be truncated to `MAX_DOC_CHARS` (30K) anyway: refusing a genuinely large document would
 * lose content the 30K digest would otherwise have covered.
 */
export async function readCapped(res: Response, maxBytes: number = MAX_FETCH_BYTES): Promise<string> {
  const body = res.body;
  if (!body) return (await res.text()).slice(0, maxBytes);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen = 0;
  let out = '';
  try {
    while (seen < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    // Releases the socket the moment we stop caring — the point of streaming the cap.
    await reader.cancel().catch(() => {});
  }
  return (out + decoder.decode()).slice(0, maxBytes);
}
