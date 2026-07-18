'use client';

import { useState } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
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

export default function PeopleClient({ people, initialFilters }: {
  people: PersonRow[];
  initialFilters?: Record<string, string[]>;
}) {
  const locale = useLocale();
  const [filters, setFilters] = useState<Record<string, string[]>>(initialFilters ?? {});

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{t(locale, 'peopleLabel')}</h1>
      </header>

      <main className={styles.main}>
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
                <td>
                  <Link href={`/people/${p.id}`} className={styles.tableLink}>{p.name}</Link>
                </td>
                <td>
                  <button
                    onClick={() => setFilters({ ...filters, company: [p.company || '—'] })}
                    className={styles.typeFilterBtn}
                    title={t(locale, 'filterColumn', { c: t(locale, 'companyLabel') })}
                  >
                    <span className={styles.typeText}>{p.company}</span>
                  </button>
                </td>
                <td><span className={styles.typeText}>{p.role || '—'}</span></td>
                <td>
                  <Link href={`/people/${p.id}`} className={styles.lifetimeProgramsLink}>{p.programs}</Link>
                </td>
                <td>
                  <a href={`mailto:${p.email}`} className={styles.telLink}>{p.email}</a>
                </td>
              </tr>
            )}
            defaultSortKey="name"
            filters={filters}
            onFiltersChange={setFilters}
            pageSize={15}
            emptyStateMessage={t(locale, 'noAssociatedPeople')}
          />
        </section>
      </main>
    </div>
  );
}
