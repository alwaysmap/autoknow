'use client';

import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import { phaseColor, phaseDetailHref } from '../../../lib/phase';
import { t, Locale } from '../../../lib/i18n';
import styles from './page.module.css';

// The programs a person has worked on, on the shared DataTable and design.md §6's
// grammar (#125). Sibling of PersonHistoryTable — a CLIENT component for the same
// forced reason: DataTable takes `renderRow`, and a function prop cannot cross a
// Server Component boundary.
//
// Never paged: one person's involvement, capped by their record.
//
// TWO columns, not three. The TEL mark stays inside the identity cell rather than
// becoming a column of its own: it is an untranslated acronym badge qualifying the
// program name (it has no i18n key anywhere — the old markup wrote the literal), and
// a column would be blank on most rows. This step converts the FRAME; what the
// columns say is not being redesigned here.
//
// Phases is neither sortable nor filterable: it holds a LIST, so sorting would order
// rows by an arbitrary member of it, and a funnel over a handful of rows is the same
// noise as a pager that cannot act.

interface PersonProgramRow {
  id: number;
  name: string;
  /** True when this person is the program's TEL. */
  tel: boolean;
  phases: { id: number; name: string; role: string | null }[];
}

export default function PersonProgramsTable({ rows, locale }: { rows: PersonProgramRow[]; locale: Locale }) {
  return (
    <DataTable
      headers={[
        { key: 'name', label: t(locale, 'programLabel') },
        { key: 'phases', label: t(locale, 'phasesCard'), sortable: false },
      ]}
      data={rows}
      paginate={false}
      defaultSortKey="name"
      renderRow={(r: PersonProgramRow) => (
        <tr key={r.id}>
          <th scope="row">
            <Link href={`/programs/${r.id}`}>{r.name}</Link>
            {r.tel && <span className={styles.telMark}>TEL</span>}
          </th>
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
                  {ph.role && <span className={styles.phaseRole}>{ph.role}</span>}
                </Link>
              ))}
            </span>
          </td>
        </tr>
      )}
    />
  );
}
