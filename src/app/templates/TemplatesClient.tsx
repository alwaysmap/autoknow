'use client';

import Link from 'next/link';
import DataTable from '../../components/DataTable';
import { cloneTemplate, deleteTemplate } from '../actions/templates';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import styles from './page.module.css';

// The program template library, on the ONE shared DataTable (#29): sortable name/phase
// count, an Origin funnel (built-in vs a creator), the frozen `<th scope="row">` identity
// column, and the per-user rows-per-page density — the same grammar as every other listing.
// This is the /templates conversion #86/#87 deferred here ("adopt DataTable first, #29").

export interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  createdBy: string | null;
  phaseCount: number;
}

export default function TemplatesClient({ templates }: { templates: TemplateRow[] }) {
  const locale = useLocale();
  const originOf = (row: TemplateRow) => (row.isBuiltIn ? '__builtin__' : row.createdBy || '—');

  return (
    <DataTable
      headers={[
        { key: 'name', label: t(locale, 'templateLabel') },
        { key: 'phaseCount', label: t(locale, 'phasesCard') },
        {
          key: 'origin',
          label: t(locale, 'origin'),
          filterable: true,
          filterValue: (row) => originOf(row as TemplateRow),
          filterLabel: (v) => (v === '__builtin__' ? t(locale, 'builtIn') : v),
        },
        { key: 'actions', label: '', sortable: false },
      ]}
      data={templates}
      defaultSortKey="name"
      defaultSortOrder="asc"
      emptyStateMessage={t(locale, 'noResultsFound')}
      renderRow={(tpl: TemplateRow) => (
        <tr key={tpl.id} data-testid="template-row">
          <th scope="row">
            <Link href={`/templates/${tpl.id}/edit`} className={styles.nameLink}>{tpl.name}</Link>
            {tpl.description && <div className={styles.desc}>{tpl.description.split('\n')[0]}</div>}
          </th>
          <td className={styles.count}>{tpl.phaseCount}</td>
          <td>{tpl.isBuiltIn ? <span className={styles.builtinTag}>{t(locale, 'builtIn')}</span> : <span className={styles.by}>{tpl.createdBy}</span>}</td>
          <td className={styles.actions}>
            <form action={cloneTemplate} className={styles.inlineForm}>
              <input type="hidden" name="id" value={tpl.id} />
              <button type="submit" className={styles.miniBtn}>{t(locale, 'clone')}</button>
            </form>
            {!tpl.isBuiltIn && (
              <form action={deleteTemplate} className={styles.inlineForm}>
                <input type="hidden" name="id" value={tpl.id} />
                <button type="submit" className={styles.dangerBtn}>{t(locale, 'deleteLabel')}</button>
              </form>
            )}
          </td>
        </tr>
      )}
    />
  );
}
