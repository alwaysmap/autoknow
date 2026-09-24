/** @jest-environment jsdom */
// What the panel owes a reader when the briefing behind it is missing, unfinished, or
// unrefreshable — three failures that all used to render as the same optimism:
//   • no evidence at all → an honest "nothing to summarize", not a forever "Synthesizing…"
//   • a refused or failed auto-refresh → the reason, and NEVER the page (autoknow-6by)
//   • the entity links the briefing carries, which are the server's data, not the model's
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '../src/components/LocaleProvider';
import SummaryPanel from '../src/components/SummaryPanel';
import type { ActionResult } from '../src/lib/actionResult';

// The refresh is a plain fetch, never a server action: Next queues server actions and
// holds the router until each returns, so a Gemini call made that way froze the whole
// page for its duration. Importing the summaries actions from the panel is the
// regression, and this makes it fail loudly rather than quietly re-queue.
jest.mock('../src/app/actions/summaries', () => {
  throw new Error('SummaryPanel must not import server actions — its refresh would block the page');
});

/** The route's answer, as `fetch` would deliver it. */
const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => answer(200, { configured: true, summary: null }));
global.fetch = fetchMock as unknown as typeof fetch;

// Mocked for the same reason as the module above, one import further out: the panel now
// renders untracked-mention affordances (#127 E15), whose component imports the people
// actions, whose transitive Next imports need APIs jsdom does not provide. This suite is
// about what the PANEL renders; the actions have their own DB-backed tests.
jest.mock('../src/app/actions/people', () => ({
  trackPerson: jest.fn(async (): Promise<ActionResult> => ({})),
  dismissAddress: jest.fn(async (): Promise<ActionResult> => ({})),
}));

/** Stands in for Next's global-error: if the auto-refresh's failure escapes the panel,
 *  this is what the reader gets instead of the page. */
class Boundary extends React.Component<{ children: React.ReactNode }, { caught: boolean }> {
  state = { caught: false };
  static getDerivedStateFromError() {
    return { caught: true };
  }
  render() {
    return this.state.caught ? <p>THE PAGE DIED</p> : this.props.children;
  }
}

const renderPanel = (
  props: Partial<React.ComponentProps<typeof SummaryPanel>> = {},
  options?: Parameters<typeof render>[1],
) =>
  render(
    <LocaleProvider locale="en">
      <SummaryPanel scope="partner" targetId={1} summary={null} configured {...props} />
    </LocaleProvider>,
    options,
  );

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(answer(200, { configured: true, summary: null }));
});

// The briefing failing to refresh must cost the briefing, never the page (autoknow-6by).
describe('SummaryPanel when the auto-refresh fails', () => {
  const cached = {
    id: 1,
    scope: 'program' as const,
    targetId: 3,
    generatedAt: new Date().toISOString(),
    trigger: 'cron',
    model: 'test',
    tldr: 'Bring-up is on plan.',
    sourceCount: 2,
    stale: true, // ← what a fresh needle update leaves behind, and what fires the refresh
    body: { sections: [] },
  };

  // The panel under a stand-in for Next's error boundary: the two tests below differ
  // only in HOW the refresh fails, so nothing else may differ between them.
  const renderProgramPanel = () =>
    renderPanel({ scope: 'program', targetId: 3, summary: cached }, { wrapper: Boundary });

  it('keeps the page alive and says why when the route refuses', async () => {
    fetchMock.mockResolvedValue(
      answer(503, { error: 'Gemini is over its quota or spending cap — the existing briefing is unchanged.' }),
    );

    renderProgramPanel();

    await waitFor(() => expect(screen.getByTestId('summary-error-program')).toBeInTheDocument());
    expect(screen.queryByText('THE PAGE DIED')).not.toBeInTheDocument();
    // the cached briefing is still readable — it is older, not wrong
    expect(screen.getByText(/Bring-up is on plan/)).toBeInTheDocument();
  });

  it('survives a REJECTED fetch (the network, not the route)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderProgramPanel();

    await waitFor(() => expect(screen.getByTestId('summary-error-program')).toBeInTheDocument());
    expect(screen.queryByText('THE PAGE DIED')).not.toBeInTheDocument();
    // the client says only what it knows: no answer came back, whatever happened there
    expect(screen.getByText(/could not be refreshed — the server did not answer/i)).toBeInTheDocument();
  });
});

