/** @jest-environment jsdom */
// The DATE_LABELS preference, asserted where a reader actually meets it.
//
// `tests/dates.test.ts` proves the FORMATTER. This proves the WIRING — that the mode
// reaches the surfaces, and that the machine forms survive it. The distinction matters
// because the expensive failure mode here is not a wrong string: it is a correct string
// that eleven surfaces render and the twelfth does not, or a week label that quietly took
// the ISO `dateTime` down with it.
import React from 'react';
import { render } from '@testing-library/react';
import { LocaleProvider } from '../src/components/LocaleProvider';
import { DateLabelsProvider } from '../src/components/DateLabelsProvider';
import DateCell from '../src/components/DateCell';
import type { DateLabelMode } from '../src/lib/dates';

const draw = (value: string | null, mode: DateLabelMode) =>
  render(
    <LocaleProvider locale="en">
      {/* `modes.table` is what DateCell reads; `modes.prose` is pinned to the default so
          each assertion below proves the CELL followed the TABLE preference and not the
          other one — the two are separate controls (design.md §6). */}
      <DateLabelsProvider modes={{ prose: 'date', table: mode }}>
        <DateCell value={value} />
      </DateLabelsProvider>
    </LocaleProvider>,
  ).container;

const timeEl = (c: HTMLElement) => c.querySelector('time');

describe('DateCell under every TABLE_DATE_LABELS mode', () => {
  const ISO = '2026-07-18T00:00:00.000Z'; // a Saturday in W29

  test('the VISIBLE text follows the mode', () => {
    expect(timeEl(draw(ISO, 'date'))!.textContent).toBe('Jul 18, 2026');
    expect(timeEl(draw(ISO, 'date-week'))!.textContent).toBe('Jul 18, 2026 (W29)');
    expect(timeEl(draw(ISO, 'week'))!.textContent).toBe('W29 2026');
  });

  test('the MACHINE form never moves — dateTime stays ISO in all three', () => {
    // §6's whole argument for `<time>`: `dateTime` is what assistive tech announces, what
    // a copy-paste yields, and what anything parsing the DOM reads. A display preference
    // may not reach it, or "sort by date" and a screen reader start disagreeing with the
    // column beside them.
    for (const mode of ['date', 'date-week', 'week'] as DateLabelMode[]) {
      expect(timeEl(draw(ISO, mode))!.getAttribute('dateTime')).toBe('2026-07-18');
    }
  });

  test('the title carries the half the visible text dropped, in every mode', () => {
    expect(timeEl(draw(ISO, 'date'))!.getAttribute('title')).toBe('W29 2026');
    expect(timeEl(draw(ISO, 'date-week'))!.getAttribute('title')).toBe('W29 2026');
    // Week-only is the mode where a reader can no longer SEE the date; hover recovers it.
    expect(timeEl(draw(ISO, 'week'))!.getAttribute('title')).toBe('2026-07-18');
  });

  test('an empty cell is still an em dash, not "W" of nothing', () => {
    for (const mode of ['date', 'date-week', 'week'] as DateLabelMode[]) {
      const c = draw(null, mode);
      expect(timeEl(c)).toBeNull();
      expect(c.textContent).toBe('—');
    }
  });

  test('the default context value is the app default, so an unwrapped surface is unchanged', () => {
    // This is what makes the preference safe to adopt piecemeal: a component rendered
    // outside DateLabelsProvider renders exactly what it rendered before it existed.
    const c = render(<LocaleProvider locale="en"><DateCell value={ISO} /></LocaleProvider>).container;
    expect(timeEl(c)!.textContent).toBe('Jul 18, 2026');
  });

  test('a cell follows the TABLE preference and ignores the prose one', () => {
    // The reason there are two controls at all: a planner may want weeks in the column
    // they scan and plain dates in the briefing they read, or the reverse. If DateCell
    // ever went back to `useDateLabels()` this is the test that would say so.
    const proseOnly = render(
      <LocaleProvider locale="en">
        <DateLabelsProvider modes={{ prose: 'week', table: 'date' }}>
          <DateCell value={ISO} />
        </DateLabelsProvider>
      </LocaleProvider>,
    ).container;
    expect(timeEl(proseOnly)!.textContent).toBe('Jul 18, 2026');

    const tableOnly = render(
      <LocaleProvider locale="en">
        <DateLabelsProvider modes={{ prose: 'date', table: 'week' }}>
          <DateCell value={ISO} />
        </DateLabelsProvider>
      </LocaleProvider>,
    ).container;
    expect(timeEl(tableOnly)!.textContent).toBe('W29 2026');
  });
});
