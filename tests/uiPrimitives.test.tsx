/** @jest-environment jsdom */
// Structure/behaviour for the small UI primitives introduced this session. CSS
// modules resolve to stub class names under next/jest, so these assert markup and
// props (labels, the ink applied inline, the onChange contract) — the pixel
// concerns (box vs pill shape, contrast) are covered by the e2e specs, which have
// a real cascade.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '../src/components/LocaleProvider';
import ClassBox from '../src/components/ClassBox';
import KindBox, { KIND_COLOR } from '../src/components/KindBox';
import SearchField from '../src/components/SearchField';
import InstrumentGauge from '../src/components/InstrumentGauge';
import type { FeedKind } from '../src/lib/feed';

const wrap = (ui: React.ReactNode) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

describe('ClassBox', () => {
  it('renders its children and forwards a caller class', () => {
    wrap(<ClassBox className="ink">SUPPLIER</ClassBox>);
    const el = screen.getByText('SUPPLIER');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('ink');
  });
});

describe('KindBox', () => {
  const cases: Array<[FeedKind, string]> = [
    ['partner', 'Partner'],
    ['program', 'Program'],
    ['person', 'Person'],
    ['context', 'Context'],
    ['initiative', 'Initiative'],
  ];

  it.each(cases)('labels a %s result "%s"', (kind, label) => {
    wrap(<KindBox kind={kind} locale="en" />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('inks each kind with its identity token, never a hardcoded hex', () => {
    for (const [kind] of cases) {
      const { container, unmount } = wrap(<KindBox kind={kind} locale="en" />);
      const inked = container.querySelector('[style*="color"]') as HTMLElement;
      expect(inked.style.color).toBe(KIND_COLOR[kind]);
      expect(KIND_COLOR[kind]).toMatch(/^var\(--kind-/); // token, not a literal
      unmount();
    }
  });
});

describe('SearchField', () => {
  it('reports the STRING value, not the event, to onChange', () => {
    const onChange = jest.fn();
    wrap(<SearchField value="" onChange={onChange} placeholder="Search…" />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bosch' } });
    expect(onChange).toHaveBeenCalledWith('bosch');
  });

  it('is a search input carrying the placeholder as its accessible name by default', () => {
    wrap(<SearchField value="x" onChange={() => {}} placeholder="Search by name…" />);
    const input = screen.getByRole('searchbox', { name: 'Search by name…' });
    expect(input).toHaveValue('x');
    expect(input).toHaveAttribute('type', 'search');
  });
});

describe('InstrumentGauge', () => {
  // It must be the app's REAL gauge primitive (track + needle), not a shape drawn
  // to look like one — the data-needle / data-track handles come from Gauge.
  it('renders the real gauge, with the needle and track handles', () => {
    const { container } = render(<InstrumentGauge busy={false} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('[data-needle]')).toBeInTheDocument();
    expect(container.querySelector('[data-track]')).toBeInTheDocument();
  });

  it('renders without throwing whether or not a query is in flight', () => {
    expect(() => render(<InstrumentGauge busy />)).not.toThrow();
    expect(() => render(<InstrumentGauge busy={false} />)).not.toThrow();
  });

  it('is decorative: the dial carries no accessible name of its own', () => {
    // The busy state a sighted reader gets from the needle reaches a screen
    // reader through UnifiedSearch's live region instead — a dial that announced
    // itself would say the same thing twice, in a voice that cannot draw.
    const { container } = render(<InstrumentGauge busy />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
