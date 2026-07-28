'use client';

import { useState } from 'react';

import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import ClassBox from '../../../components/ClassBox';
import DateCell from '../../../components/DateCell';
import { phaseColor, phaseDetailHref } from '../../../lib/phase';
import type { PersonProgramRow } from '../../../lib/personPrograms';
import { t, Locale } from '../../../lib/i18n';
import styles from './page.module.css';

// The programs a person has worked on, on the shared DataTable and design.md §6's
// grammar (#125). Sibling of PersonHistoryTable — a CLIENT component for the same
// forced reason: DataTable takes `renderRow`, and a function prop cannot cross a
// Server Component boundary.
//
// Never paged: one person's involvement, capped by their record.
//
// The Role column carries HOW this person is attached to the program, which is the
// thing the chips could not say: TEL ownership, and any per-phase role. Both come
// from the DB (`Project.ownerPersonId` and `PhasePerson.role`); neither is inferred.
// The Affiliation column carries WHO THEY WERE at the time — the job held during the
// involvement (#127 E11) — and Status/To carry WHETHER the connection is still live and
// when it ended (#144). All three are resolved and dated in lib/personPrograms, which
// also owns the row type. A dash is a career gap on the anchor day: null is a real answer, and
// borrowing the nearest company would be the lie #124 exists to kill.

export default function PersonProgramsTable({ rows, locale }: { rows: PersonProgramRow[]; locale: Locale }) {
  // Controlled so a Status cell CLICK sets its column's filter — design.md §6: a class
  // filters its own column on click, and an inert ClassBox is a bug. Unfiltered by
  // default, unlike the partner roster: a person's history is the point of this table,
  // so hiding the ended rows would hide what #144 added.
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  return (
    <DataTable
      headers={[
        { key: 'name', label: t(locale, 'programLabel') },
        { key: 'roleSummary', label: t(locale, 'roleHeader') },
        { key: 'heldThenSummary', label: t(locale, 'affiliationHeader') },
        // A CLASS, so it is a filterable ClassBox and never navigates (design.md §6).
        // This is #144's headline: a role held two years ago used to render exactly like
        // one held now, and no column said which.
        {
          key: 'status',
          label: t(locale, 'statusLabel'),
          filterable: true,
          filterLabel: (v) => t(locale, v === 'ended' ? 'connectionEnded' : 'connectionLive'),
        },
        { key: 'endedOn', label: t(locale, 'toLabel'), sortType: 'date' },
        // A LIST of chips: sorting would order rows by an arbitrary member of it.
        { key: 'phases', label: t(locale, 'phasesCard'), sortable: false },
      ]}
      data={rows}
      filters={filters}
      onFiltersChange={setFilters}
      paginate={false}
      defaultSortKey="name"
      renderRow={(r: PersonProgramRow) => (
        <tr key={r.id}>
          <th scope="row">
            <Link href={`/programs/${r.id}`}>{r.name}</Link>
          </th>
          <td>
            <span className={styles.roleCell}>
              {/* The acronym stays visible; `telRole` carries its expansion, so the
                  string is configurable rather than a literal in the markup. */}
              {r.tel && <span className={styles.telMark} title={t(locale, 'telRole')}>TEL</span>}
              {r.roles.length > 0 && <span className={styles.phaseRole}>{r.roles.join(', ')}</span>}
              {/* WHY the row is here (#144 goal 3). The TEL badge already says one of the
                  three; this names the other two, which nothing on the row said before. */}
              {r.via.includes('action') && !r.via.includes('phase') && (
                <span className={styles.phaseRole}>{t(locale, 'viaActionItem')}</span>
              )}
            </span>
          </td>
          <td>
            {r.heldThen ? (
              <span className={styles.roleCell}>
                <Link href={`/partners/${r.heldThen.partnerId}`}>{r.heldThen.partnerName}</Link>
                {r.heldThen.role && <span className={styles.phaseRole}>{r.heldThen.role}</span>}
              </span>
            ) : (
              /* A career gap on the involvement's day — an empty cell would read as
                 "not rendered"; the dash says "no employer then", on purpose. */
              <span className={styles.phaseRole}>—</span>
            )}
          </td>
          <td>
            <button
              type="button"
              onClick={() => setFilters({ ...filters, status: [r.status] })}
              className={styles.statusFilterBtn}
              title={t(locale, 'filterColumn', { c: t(locale, 'statusLabel') })}
            >
              <ClassBox className={styles.classInk}>
                {t(locale, r.status === 'ended' ? 'connectionEnded' : 'connectionLive')}
              </ClassBox>
            </button>
          </td>
          {/* The "until" a reader needs to place an ended connection; blank while live,
              because a live one has no end and an invented one would be the lie. */}
          <td><DateCell value={r.endedOn} /></td>
          <td>
            <span className={styles.phaseChips}>
              {r.phases.map((ph) => (
                <Link
                  key={ph.id}
                  href={phaseDetailHref(r.id, ph.id)}
                  className={styles.phaseChip}
                  title={ph.role ? `${ph.name} · ${ph.role}` : ph.name}
                >
                  <span className={styles.phaseDot} style={{ background: phaseColor(ph.id) }} />
                  {ph.name}
                </Link>
              ))}
            </span>
          </td>
        </tr>
      )}
    />
  );
}
