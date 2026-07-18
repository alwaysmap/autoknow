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
