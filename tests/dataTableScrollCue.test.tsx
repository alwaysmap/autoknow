/** @jest-environment jsdom */
// The off-screen-column affordance (gh-268): a horizontally-scrolled table gave no sign
// columns existed past either edge, and the reverted pure-CSS attempt's own lesson was
// that a DOM-presence test cannot catch this class of bug (it painted, but behind the
// table's own opaque cell backgrounds, and was invisible in a screenshot — see the
// GitHub issue). This file cannot re-prove VISIBILITY — jsdom has no real layout engine,
// so `getBoundingClientRect`/`scrollWidth` are inert — that half of the guarantee comes
// from the live-browser screenshot taken in both themes before this shipped. What this
// DOES cover, and is worth pinning: the wiring from real scroll geometry to the
// `data-visible` flag the CSS keys off, so a future refactor that breaks the
// read-scroll-state → toggle-the-cue chain fails loudly here rather than silently in
// production.

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '../src/components/LocaleProvider';
import DataTable from '../src/components/DataTable';

type Row = { id: number; name: string };
const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

function renderTable() {
  const { container } = render(
    <LocaleProvider locale="en">
      <DataTable
        headers={[{ key: 'name', label: 'Name' }]}
        data={rows}
        renderRow={(r: Row) => (
          <tr key={r.id}>
            <th scope="row">{r.name}</th>
          </tr>
        )}
        paginate={false}
      />
    </LocaleProvider>,
  );
  const wrapper = container.querySelector('.tableWrapper') as HTMLDivElement;
  const left = container.querySelector('.scrollCueLeft') as HTMLDivElement;
  const right = container.querySelector('.scrollCueRight') as HTMLDivElement;
  return { wrapper, left, right };
}

/** jsdom never lays anything out — `scrollWidth`/`clientWidth`/`scrollLeft` are all 0 by
 *  default on every element. Stubbing them is the standard way to drive scroll-dependent
 *  code under jsdom (there is no real alternative short of a browser). */
function setScrollGeometry(el: HTMLDivElement, { scrollLeft, clientWidth, scrollWidth }: {
  scrollLeft: number; clientWidth: number; scrollWidth: number;
}) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, value: scrollLeft, writable: true });
}

describe('DataTable off-screen-column cue (gh-268)', () => {
  it('shows neither cue for a table that fits — the neutral state matching the server snapshot', () => {
    const { left, right } = renderTable();
    expect(left).toHaveAttribute('data-visible', 'false');
    expect(right).toHaveAttribute('data-visible', 'false');
  });

  it('shows the RIGHT cue only when content extends past the visible edge', () => {
    const { wrapper, left, right } = renderTable();
    setScrollGeometry(wrapper, { scrollLeft: 0, clientWidth: 400, scrollWidth: 900 });
    fireEvent.scroll(wrapper);

    expect(right).toHaveAttribute('data-visible', 'true');
    expect(left).toHaveAttribute('data-visible', 'false'); // nothing scrolled past on the left yet
  });

  it('shows BOTH cues once scrolled to the middle', () => {
    const { wrapper, left, right } = renderTable();
    setScrollGeometry(wrapper, { scrollLeft: 450, clientWidth: 400, scrollWidth: 900 });
    fireEvent.scroll(wrapper);

    expect(left).toHaveAttribute('data-visible', 'true');
    expect(right).toHaveAttribute('data-visible', 'true');
  });

  it('drops the right cue once fully scrolled to the end, and keeps the left one', () => {
    const { wrapper, left, right } = renderTable();
    // 500 + 400 clientWidth == 900 scrollWidth: nothing left to reveal on the right.
    setScrollGeometry(wrapper, { scrollLeft: 500, clientWidth: 400, scrollWidth: 900 });
    fireEvent.scroll(wrapper);

    expect(right).toHaveAttribute('data-visible', 'false');
    expect(left).toHaveAttribute('data-visible', 'true');
  });

  it('both cues are decorative, never announced by assistive tech', () => {
    const { left, right } = renderTable();
    expect(left).toHaveAttribute('aria-hidden', 'true');
    expect(right).toHaveAttribute('aria-hidden', 'true');
  });
});
