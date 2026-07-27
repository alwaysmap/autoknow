'use client';

import { useState } from 'react';
import DataTable from '../../../components/DataTable';
import DateCell from '../../../components/DateCell';
import ClassBox from '../../../components/ClassBox';
import PersonCell from '../../../components/PersonCell';
import type { RosterBucket } from '../../../lib/profiles';
import { t, type Locale, type StringKey } from '../../../lib/i18n';
import styles from './page.module.css';

// The partner's people, on the shared DataTable and design.md §6's grammar (#127 E12,
// spec #124 §7 "Partner People list").
//
// What it replaced was a hand-rolled `div` list of `where: { endDate: null }` rows: it
// ignored `startDate`, so a future-dated hire read as a current employee, and a departed
// person could not be shown at all. The three buckets come from `partnerRosterAsOf`
// (lib/profiles) and arrive already decided — this component classifies nothing, which is
// the point of the resolver owning the interval test.
//
// A CLIENT component because DataTable takes `renderRow`, and a function prop cannot
// cross a Server Component boundary — the partner page is `async`. Every other DataTable
// host is a client component for the same reason.
//
// Paged, unlike its two siblings on /people/:id: a person's employment history is capped
// by their life, but a partner's roster is not capped by anything, and the past bucket
// only ever grows (#125 decision B — `paginate={false}` is a claim about the SOURCE).

export interface PartnerPersonRow {
  /** The AFFILIATION id: a person who did two stints here is two rows, honestly. */
  id: number;
  personId: number;
  name: string;
  role: string;
  /** The bucket the RESOLVER put this affiliation in — a type-only import, which is
   *  erased, so naming a `server-only` module here pulls nothing into the client bundle
   *  (KindBox and SummaryPanel do the same). A local copy of the union would be one more
   *  thing to keep in lockstep with nothing linking the two. */
  status: RosterBucket;
  /** ISO. The **from** date §4 asks for on an incoming row, and the start of the stint
   *  on the other two. */
  startDate: string;
  /** ISO, or null on an open period. The **until** date §4 asks for on a past row. */
  endDate: string | null;
}

/** Canonical token → localized label, the shape /programs' `SOP_OUTLOOK_KEY` uses for the
 *  same job. A lookup over the closed set rather than a ternary chain, so a fourth bucket
 *  fails to typecheck here instead of quietly rendering as "Current".
 *
 *  The FILTER's value stays the token: a locale-stable shareable token whose name is read
 *  only in `filterLabel`, so the funnel and the cells agree without the URL changing
 *  meaning per language (design.md §6). */
const ROSTER_STATUS_KEY: Record<RosterBucket, StringKey> = {
  current: 'rosterStatusCurrent',
  past: 'rosterStatusPast',
  incoming: 'rosterStatusIncoming',
};

export default function PartnerPeopleTable({ rows, locale }: {
  rows: PartnerPersonRow[];
  locale: Locale;
}) {
  // Controlled so a Status cell click can set the column's filter — a CLASS filters its
  // own column and never navigates (design.md §6). It starts on bucket (a), which is what
  // the page's headline employee figure counts: the list under a number should be the
  // list that number describes, and the funnel is how you look past it.
  const [filters, setFilters] = useState<Record<string, string[]>>({ status: ['current'] });

  return (
    <DataTable
      headers={[
        { key: 'name', label: t(locale, 'personLabel') },
        // `roleTitle`, the same key PersonHistoryTable's Role column uses — the two tables
        // render the same `PersonAffiliation.role` and now sit one click apart.
        { key: 'role', label: t(locale, 'roleTitle') },
        {
          key: 'status',
          label: t(locale, 'statusLabel'),
          filterable: true,
          filterLabel: (v) => t(locale, ROSTER_STATUS_KEY[v as RosterBucket]),
        },
        { key: 'startDate', label: t(locale, 'fromLabel'), sortType: 'date' },
        { key: 'endDate', label: t(locale, 'toLabel'), sortType: 'date' },
      ]}
      data={rows}
      defaultSortKey="name"
      filters={filters}
      onFiltersChange={setFilters}
      emptyStateMessage={t(locale, 'noAssociatedPeople')}
      renderRow={(r: PartnerPersonRow) => (
        <tr key={r.id}>
          <th scope="row">
            <PersonCell person={{ id: r.personId, name: r.name }} />
          </th>
          <td>{r.role}</td>
          <td>
            <button
              type="button"
              onClick={() => setFilters({ ...filters, status: [r.status] })}
              className={styles.statusFilterBtn}
              title={t(locale, 'filterColumn', { c: t(locale, 'statusLabel') })}
            >
              <ClassBox className={styles.classInk}>{t(locale, ROSTER_STATUS_KEY[r.status])}</ClassBox>
            </button>
          </td>
          <td><DateCell value={r.startDate} /></td>
          <td>
            {/* An open period means two different things and the bucket is what tells
                them apart: someone who works here has no leaving date yet ("Present"),
                while someone who has not arrived has no leaving date AT ALL — printing
                "Present" against a hire who starts in November would state the opposite
                of what the row says. This is the distinction PersonHistoryTable's own
                comment records that it cannot make; here the status is in hand. */}
            <DateCell
              value={r.endDate}
              fallback={r.status === 'current' ? t(locale, 'present') : '—'}
            />
          </td>
        </tr>
      )}
    />
  );
}
