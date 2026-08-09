'use client';

import Link from 'next/link';
import DataTable from './DataTable';
import DateCell from './DateCell';
import InitiativeDistribution from './InitiativeDistribution';
import { initiativeHref } from '../lib/entityHref';
import type { InitiativeListRow } from '../lib/initiativeQueries';
import { t, type Locale } from '../lib/i18n';

// The ONE rendering of the initiatives list table: linked name as the row header,
// member count, the shared status distribution, target date. Extracted the moment a
// second surface (/ecosystem-summary's #initiatives section, autoknow-hcz.12) needed
// the same table /initiatives renders — the loader (getInitiativesList) already made
// the COUNTS agree by construction (the summary-count ADR); this makes the COLUMNS
// agree the same way instead of by a twin headers array someone keeps in sync
// (AGENTS lesson 7). Deliberately funnel-less and unpaged: initiatives are counted
// in single digits and funnels on a short table are a call-site judgement (#125).

export default function InitiativesTable({ rows, locale }: { rows: InitiativeListRow[]; locale: Locale }) {
  return (
    <DataTable
      headers={[
        { key: 'name', label: t(locale, 'initiativeLabel'), sortable: true },
        { key: 'memberCount', label: t(locale, 'initiativeColPartners'), sortable: true },
        { key: 'progress', label: t(locale, 'initiativeColProgress') },
        { key: 'targetDate', label: t(locale, 'initiativeTargetLabel'), sortable: true, sortType: 'date' },
      ]}
      data={rows}
      defaultSortKey="name"
      defaultSortOrder="asc"
      paginate={false}
      emptyStateMessage={t(locale, 'initiativesEmpty')}
      renderRow={(r: InitiativeListRow) => (
        <tr key={r.id}>
          {/* Identity column as the row header (design.md §6): the name the row is
              FOR labels its cells. */}
          <th scope="row">
            <Link href={initiativeHref(r.id)}>{r.name}</Link>
          </th>
          <td>{r.memberCount}</td>
          {/* Zeros-omitted status distribution — the shared rendering, so no surface
              can disagree with another about one rollup (InitiativeDistribution). */}
          <td><InitiativeDistribution rollup={r.rollup} locale={locale} /></td>
          <td><DateCell value={r.targetDate} /></td>
        </tr>
      )}
    />
  );
}
