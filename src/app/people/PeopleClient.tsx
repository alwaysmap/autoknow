'use client';

import { useState } from 'react';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import PageShell from '../../components/PageShell';
import { NewPersonButton } from '../../components/PersonEditor';
import PersonCell from '../../components/PersonCell';
import { personHref } from '../../lib/entityHref';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import styles from '../partners/page.module.css';

// The people directory — same table grammar as /partners (design.md §6): quiet
// links, per-column funnels (Company, Role), counts link into the person page.

interface PersonRow {
  id: number;
  name: string;
  email: string;
  /** One fact in two fields, and they are absent together: no affiliation period covers
   *  today (a gap, or a hire starting later) means `companyId === null` AND
   *  `company === ''`. The cell below relies on that — it tests the id and falls back on
   *  the name (#127 E5). */
  companyId: number | null;
  company: string;
  role: string;
  /** #243: TEL ownership and phase/action-item involvement are different claims about
   *  this person, counted separately so a row leading 5 and involved in 2 doesn't
   *  render as an undifferentiated 7 — the collapsed union that used to silently
   *  disagree with the person page's own Programs table. */
  programsLed: number;
  programsInvolved: number;
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
              { key: 'programsLed', label: t(locale, 'programsLedLabel') },
              { key: 'programsInvolved', label: t(locale, 'programsInvolvedLabel') },
              { key: 'email', label: t(locale, 'emailHeader') },
            ]}
            data={people}
            renderRow={(p) => (
              <tr key={p.id}>
                <th scope="row">
                  {/* The roster's own key column is still a person (#153) — it goes
                      through the shared cell like every other person in the app. */}
                  <PersonCell person={p} className={styles.tableLink} />
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
                      accessible name, never announced as a context-free number. Both
                      counts link to the same Programs section — the Connection column
                      there (#243) is where a reader sees WHICH programs made up each
                      number. */}
                  <Link
                    href={`${personHref(p.id)}#programs`}
                    className={styles.lifetimeProgramsLink}
                    aria-label={t(locale, p.programsLed === 1 ? 'programsLedAriaOne' : 'programsLedAria', { n: p.programsLed })}
                  >
                    {p.programsLed}
                  </Link>
                </td>
                <td>
                  <Link
                    href={`${personHref(p.id)}#programs`}
                    className={styles.lifetimeProgramsLink}
                    aria-label={t(locale, p.programsInvolved === 1 ? 'programsInvolvedAriaOne' : 'programsInvolvedAria', { n: p.programsInvolved })}
                  >
                    {p.programsInvolved}
                  </Link>
                </td>
                <td>
                  {/* The one deliberate email-as-label in the app (#153 acceptance 1):
                      this is an EMAIL column with a mailto:, not a person reference. */}
                  <a href={`mailto:${p.email}`} className={styles.emailLink}>{p.email}</a>
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
