/** @jest-environment jsdom */
// `paginate={false}` declares a table that is never paged, and the whole point of the
// prop is that the footer goes IN FULL — count, Prev/Next AND the rows-per-page select
// (#125 decision B). A partial hide is the bug it exists to fix, so "no footer" is
// asserted piece by piece rather than by one absence check that a half-rendered footer
// would still satisfy.
//
// Before this, the footer's only condition was a non-zero row count, and `pageSize`
// doubled as "hide the rows-per-page control". That is why `PhaseTable` passed
// `pageSize={rows.length}` — reaching for the only prop that came close — and still
// painted "Showing 1–5 of 5" with a Prev/Next pair that was disabled on arrival and
// could never be anything else.

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '../src/components/LocaleProvider';
import DataTable from '../src/components/DataTable';

type Row = { id: number; name: string };
const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

const table = (props: { paginate?: boolean; pageSize?: number }) =>
  render(
    <LocaleProvider locale="en">
      <DataTable
        headers={[{ key: 'name', label: 'Name' }]}
        data={rows}
        renderRow={(r: Row) => (
          <tr key={r.id}>
            <th scope="row">{r.name}</th>
          </tr>
        )}
        {...props}
      />
    </LocaleProvider>,
  );

/** The three pieces of footer chrome, queried the way a reader would see them. */
const footer = () => ({
  count: screen.queryByText(/Showing/i),
  prev: screen.queryByRole('button', { name: /prev/i }),
  next: screen.queryByRole('button', { name: /next/i }),
  // The control is a <select aria-label={t('rowsPerPage')}> — 'Rows' in EN.
  rowsPerPage: screen.queryByRole('combobox', { name: /rows/i }),
});

describe('DataTable pagination chrome (#125)', () => {
  it('renders every row and NO footer at all when paginate={false}', () => {
    table({ paginate: false });

    for (const r of rows) expect(screen.getByText(r.name)).toBeInTheDocument();

    const f = footer();
    expect(f.count).toBeNull();
    expect(f.prev).toBeNull();
    expect(f.next).toBeNull();
    expect(f.rowsPerPage).toBeNull();
  });

  it('keeps the full footer by default, even when the data fits one page', () => {
    // Declared, not derived: a browsable listing that omits `paginate` keeps its footer
    // on a single page so the ROWS_PER_TABLE control stays discoverable.
    table({});

    const f = footer();
    expect(f.count).toBeInTheDocument();
    expect(f.prev).toBeInTheDocument();
    expect(f.next).toBeInTheDocument();
    expect(f.rowsPerPage).toBeInTheDocument();
  });

  it('lets pageSize set the page size WITHOUT hiding the rows-per-page control', () => {
    // The old coupling is what sent PhaseTable looking for `paginate`. `pageSize` fixes
    // the size; suppressing chrome is now `paginate`'s job alone.
    table({ pageSize: 2 });

    expect(screen.getByText('Row 1')).toBeInTheDocument();
    expect(screen.queryByText('Row 3')).toBeNull(); // page size honoured
    expect(footer().count).toBeInTheDocument();
  });
});
