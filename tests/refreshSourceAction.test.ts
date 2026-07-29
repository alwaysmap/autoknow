/** @jest-environment node */
// "Refresh now" on Manage → Sources. Two contracts, both learned the hard way:
//
//  1. It must never throw. It used to ride a bare `<form action={…}>`, so a provider
//     rejection replaced the whole page with Next's error boundary
//     (docs/knowledge/a-server-action-a-component-auto-fires-is-on-the-pages-critical-path.md).
//  2. It must RETURN why. Fixing (1) by swallowing the failure left the operator staring
//     at a row that simply did not advance, with the reason only in the server log —
//     the perpetual spinner in a quieter costume (autoknow-dv3, AGENTS lesson 5).
import { noteQuotaExhausted, resetQuotaLatchForTests } from '../src/lib/geminiQuota';

jest.mock('server-only', () => ({}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('../src/lib/db', () => ({ prisma: {} }));
jest.mock('../src/lib/gemini', () => ({ geminiConfigured: true }));
jest.mock('../src/lib/session', () => ({
  getAccessToken: jest.fn(async () => null),
  getCurrentUser: jest.fn(async () => ({ handle: 'dev' })),
}));

const refreshSource = jest.fn();
jest.mock('../src/lib/refresh', () => ({ refreshSource: (...a: unknown[]) => refreshSource(...a) }));
jest.mock('../src/lib/ingest', () => ({ ingestLink: jest.fn() }));

let actions: typeof import('../src/app/actions/context');

const form = (id = '7') => {
  const fd = new FormData();
  fd.set('id', id);
  return fd;
};

beforeAll(async () => {
  actions = await import('../src/app/actions/context');
});

beforeEach(() => {
  refreshSource.mockReset();
  resetQuotaLatchForTests();
});

describe('refreshSourceAction', () => {
  it('reports the verdict when the check succeeds', async () => {
    refreshSource.mockResolvedValue({ ok: true, result: 'unchanged' });
    await expect(actions.refreshSourceAction({}, form())).resolves.toEqual({ result: 'unchanged' });
  });

  it('declines BEFORE spending when the quota latch is set, and says so', async () => {
    noteQuotaExhausted('429 RESOURCE_EXHAUSTED');
    const state = await actions.refreshSourceAction({}, form());
    expect(refreshSource).not.toHaveBeenCalled();
    // The server's own sentence, which names the cap and where to check it — the row
    // renders this verbatim rather than mapping it to a key of ours.
    expect(state.error).toMatch(/quota or spending cap/);
    expect(state.result).toBeUndefined();
  });

  it('passes a returned refusal through instead of reporting silent success', async () => {
    refreshSource.mockResolvedValue({ ok: false, error: 'Drive refresh needs a signed-in session.' });
    await expect(actions.refreshSourceAction({}, form())).resolves.toEqual({
      error: 'Drive refresh needs a signed-in session.',
    });
  });

  it('never lets an unexpected throw out — it names it instead', async () => {
    refreshSource.mockRejectedValue(new Error('socket hang up'));
    const state = await actions.refreshSourceAction({}, form());
    expect(state.error).toMatch(/socket hang up/);
  });

  it('still throws on OUR OWN malformed form — that is a bug, not the world refusing', async () => {
    const fd = new FormData();
    fd.set('id', 'not-a-number');
    await expect(actions.refreshSourceAction({}, fd)).rejects.toThrow(/Invalid source id/);
  });
});
