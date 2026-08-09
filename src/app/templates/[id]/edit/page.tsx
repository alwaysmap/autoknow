import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../../lib/db';
import { getTemplateWithPhases } from '../../../../lib/programTemplates';
import TemplateEditor from '../../../../components/TemplateEditor';
import { initiativeHref } from '../../../../lib/entityHref';
import { getLocale } from '../../../../lib/locale';
import { tNodes } from '../../../../components/tNodes';

// Template authoring surface (PHASE_TEMPLATES_PLAN §6). Built-ins render read-only
// (clone-only); user templates get full phase CRUD with live DAG validation.

export const dynamic = 'force-dynamic';

export default async function TemplateEditPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const templateId = parseInt(id, 10);
  if (isNaN(templateId)) return notFound();

  const template = await getTemplateWithPhases(templateId);
  if (!template) return notFound();

  // An initiative's private snapshot is edited HERE, and only here — the banner says
  // what a save will do, because these steps govern every member copy (gh-286 hcz.13).
  const owner = await prisma.initiative.findUnique({
    where: { templateId },
    select: { id: true, name: true, _count: { select: { members: { where: { status: 'active' } } } } },
  });
  const locale = await getLocale();

  return (
    <>
      {owner && (
        <p
          style={{ margin: '1rem var(--page-gutter) 0', color: 'var(--muted)', fontSize: '0.875rem', lineHeight: '1.25rem' }}
          data-testid="initiative-steps-banner"
        >
          {tNodes(locale, 'templateBelongsToInitiative', {
            name: <Link href={initiativeHref(owner.id)}>{owner.name}</Link>,
            n: owner._count.members,
          })}
        </p>
      )}
      <TemplateEditor
      template={{
        id: template.id,
        name: template.name,
        description: template.description,
        isBuiltIn: template.isBuiltIn,
      }}
      phases={template.phases.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        googleFocus: p.googleFocus,
        leadRole: p.leadRole,
        durationWeeks: p.durationWeeks,
        isEndPhase: p.isEndPhase,
        sortOrder: p.sortOrder,
        dependsOn: p.dependsOn.map((d) => d.dependsOnId),
      }))}
      />
    </>
  );
}
