import Link from 'next/link';
import { listTemplates } from '../../lib/programTemplates';
import { createTemplate, cloneTemplate, deleteTemplate } from '../actions/templates';
import styles from './page.module.css';

// Program template library (PHASE_TEMPLATES_PLAN §6): built-ins are clone-only;
// user templates are editable and deletable.

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const templates = await listTemplates();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Program templates</h1>
        <form action={createTemplate}>
          <button type="submit" className={styles.primaryBtn}>New template</button>
        </form>
      </header>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Template</th>
            <th>Phases</th>
            <th>Origin</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} data-testid="template-row">
              <td>
                <Link href={`/templates/${t.id}/edit`} className={styles.nameLink}>{t.name}</Link>
                {t.description && <div className={styles.desc}>{t.description.split('\n')[0]}</div>}
              </td>
              <td className={styles.count}>{t._count.phases}</td>
              <td>{t.isBuiltIn ? <span className={styles.builtinTag}>Built-in</span> : <span className={styles.by}>{t.createdBy}</span>}</td>
              <td className={styles.actions}>
                <form action={cloneTemplate} className={styles.inlineForm}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className={styles.miniBtn}>Clone</button>
                </form>
                {!t.isBuiltIn && (
                  <form action={deleteTemplate} className={styles.inlineForm}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className={styles.dangerBtn}>Delete</button>
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
