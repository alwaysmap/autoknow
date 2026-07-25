import { listTemplates } from '../../lib/programTemplates';
import { resolvePeople } from '../../lib/personDirectory';
import { createTemplate } from '../actions/templates';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import PageShell from '../../components/PageShell';
import TemplatesClient from './TemplatesClient';
import styles from './page.module.css';

// Program template library (PHASE_TEMPLATES_PLAN §6): built-ins are clone-only;
// user templates are editable and deletable.

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const locale = await getLocale();
  const templates = await listTemplates();
  // `createdBy` is a bare string (schema: no Person relation), joined at read time so the
  // Origin column can say who, by name (#153).
  const creators = await resolvePeople(templates.map((tpl) => tpl.createdBy));

  return (
    <PageShell
      title={t(locale, 'programTemplates')}
      maxWidth="60rem"
      actions={
        <form action={createTemplate}>
          <button type="submit" className={styles.primaryBtn}>{t(locale, 'newTemplate')}</button>
        </form>
      }
    >
      <TemplatesClient
        templates={templates.map((tpl) => ({
          id: tpl.id,
          name: tpl.name,
          description: tpl.description,
          isBuiltIn: tpl.isBuiltIn,
          createdBy: tpl.createdBy,
          createdByPerson: (tpl.createdBy && creators[tpl.createdBy]) || null,
          phaseCount: tpl._count.phases,
        }))}
      />
    </PageShell>
  );
}
