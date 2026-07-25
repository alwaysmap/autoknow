/** @jest-environment node */
// The ingest BOUNDARY (#56, the scaling ADR's decision 3): the byte ceiling that makes
// no-OOM a guarantee, and the typed refusal that replaces a leaked upstream 403.
//
// Every assertion here is about a HONEST DEGRADE, so each one is written to fail loudly if
// the guard it covers is removed: the oversized-body cases feed a stream that is far larger
// than the cap and assert both the returned size AND that the producer was cancelled (a cap
// applied after buffering passes the size check and fails the cancel check), and the
// rejection cases assert the typed key, not prose.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.GEMINI_API_KEY = '';

jest.mock('server-only', () => ({}));
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

import { readCapped, SourceRejected, MAX_FETCH_BYTES } from '../src/lib/ingestLimits';
import { readFileSync } from 'node:fs';
import { isTruncated, MAX_DOC_CHARS } from '../src/lib/ingestLimits';
import { stripComments } from './helpers/sourceFiles';

let fetchWebUrl: typeof import('../src/lib/ingest').fetchWebUrl;
let fetchGoogleDocText: typeof import('../src/lib/google-docs').fetchGoogleDocText;

const realFetch = global.fetch;

beforeAll(async () => {
  ({ fetchWebUrl } = await import('../src/lib/ingest'));
  ({ fetchGoogleDocText } = await import('../src/lib/google-docs'));
});

afterEach(() => {
  global.fetch = realFetch;
});

const CHUNK = 256 * 1024;

/** A body far bigger than the ceiling, which reports how much of it was actually pulled and
 *  whether the reader cancelled. Finite on purpose: an UNBOUNDED read of it must terminate
 *  and fail the assertions rather than hang the suite. */
function bigBody(totalChunks: number) {
  const stats = { pulls: 0, cancelled: false };
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalChunks) return controller.close();
      sent++;
      stats.pulls++;
      controller.enqueue(new Uint8Array(CHUNK).fill(0x61)); // 'a'
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  return { stream, stats };
}

describe('readCapped — the ceiling is on the wire, not on a buffered string', () => {
  it('stops at the cap and cancels the body instead of draining it', async () => {
    const { stream, stats } = bigBody(40); // 10 MB offered against a 2 MB cap
    const text = await readCapped(new Response(stream), MAX_FETCH_BYTES);

    expect(text.length).toBeLessThanOrEqual(MAX_FETCH_BYTES);
    // The cap is what bounds the cost: reading all 40 chunks and slicing afterwards would
    // still satisfy the length assertion — this is the one that catches it.
    // (One chunk of slack for the runtime's own read-ahead on top of the capped read.)
    expect(stats.pulls * CHUNK).toBeLessThanOrEqual(MAX_FETCH_BYTES + 2 * CHUNK);
    expect(stats.cancelled).toBe(true);
  });

  it('returns a small body whole', async () => {
    expect(await readCapped(new Response('short and complete'))).toBe('short and complete');
  });
});

describe('fetchWebUrl — the binary boundary', () => {
  it('refuses a video by NAME, without reading a byte of it', async () => {
    const { stream, stats } = bigBody(40);
    global.fetch = jest.fn(async () =>
      new Response(stream, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    ) as typeof fetch;

    const res = await fetchWebUrl('http://public.example/clip.mp4');
    expect(res.ok).toBe(false);
    expect(res.errorKey).toBe('ingestRejectMedia');
    expect(res.errorVars).toEqual({ type: 'video/mp4' });
    // Never downloaded: the runtime's own read-ahead is all that moved, and the body was
    // cancelled rather than drained.
    expect(stats.pulls * CHUNK).toBeLessThanOrEqual(CHUNK);
    expect(stats.cancelled).toBe(true);
  });

  it('caps an oversized HTML page instead of buffering it', async () => {
    const { stream, stats } = bigBody(40);
    global.fetch = jest.fn(async () =>
      new Response(stream, { status: 200, headers: { 'content-type': 'text/plain' } }),
    ) as typeof fetch;

    const res = await fetchWebUrl('http://public.example/huge.txt');
    expect(res.ok).toBe(true);
    expect(res.text!.length).toBeLessThanOrEqual(MAX_FETCH_BYTES);
    expect(stats.cancelled).toBe(true);
    // (One chunk of slack for the runtime's own read-ahead on top of the capped read.)
    expect(stats.pulls * CHUNK).toBeLessThanOrEqual(MAX_FETCH_BYTES + 2 * CHUNK);
  });
});

describe('fetchGoogleDocText — a shared binary is a typed refusal, not a leaked 403', () => {
  const driveResponses = (probe: Response) =>
    jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/export')) {
        return new Response('{"error":{"code":403}}', { status: 403 });
      }
      return probe;
    }) as unknown as typeof fetch;

  it('names what the file actually is', async () => {
    global.fetch = driveResponses(new Response(JSON.stringify({ mimeType: 'video/mp4' }), { status: 200 }));

    const err = await fetchGoogleDocText('file1', 'token').catch((e) => e);
    expect(err).toBeInstanceOf(SourceRejected);
    expect((err as SourceRejected).kind).toBe('unsupported-media');
    expect((err as SourceRejected).vars).toEqual({ type: 'video/mp4' });
  });

  it('still reports a genuine permission failure as a 403, so refresh freezes it', async () => {
    // The probe is denied too — that is what "I cannot see this file" looks like, and
    // refreshSource's access-revoked freeze keys off the 403 in this message.
    global.fetch = driveResponses(new Response('nope', { status: 403 }));

    const err = await fetchGoogleDocText('file2', 'token').catch((e) => e);
    expect(err).not.toBeInstanceOf(SourceRejected);
    expect((err as Error).message).toMatch(/403/);
  });

  it('leaves a real Doc alone', async () => {
    global.fetch = jest.fn(async () => new Response('the doc text')) as typeof fetch;
    expect(await fetchGoogleDocText('file3', 'token')).toBe('the doc text');
  });
});

// ---- Every writer of ContextUrl.truncated asks the same question (#56 review) --------
//
// Three code paths write `ingestedText`, and each has to decide whether the row is
// lossy. When they each spelled `text.length > MAX_DOC_CHARS` themselves, one of them
// (chatEvents' re-mention path) simply forgot — a Chat thread that grew past the cap
// was never flagged, which is the silent limit this issue exists to remove. The
// predicate has one home now; this holds the writers to it.

describe('isTruncated is the one definition of lossy (#56)', () => {
  it('is false at the cap and true one character past it', () => {
    expect(isTruncated('x'.repeat(MAX_DOC_CHARS))).toBe(false);
    expect(isTruncated('x'.repeat(MAX_DOC_CHARS + 1))).toBe(true);
  });

  it('no writer of `truncated` spells the comparison itself', () => {
    // A source scan, because the failure is a MISSING call, which no unit test of the
    // predicate can see. Anti-vacuity partner below.
    const writers = ['src/lib/ingest.ts', 'src/lib/refresh.ts', 'src/lib/chatEvents.ts'];
    const offenders = writers.filter((f) =>
      /\.length\s*>\s*MAX_DOC_CHARS/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('every writer of `truncated` calls isTruncated — the scan above is worthless if none does', () => {
    const writers = ['src/lib/ingest.ts', 'src/lib/refresh.ts', 'src/lib/chatEvents.ts'];
    for (const f of writers) {
      expect(stripComments(readFileSync(f, 'utf8'))).toMatch(/isTruncated\(/);
    }
  });
});
