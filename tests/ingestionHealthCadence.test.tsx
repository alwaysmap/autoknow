/** @jest-environment jsdom */
// The cadence has to survive the trip to the BROWSER, and that is a separate claim from
// "the math divides by the right number". Manage → Sources renders on the server, where
// REFRESH_CRON_SCHEDULE exists, but the budget slider is a client component, where it does
// not. If the client half re-resolved the cadence for itself it would silently fall back
// to hourly — putting the plotted ceiling back out of step with the enforced one, which is
// the whole defect, only now in the half a human actually reads.
//
// So this renders the real card and asserts on the DOM: the figure under the slider and
// the sentence beside it both move when the schedule does.
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import IngestionHealthCard from '../src/components/IngestionHealthCard';
import type { IngestionHealth } from '../src/lib/ingestionHealth';
import { budgetGauge } from '../src/lib/ingestBudget';

jest.mock('../src/app/actions/ingestion', () => ({
  updateIngestionBudgetAction: async () => {},
}));
// The card names the document-size limit, which drags in the Gemini SDK — ESM, and not
// something jsdom will load. The constant is all this render needs.
jest.mock('../src/lib/gemini', () => ({ MAX_DOC_CHARS: 100_000 }));

const INHERITED_CRON = process.env.REFRESH_CRON_SCHEDULE;
beforeEach(() => {
  delete process.env.REFRESH_CRON_SCHEDULE;
});
afterAll(() => {
  if (INHERITED_CRON === undefined) delete process.env.REFRESH_CRON_SCHEDULE;
  else process.env.REFRESH_CRON_SCHEDULE = INHERITED_CRON;
});

const health = (): IngestionHealth => ({
  summary: null,
  skipped: [],
  truncated: 0,
  budget: { dailyReingestBudgetDocs: 60, freeTierRequestsPerDay: 250 },
  gauge: budgetGauge(60, 250, 24),
});

const renderCard = () => render(<IngestionHealthCard locale="en" health={health()} />);

describe('the Sources page carries the exported cadence across the server/client boundary', () => {
  it('plots the hourly default, and claims no cadence, when infrastructure said nothing', () => {
    renderCard();
    // 60 docs/day over 24 cycles ⇒ 2 a cycle ⇒ 96 requests/day, under a 250 tier.
    expect(screen.getByTestId('budget-readout')).toHaveTextContent('96');
    expect(screen.queryByTestId('over-free-tier')).not.toBeInTheDocument();
    // No cadence was supplied, so none is asserted — the ADR's "unknown is a branch".
    expect(screen.getByText(/on each refresh run/i)).toBeInTheDocument();
  });

  it('plots the REAL cadence, and names it, when Terraform exported one', () => {
    process.env.REFRESH_CRON_SCHEDULE = '*/10 * * * *';
    renderCard();
    // 144 cycles: the min-1 floor alone costs 288/day, so the same 60-doc budget that read
    // "96, under the free tier" above now reads over the 250 line. Under the old hardcoded
    // 24 this panel kept showing 96 while the cron really spent 288 — a factor of three,
    // and nothing on the page said so.
    expect(screen.getByTestId('budget-readout')).toHaveTextContent('288');
    expect(screen.getByTestId('over-free-tier')).toBeInTheDocument();
    expect(screen.getByText(/144 times a day/i)).toBeInTheDocument();
  });

  it('states no cadence when the exported schedule is a shape we will not guess at', () => {
    process.env.REFRESH_CRON_SCHEDULE = '0 9 * * 1'; // weekly — not a daily cadence
    renderCard();
    expect(screen.getByText(/on each refresh run/i)).toBeInTheDocument();
    // The math still needs a divisor, so it uses the documented fallback rather than
    // refusing to render a budget at all.
    expect(screen.getByTestId('budget-readout')).toHaveTextContent('96');
  });
});
