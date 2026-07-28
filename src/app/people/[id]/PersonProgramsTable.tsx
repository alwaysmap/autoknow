'use client';

import Link from 'next/link';
import DataTable from '../../../components/DataTable';
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
// involvement (#127 E11), resolved and dated in lib/personPrograms, which also owns
// the row type. A dash is a career gap on the anchor day: null is a real answer, and
// borrowing the nearest company would be the lie #124 exists to kill.

export default function PersonProgramsTable({ rows, locale }: { rows: PersonProgramRow[]; locale: Locale }) {
  return (
    <DataTable
      headers={[
        { key: 'name', label: t(locale, 'programLabel') },
        { key: 'roleSummary', label: t(locale, 'roleHeader') },
        { key: 'heldThenSummary', label: t(locale, 'affiliationHeader') },
        // A LIST of chips: sorting would order rows by an arbitrary member of it.
        { key: 'phases', label: t(locale, 'phasesCard'), sortable: false },
      ]}
      data={rows}
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
