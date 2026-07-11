import { notFound } from 'next/navigation';
import { getTemplateWithPhases } from '../../../../lib/programTemplates';
import TemplateEditor from '../../../../components/TemplateEditor';

// Template authoring surface (PHASE_TEMPLATES_PLAN §6). Built-ins render read-only
// (clone-only); user templates get full phase CRUD with live DAG validation.

export const dynamic = 'force-dynamic';

export default async function TemplateEditPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const templateId = parseInt(id, 10);
  if (isNaN(templateId)) return notFound();

  const template = await getTemplateWithPhases(templateId);
  if (!template) return notFound();

  return (
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
  );
}