describe('SummaryPanel when the auto-refresh succeeds', () => {
  it('swaps in the returned briefing and drops "Updating", with no page refresh', async () => {
    const stale = {
      id: 1, scope: 'program' as const, targetId: 3, generatedAt: '2026-09-01T00:00:00.000Z',
      trigger: 'cron', model: 'test', tldr: 'Old news.', sourceCount: 1, stale: true, body: { sections: [] },
    };
    const fresh = { ...stale, id: 2, generatedAt: '2026-09-02T00:00:00.000Z', tldr: 'New news.', stale: false };
    fetchMock.mockResolvedValue(answer(200, { configured: true, summary: fresh }));

    renderPanel({ scope: 'program', targetId: 3, summary: stale });

    await waitFor(() => expect(screen.getByText('New news.')).toBeInTheDocument());
    expect(screen.queryByText('Old news.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Updating/i)).not.toBeInTheDocument();
  });
});

describe('SummaryPanel with no evidence', () => {
  it('auto-generates on mount, then shows the empty state instead of a stuck spinner', async () => {
    renderPanel();
    // The mount effect kicks off exactly one generation.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/summaries/partner/1', { method: 'POST' });
    // Generation resolved with no summary → honest empty state, not "Synthesizing…".
    await waitFor(() => expect(screen.getByText(/Nothing to summarize/i)).toBeInTheDocument());
    expect(screen.queryByText(/Synthesizing/i)).not.toBeInTheDocument();
  });

  it('does not auto-generate when Gemini is unconfigured (shows the off message)', async () => {
    renderPanel({ configured: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/GEMINI_API_KEY/)).toBeInTheDocument();
  });
});

describe('SummaryPanel entity links (#77)', () => {
  const stored = {
    id: 1,
    scope: 'program' as const,
    targetId: 4,
    generatedAt: new Date().toISOString(),
    trigger: 'manual',
    model: 'test',
    tldr: 'Sarah Jenkins owns the fix.',
    sourceCount: 1,
    stale: false,
    body: {
      // The tldr and a bullet both carry segments — a linked run wraps the noun in its
      // endpoint; the href is the server's, never one the model wrote.
      tldrSegments: [
        { text: 'Sarah Jenkins', href: '/people/5', external: false },
        { text: ' owns the fix.' },
      ],
      sections: [
        {
          key: 'actions' as const,
          bullets: [
            {
              text: 'Sarah Jenkins (Qualcomm) debugs the audio HAL freeze.',
              segments: [
                { text: 'Sarah Jenkins', href: '/people/5', external: false },
                { text: ' (' },
                { text: 'Qualcomm', href: '/partners/9', external: false },
                { text: ') debugs the audio HAL freeze.' },
              ],
              citations: [],
            },
          ],
        },
      ],
    },
  };

  it('renders segment links to the person and partner endpoints, no model-authored URL', () => {
    render(
      <LocaleProvider locale="en">
        <SummaryPanel scope="program" targetId={4} summary={stored} configured />
      </LocaleProvider>,
    );
    // The noun in the tldr AND in the bullet link to /people/5 (first-mention each).
    const personLinks = screen.getAllByRole('link', { name: 'Sarah Jenkins' });
    expect(personLinks).toHaveLength(2);
    personLinks.forEach((a) => expect(a).toHaveAttribute('href', '/people/5'));
    // The partner noun links to its own endpoint.
    expect(screen.getByRole('link', { name: 'Qualcomm' })).toHaveAttribute('href', '/partners/9');
    // The surrounding prose is preserved.
    expect(screen.getByText(/debugs the audio HAL freeze/)).toBeInTheDocument();
  });

  it('falls back to plain text for a bullet with no segments (old stored briefs)', () => {
    const legacy = {
      ...stored,
      body: { sections: [{ key: 'risks' as const, bullets: [{ text: 'No links here.', citations: [] }] }] },
    };
    render(
      <LocaleProvider locale="en">
        <SummaryPanel scope="program" targetId={4} summary={legacy} configured />
      </LocaleProvider>,
    );
    expect(screen.getByText('No links here.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
