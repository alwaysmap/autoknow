'use client';

import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import DateCell from '../../../components/DateCell';
import { t, Locale } from '../../../lib/i18n';

// The person's prior companies, as a table (#125). It was a CSS-grid pseudo-table —
// repeated 3-cell rows of dates / company / role — so it carried none of the §6
// grammar: no `<th scope="row">`, no sortable headers, and a localized month-year
// range ("Jan 2020 – Mar 2022") where §6 asks for ISO dates through DateCell.
//
// A CLIENT component because DataTable takes `renderRow`, and a function prop cannot
// cross a Server Component boundary — the person page is `async`. Every other
// DataTable host is a client component for the same reason.
//
// Never paged: a person's employment history is however many rows the record holds,
// capped by their life, not a page of a larger set.

export interface PersonHistoryRow {
  id: number;
  partnerId: number;
  partnerName: string;
  role: string;
  /** ISO; the sort key too, so the column sorts on the real instant. */
  startDate: string;
  /** ISO, or null while they are still there. */
  endDate: string | null;
}

export default function PersonHistoryTable({ rows, locale }: { rows: PersonHistoryRow[]; locale: Locale }) {
  return (
    <DataTable
      headers={[
        { key: 'partnerName', label: t(locale, 'companyLabel') },
        { key: 'role', label: t(locale, 'roleLabel') },
        { key: 'startDate', label: t(locale, 'fromLabel'), sortType: 'date' },
        { key: 'endDate', label: t(locale, 'toLabel'), sortType: 'date' },
      ]}
      data={rows}
      paginate={false}
      // Most recent first, matching the query's own `startDate: desc`.
      defaultSortKey="startDate"
      defaultSortOrder="desc"
      renderRow={(r: PersonHistoryRow) => (
        <tr key={r.id}>
          <th scope="row">
            <Link href={`/partners/${r.partnerId}`}>{r.partnerName}</Link>
          </th>
          <td>{r.role}</td>
          <td><DateCell value={r.startDate} /></td>
          {/* No end date means still there — "present", not an unknown value. */}
          <td><DateCell value={r.endDate} fallback={t(locale, 'present')} /></td>
        </tr>
      )}
    />
  );
}
