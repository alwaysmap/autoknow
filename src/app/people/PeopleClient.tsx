'use client';

import { useState } from 'react';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import ClassBox from '../../components/ClassBox';
import KebabMenu from '../../components/KebabMenu';
import OverlayDialog from '../../components/OverlayDialog';
import PageShell from '../../components/PageShell';
import { createPerson } from '../actions/people';
import dash from '../../components/ProjectStatusDashboard.module.css';
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
  const [saving, setSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  useTableUrlSync(filters, sort, { q: text || null });

  return (
    <PageShell
      title={t(locale, 'peopleLabel')}
      maxWidth="62.5rem"
      actions={
        <KebabMenu ariaLabel={t(locale, 'moreActions')}>
          <button type="button" data-testid="new-person" onClick={() => setNewOpen(true)}>
            {t(locale, 'newPerson')}
          </button>
        </KebabMenu>
      }
    >
      {/* Any login can create a Person; a Person needs no login of their own
          (partner-side contacts are the normal case). */}
      <OverlayDialog open={newOpen} onClose={() => setNewOpen(false)} width="30rem"
        title={t(locale, 'newPerson')} closeLabel={t(locale, 'close')}>
        <form
          action={async (formData) => {
            setSaving(true);
            // createPerson redirects to the new profile on success.
            try { await createPerson(formData); } finally { setSaving(false); }
          }}
          className={dash.dialogForm}
        >
          <div className={dash.textInputGroup}>
            <label htmlFor="npName" className={dash.formLabel}>{t(locale, 'nameLabel')}</label>
            <input id="npName" type="text" name="name" required className={dash.textInput} />
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="npEmail" className={dash.formLabel}>{t(locale, 'emailHeader')}</label>
            <input id="npEmail" type="email" name="email" required className={dash.textInput} />
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="npPartner" className={dash.formLabel}>{t(locale, 'newOrganization')}</label>
            <select id="npPartner" name="partnerId" required className={dash.textInput} defaultValue="">
              <option value="">{t(locale, 'selectPartner')}</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="npRole" className={dash.formLabel}>{t(locale, 'roleTitle')}</label>
            <input id="npRole" type="text" name="role" placeholder={t(locale, 'roleTitlePlaceholder')} className={dash.textInput} />
          </div>
          <div className={dash.actionRow}>
            <button type="button" onClick={() => setNewOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>

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
                  {/* Role is a CLASS people share — the box filters this column,
                      never navigates (design.md §6, issue #30). */}
                  <button
                    type="button"
                    onClick={() => setFilters({ ...filters, role: [p.role || '—'] })}
                    className={styles.typeFilterBtn}
                    title={t(locale, 'filterColumn', { c: t(locale, 'roleTitle') })}
                  >
                    <ClassBox className={styles.classInk}>{p.role || '—'}</ClassBox>
                  </button>
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
