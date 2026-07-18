'use client';

import { useState, useRef } from 'react';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import KebabMenu from '../../components/KebabMenu';
import { createPerson } from '../actions/people';
import dash from '../../components/ProjectStatusDashboard.module.css';
import admin from '../../components/ProjectAdminControls.module.css';
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

export default function PeopleClient({ people, partners, initialFilters, initialSort }: {
  people: PersonRow[];
  partners: { id: number; name: string }[];
  initialFilters?: Record<string, string[]>;
  initialSort?: TableSort | null;
}) {
  const locale = useLocale();
  const [filters, setFilters] = useState<Record<string, string[]>>(initialFilters ?? {});
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null);
  const [saving, setSaving] = useState(false);
  const newRef = useRef<HTMLDialogElement>(null);
  useTableUrlSync(filters, sort);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{t(locale, 'peopleLabel')}</h1>
        <KebabMenu ariaLabel={t(locale, 'moreActions')}>
          <button type="button" data-testid="new-person" onClick={() => newRef.current?.showModal()}>
            {t(locale, 'newPerson')}
          </button>
        </KebabMenu>
      </header>

      {/* Any login can create a Person; a Person needs no login of their own
          (partner-side contacts are the normal case). */}
      <dialog ref={newRef} closedby="any" className={admin.dialog} aria-labelledby="newPersonTitle"
        onClick={(e) => { if (e.target === newRef.current) newRef.current?.close(); }}>
        <div className={admin.dialogHeader}><h3 id="newPersonTitle">{t(locale, 'newPerson')}</h3></div>
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
            <button type="button" onClick={() => newRef.current?.close()} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </dialog>

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
            defaultSortKey={initialSort?.key ?? 'name'}
            defaultSortOrder={initialSort?.dir ?? 'asc'}
            onSortChange={(key, dir) => setSort({ key, dir })}
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
