'use client';

import { useState } from 'react';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import PageShell from '../../components/PageShell';
import { NewPersonButton } from '../../components/PersonEditor';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import styles from '../partners/page.module.css';

// The people directory — same table grammar as /partners (design.md §6): quiet
// links, per-column funnels (Company, Role), counts link into the person page.

interface PersonRow {
  id: number;
  name: string;
  email: string;
  companyId: number;
  company: string;
  role: string;
  programs: number;
}

export default function PeopleClient({ people, partners, initialFilters, initialSort, initialQ = '' }: {
  people: PersonRow[];
  partners: { id: number; name: string }[];
  initialFilters?: Record<string, string[]>;
  initialSort?: TableSort | null;
  /** Deep-linked key-column (name) filter text (?q=). */
  initialQ?: string;
}) {
  const locale = useLocale();
  const [filters, setFilters] = useState<Record<string, string[]>>(initialFilters ?? {});
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null);
  const [text, setText] = useState(initialQ);
  useTableUrlSync(filters, sort, { q: text || null });

  return (
    <PageShell
      title={t(locale, 'peopleLabel')}
      maxWidth="62.5rem"
      actions={<NewPersonButton partners={partners} />}
    >
      <section className={styles.tableSection}>
        <DataTable
            headers={[
              { key: 'name', label: t(locale, 'nameLabel') },
              { key: 'company', label: t(locale, 'companyLabel'), filterable: true, filterValue: (row) => (row as PersonRow).company || '—' },
              { key: 'role', label: t(locale, 'roleTitle'), filterable: true, filterValue: (row) => (row as PersonRow).role || '—' },
              { key: 'programs', label: t(locale, 'navPrograms') },
              { key: 'email', label: t(locale, 'emailHeader') },
            ]}
            data={people}
            renderRow={(p) => (
              <tr key={p.id}>
                <th scope="row">
                  <Link href={`/people/${p.id}`} className={styles.tableLink}>{p.name}</Link>
                </th>
                <td>
                  {/* Company is a NOUN — a specific partner — so it navigates to
                      its route, never filters (design.md §6, issue #30). No route
                      (no companyId) ⇒ plain text, per "No Plain-Text Dead Ends". */}
                  {p.companyId ? (
                    <Link href={`/partners/${p.companyId}`} className={styles.tableLink}>{p.company}</Link>
                  ) : (
                    <span className={styles.typeText}>{p.company || '—'}</span>
                  )}
                </td>
                <td>
                  {/* Role is a person's job title — FREEFORM text, not a class
                      people share, so it is plain muted text with no box and no
                      click-to-filter, matching the Company fallback above and the
                      detail page (design.md §6, box-vs-freeform). The column
                      header funnel still filters this column. */}
                  <span className={styles.typeText}>{p.role || '—'}</span>
                </td>
                <td>
                  {/* Bare count (§6, one measure per cell): the noun lives in the
                      accessible name, never announced as a context-free number. */}
                  <Link
                    href={`/people/${p.id}`}
                    className={styles.lifetimeProgramsLink}
                    aria-label={t(locale, p.programs === 1 ? 'programsCountAriaOne' : 'programsCountAria', { n: p.programs })}
                  >
                    {p.programs}
                  </Link>
                </td>
                <td>
                  <a href={`mailto:${p.email}`} className={styles.telLink}>{p.email}</a>
                </td>
              </tr>
            )}
            defaultSortKey={initialSort?.key ?? 'name'}
            defaultSortOrder={initialSort?.dir ?? 'asc'}
            onSortChange={(key, dir) => setSort({ key, dir })}
            filters={filters}
            onFiltersChange={setFilters}
            textFilter={text}
            onTextFilterChange={setText}
            textFilterPlaceholder={t(locale, 'filterPeoplePlaceholder')}
            emptyStateMessage={t(locale, 'noAssociatedPeople')}
          />
        </section>
    </PageShell>
  );
}
