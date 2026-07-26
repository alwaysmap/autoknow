/** @jest-environment node */
// The contract: regenerateSummary must NEVER throw — every failure comes back as
// `{ error }` — and a quota already known to be biting is declined BEFORE any spend.
// Why that is a PAGE-level contract and not a nicety:
// docs/knowledge/a-server-action-a-component-auto-fires-is-on-the-pages-critical-path.md
import { noteQuotaExhausted, resetQuotaLatchForTests } from '../src/lib/geminiQuota';

jest.mock('server-only', () => ({}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('../src/lib/db', () => ({ prisma: {} }));
// Only the "is there a key" answer is faked; isQuotaError stays REAL, so the test
// proves the action recognises a real Gemini refusal rather than a fixture of one.
jest.mock('../src/lib/gemini', () => ({
  ...jest.requireActual('../src/lib/gemini'),
  geminiConfigured: true,
}));

const createSummary = jest.fn();
jest.mock('../src/lib/summaries', () => ({ createSummary: (...a: unknown[]) => createSummary(...a) }));

let actions: typeof import('../src/app/actions/summaries');

const form = () => {
  const fd = new FormData();
  fd.set('scope', 'program');
  fd.set('targetId', '3');
  fd.set('path', '/programs/3');
  return fd;
};

/** What @google/genai actually throws when the project is over its spending cap. */
const spendCapError = () =>
  Object.assign(
    new Error(
      '{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap.","status":"RESOURCE_EXHAUSTED"}}',
    ),
    { status: 429 },
  );

beforeAll(async () => {
  actions = await import('../src/app/actions/summaries');
});

beforeEach(() => {
  createSummary.mockReset();
  resetQuotaLatchForTests();
});

describe('regenerateSummary', () => {
  it('returns the quota decline instead of throwing when Gemini refuses to spend', async () => {
    createSummary.mockRejectedValue(spendCapError());

    const result = await actions.regenerateSummary(form());

    expect(result.error).toMatch(/quota or spending cap/i);
    expect(result.error).toContain('the existing briefing is unchanged');
  });

  it('declines a latched quota before spending anything', async () => {
    noteQuotaExhausted('429 RESOURCE_EXHAUSTED');

    const result = await actions.regenerateSummary(form());

    expect(createSummary).not.toHaveBeenCalled();
    expect(result.error).toMatch(/quota or spending cap/i);
  });

  it('reports an unexpected failure as a readable sentence, still without throwing', async () => {
    createSummary.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await actions.regenerateSummary(form());

    expect(result.error).toBe('The briefing could not be refreshed — the last one is unchanged.');
  });

  it('reports success as an empty result', async () => {
    createSummary.mockResolvedValue({ id: 1 });

    await expect(actions.regenerateSummary(form())).resolves.toEqual({});
    expect(createSummary).toHaveBeenCalledWith('program', 3, 'manual');
  });
});
