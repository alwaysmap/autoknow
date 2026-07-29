'use client';

import { useState } from 'react';

import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import ClassBox from '../../../components/ClassBox';
import DateCell from '../../../components/DateCell';
import { phaseColor, phaseHref } from '../../../lib/phase';
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
// The Connection column carries HOW this person is attached to the program — leading
// it (TEL) or being named on it (a phase role / an action item) — as a first-class
// discriminator (#243), not a badge buried inside Role. A row can be BOTH, and shows
// both boxes: leadership and phase involvement are different claims from the DB
// (`Project.ownerPersonId` and `PhasePerson.role`/`ActionItem`), neither inferred from
// the other. The Role column now carries only the SPECIFIC per-phase role text — a
// row can lead a program with no per-phase role at all, which renders a dash (the
// Affiliation column's own dash convention below, restated here on purpose).
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
        // Not filterable: a row can carry BOTH kinds, and the funnel's OR semantics
        // are single-value-per-row (`PartnerPeopleTable`'s Status column pattern) —
        // same reason `phases` below stays unfilterable and sort-only via a summary.
        { key: 'connectionSummary', label: t(locale, 'connectionHeader') },
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
              {/* The acronym itself stays a literal (it's app vocabulary, unlocalized —
                  see roleSummary's sort-token convention); `telRole` only carries its
                  hover expansion. */}
              {r.connectionKinds.includes('leads') && (
                <ClassBox className={styles.leadBox} title={t(locale, 'telRole')}>TEL</ClassBox>
              )}
              {r.connectionKinds.includes('involved') && (
                <ClassBox className={styles.involvedBox} title={t(locale, 'involvedConnectionTitle')}>
                  {t(locale, 'involvedConnectionLabel')}
                </ClassBox>
              )}
            </span>
          </td>
          <td>
            <span className={styles.roleCell}>
              {r.roles.length > 0 && <span className={styles.phaseRole}>{r.roles.join(', ')}</span>}
              {/* WHY the row is here (#144 goal 3). The Connection column already says
                  leads/involved; this names the finer reason when Role would otherwise
                  be blank and nothing else on the row explains an involved-only row. */}
              {r.via.includes('action') && !r.via.includes('phase') && (
                <span className={styles.phaseRole}>{t(locale, 'viaActionItem')}</span>
              )}
              {r.roles.length === 0 && !(r.via.includes('action') && !r.via.includes('phase')) && (
                <span className={styles.phaseRole}>—</span>
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
                  href={phaseHref(r.id, ph.id)}
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
