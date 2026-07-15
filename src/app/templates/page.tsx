import Link from 'next/link';
import { listTemplates } from '../../lib/programTemplates';
import { createTemplate, cloneTemplate, deleteTemplate } from '../actions/templates';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import styles from './page.module.css';

// Program template library (PHASE_TEMPLATES_PLAN §6): built-ins are clone-only;
// user templates are editable and deletable.

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const locale = await getLocale();
  const templates = await listTemplates();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{t(locale, 'programTemplates')}</h1>
        <form action={createTemplate}>
          <button type="submit" className={styles.primaryBtn}>{t(locale, 'newTemplate')}</button>
        </form>
      </header>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t(locale, 'templateLabel')}</th>
            <th>{t(locale, 'phasesCard')}</th>
            <th>{t(locale, 'origin')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {templates.map((tpl) => (
            <tr key={tpl.id} data-testid="template-row">
              <td>
                <Link href={`/templates/${tpl.id}/edit`} className={styles.nameLink}>{tpl.name}</Link>
                {tpl.description && <div className={styles.desc}>{tpl.description.split('\n')[0]}</div>}
              </td>
              <td className={styles.count}>{tpl._count.phases}</td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
