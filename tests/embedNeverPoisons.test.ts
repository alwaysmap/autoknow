/** @jest-environment node */
// A stored embedding is data. Substituting the deterministic fallback for one that failed
// to compute does not degrade that data, it DESTROYS it: the fallback is all-positive, so
// any two fallback vectors score ~0.75 cosine against each other whatever the text says
// (docs/knowledge/fallback-embedding-is-a-uniform-pedestal-not-signal.md).
//
// It used to do exactly that. `embedText` caught every error — including the HTTP 429
// RESOURCE_EXHAUSTED of a monthly spend cap — and returned the pedestal, which refresh
// then wrote in the SAME transaction as the new digest and contentHash. The hash matched
// from then on, Gate 1 reported 'unchanged' forever, and the row was never re-embedded:
// a healthy vector replaced by anti-signal, permanently, with the row still looking fine.
//
// So the split these tests pin: storage fails LOUD (callers abort, the old row survives),
// a query fails SOFT (search drops to lexical rather than going down).
import { generateDeterministicEmbedding } from '../src/lib/embedding-fallback';

jest.mock('server-only', () => ({}));

const QUOTA_429 = Object.assign(new Error('Your project has exceeded its monthly spending cap.'), {
  status: 429,
});

/** gemini.ts captures the key and constructs the client at import time, so each scenario
 *  needs a fresh registry — the same import-time capture behind tests/no-live-gemini.ts. */
async function loadGemini(opts: { key: string | null; embed?: () => Promise<unknown> }) {
  jest.resetModules();
  if (opts.key === null) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = opts.key;

  const embedContent = jest.fn(opts.embed ?? (async () => ({ embeddings: [{ values: new Array(768).fill(0.01) }] })));
  jest.doMock('@google/genai', () => ({
    GoogleGenAI: jest.fn(() => ({ models: { embedContent, generateContent: jest.fn() } })),
    Type: new Proxy({}, { get: (_t, p) => String(p) }),
  }));

  const mod = await import('../src/lib/gemini');
  const quota = await import('../src/lib/geminiQuota');
  quota.resetQuotaLatchForTests();
  return { ...mod, quota, embedContent };
}

describe('a stored embedding is never silently replaced by the fallback', () => {
  it('throws on a spend-cap refusal instead of returning the pedestal', async () => {
    const { embedForStorage, EmbeddingUnavailableError } = await loadGemini({
      key: 'test-key',
      embed: async () => { throw QUOTA_429; },
    });

    // It must REJECT — and specifically must not resolve with the pedestal, which is the
    // exact value the old implementation returned here.
    const pedestal = generateDeterministicEmbedding('a digest worth keeping');
    const outcome = await embedForStorage('a digest worth keeping').then(
      (v) => ({ resolved: v }),
      (e) => ({ threw: e }),
    );
    expect(outcome).not.toHaveProperty('resolved');
    expect(outcome).toEqual({ threw: expect.any(EmbeddingUnavailableError) });
    expect(outcome).not.toEqual({ resolved: pedestal });
  });

  it('marks a quota failure as such, so a caller can stop the batch rather than grind', async () => {
    const { embedForStorage } = await loadGemini({
      key: 'test-key',
      embed: async () => { throw QUOTA_429; },
    });
    await expect(embedForStorage('x')).rejects.toMatchObject({ quota: true });
  });

  it('throws rather than padding a wrong-width vector into the column', async () => {
    const { embedForStorage } = await loadGemini({
      key: 'test-key',
      embed: async () => ({ embeddings: [{ values: new Array(512).fill(0.5) }] }),
    });
    await expect(embedForStorage('x')).rejects.toMatchObject({ quota: false });
  });

  it('still uses the fallback when Gemini is UNCONFIGURED — no real vectors exist to damage', async () => {
    const { embedForStorage } = await loadGemini({ key: null });
    await expect(embedForStorage('hello')).resolves.toEqual(generateDeterministicEmbedding('hello'));
  });
});

describe('a query embedding fails soft, so a spend cap degrades ranking instead of search', () => {
  it('returns null on a quota refusal rather than throwing', async () => {
    const { embedForQuery } = await loadGemini({
      key: 'test-key',
      embed: async () => { throw QUOTA_429; },
    });
    await expect(embedForQuery('volvo')).resolves.toBeNull();
  });

  it('returns null — never the pedestal — when unconfigured', async () => {
    // Returning the fallback here would blend a constant ~0.75 into every ranking, which
    // is the noise `semantic = geminiConfigured` was introduced to switch off.
    const { embedForQuery } = await loadGemini({ key: null });
    await expect(embedForQuery('volvo')).resolves.toBeNull();
  });
});

describe('the quota latch lets the next caller decline before it mutates anything', () => {
  it('latches on a quota refusal and clears on a success', async () => {
    let fail = true;
    const { embedForStorage, quota } = await loadGemini({
      key: 'test-key',
      embed: async () => {
        if (fail) throw QUOTA_429;
        return { embeddings: [{ values: new Array(768).fill(0.01) }] };
      },
    });

    expect(quota.quotaBlocked()).toBeNull();
    await expect(embedForStorage('x')).rejects.toThrow();
    expect(quota.quotaBlocked()).not.toBeNull();
    expect(quota.quotaBlocked()!.reason).toMatch(/spending cap/i);

    // A later success proves the cap lifted — serve requests again immediately rather
    // than staying dark for the rest of the TTL.
    fail = false;
    await expect(embedForStorage('x')).resolves.toHaveLength(768);
    expect(quota.quotaBlocked()).toBeNull();
  });

  it('does not latch on a non-quota fault — one bad response is not a cap', async () => {
    const { embedForStorage, quota } = await loadGemini({
      key: 'test-key',
      embed: async () => { throw new Error('socket hang up'); },
    });
    await expect(embedForStorage('x')).rejects.toThrow();
    expect(quota.quotaBlocked()).toBeNull();
  });
});
