/** @jest-environment jsdom */
// A scope with no evidence must not sit forever "Synthesizing…": once the
// auto-generation completes and there is still no summary, the panel shows an honest
// "nothing to summarize" state.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '../src/components/LocaleProvider';
import SummaryPanel from '../src/components/SummaryPanel';

const regenerateSummary = jest.fn(async (_fd: FormData) => {});
jest.mock('../src/app/actions/summaries', () => ({
  regenerateSummary: (fd: FormData) => regenerateSummary(fd),
}));

const renderPanel = (props: Partial<React.ComponentProps<typeof SummaryPanel>> = {}) =>
  render(
    <LocaleProvider locale="en">
      <SummaryPanel scope="partner" targetId={1} path="/partners/1" summary={null} configured {...props} />
    </LocaleProvider>,
  );

beforeEach(() => regenerateSummary.mockClear());

describe('SummaryPanel with no evidence', () => {
  it('auto-generates on mount, then shows the empty state instead of a stuck spinner', async () => {
    renderPanel();
    // The mount effect kicks off exactly one generation.
    await waitFor(() => expect(regenerateSummary).toHaveBeenCalledTimes(1));
    // Generation resolved with no summary → honest empty state, not "Synthesizing…".
    await waitFor(() => expect(screen.getByText(/Nothing to summarize/i)).toBeInTheDocument());
    expect(screen.queryByText(/Synthesizing/i)).not.toBeInTheDocument();
  });

  it('does not auto-generate when Gemini is unconfigured (shows the off message)', async () => {
    renderPanel({ configured: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(regenerateSummary).not.toHaveBeenCalled();
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
        <SummaryPanel scope="program" targetId={4} path="/programs/4" summary={stored} configured />
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
        <SummaryPanel scope="program" targetId={4} path="/programs/4" summary={legacy} configured />
      </LocaleProvider>,
    );
    expect(screen.getByText('No links here.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
