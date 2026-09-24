/** @jest-environment node */
// The contract: `POST /api/summaries/:scope/:id` answers every refusal with a sentence
// the panel can show as-is, and declines a quota already known to be biting BEFORE any
// spend. SummaryPanel calls it unattended on ordinary page views, so its refusals are
// read by someone who did not ask for anything
// (docs/knowledge/a-server-action-a-component-auto-fires-is-on-the-pages-critical-path.md).
import { noteQuotaExhausted, resetQuotaLatchForTests } from '../src/lib/geminiQuota';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
// Only the "is there a key" answer is faked; isQuotaError stays REAL, so the test
// proves the route recognises a real Gemini refusal rather than a fixture of one.
jest.mock('../src/lib/gemini', () => ({
  ...jest.requireActual('../src/lib/gemini'),
  geminiConfigured: true,
}));

const createSummary = jest.fn();
const getSummary = jest.fn();
jest.mock('../src/lib/summaries', () => ({
  createSummary: (...a: unknown[]) => createSummary(...a),
  getSummary: (...a: unknown[]) => getSummary(...a),
}));

let route: typeof import('../src/app/api/summaries/[scope]/[id]/route');

const post = () =>
  route.POST(new Request('http://localhost/api/summaries/program/3', { method: 'POST' }) as never, {
    params: Promise.resolve({ scope: 'program', id: '3' }),
  });

/** What @google/genai actually throws when the project is over its spending cap. */
const spendCapError = () =>
  Object.assign(
    new Error(
      '{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap.","status":"RESOURCE_EXHAUSTED"}}',
    ),
    { status: 429 },
  );

beforeAll(async () => {
  route = await import('../src/app/api/summaries/[scope]/[id]/route');
});

beforeEach(() => {
  createSummary.mockReset();
  getSummary.mockReset();
  resetQuotaLatchForTests();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('POST /api/summaries/:scope/:id', () => {
  it('answers a mid-call spend cap with the quota decline, not a bare 500', async () => {
    createSummary.mockRejectedValue(spendCapError());

    const res = await post();

    expect(res.status).toBe(503);
    const { error } = await res.json();
    expect(error).toMatch(/quota or spending cap/i);
    expect(error).toContain('the existing briefing is unchanged');
  });

  it('declines a latched quota before spending anything', async () => {
    noteQuotaExhausted('429 RESOURCE_EXHAUSTED');

    const res = await post();

    expect(createSummary).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/quota or spending cap/i);
  });

  it('reports an unexpected failure as a readable sentence', async () => {
    createSummary.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await post();

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('The briefing could not be refreshed — the last one is unchanged.');
  });

  it('returns the fresh briefing on success', async () => {
    createSummary.mockResolvedValue({ id: 1 });
    getSummary.mockResolvedValue({ id: 1, tldr: 'fresh' });

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: true, summary: { id: 1, tldr: 'fresh' } });
    expect(createSummary).toHaveBeenCalledWith('program', 3, 'manual');
  });

  it('answers "no evidence" as an empty briefing, not a 404 a reader would read as a bad scope', async () => {
    createSummary.mockResolvedValue({ id: null });

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: true, summary: null });
    expect(getSummary).not.toHaveBeenCalled();
  });
});
