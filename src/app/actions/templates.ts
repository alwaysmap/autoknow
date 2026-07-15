'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { getCurrentUser } from '../../lib/session';

// CRUD for program templates and their phase-templates (PHASE_TEMPLATES_PLAN §6).
// Built-ins are clone-only: every mutation refuses them. The DAG may pass through
// invalid intermediate states while authoring — the editor shows the validation
// banner live, and instantiation (projects/new) re-validates hard.

async function requireEditable(templateId: number) {
  const t = await prisma.programTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw new Error('Unknown template');
  if (t.isBuiltIn) throw new Error('Built-in templates are clone-only');
  return t;
}

export async function createTemplate() {
  const createdBy = (await getCurrentUser()).handle;
  const t = await prisma.programTemplate.create({
    data: { name: 'New template', createdBy },
  });
  revalidatePath('/templates');
  redirect(`/templates/${t.id}/edit`);
}

export async function cloneTemplate(formData: FormData) {
  const id = parseInt(formData.get('id') as string, 10);
  const source = await prisma.programTemplate.findUnique({
    where: { id },
    include: { phases: { orderBy: { sortOrder: 'asc' }, include: { dependsOn: true } } },
  });
  if (!source) throw new Error('Unknown template');

  const createdBy = (await getCurrentUser()).handle;
  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.programTemplate.create({
      data: { name: `${source.name} (copy)`, description: source.description, createdBy },
    });
    const idMap = new Map<number, number>();
    for (const p of source.phases) {
      const row = await tx.phaseTemplate.create({
        data: {
          templateId: created.id,
          name: p.name,
          description: p.description,
          googleFocus: p.googleFocus,
          leadRole: p.leadRole,
          durationWeeks: p.durationWeeks,
          isEndPhase: p.isEndPhase,
          sortOrder: p.sortOrder,
        },
      });
      idMap.set(p.id, row.id);
    }
    for (const p of source.phases) {
      for (const d of p.dependsOn) {
        await tx.phaseTemplateDep.create({
          data: { phaseTemplateId: idMap.get(p.id)!, dependsOnId: idMap.get(d.dependsOnId)! },
        });
      }
    }
    return created;
  });

  revalidatePath('/templates');
  redirect(`/templates/${copy.id}/edit`);
}

export async function deleteTemplate(formData: FormData) {
  const id = parseInt(formData.get('id') as string, 10);
  await requireEditable(id);
  await prisma.programTemplate.delete({ where: { id } }); // phases + deps cascade
  revalidatePath('/templates');
}

export async function updateTemplateMeta(formData: FormData) {
  const id = parseInt(formData.get('id') as string, 10);
  await requireEditable(id);
  const name = ((formData.get('name') as string) || '').trim();
  const description = ((formData.get('description') as string) || '').trim() || null;
  if (!name) throw new Error('Template name is required');
  await prisma.programTemplate.update({ where: { id }, data: { name, description } });
  revalidatePath('/templates');
  revalidatePath(`/templates/${id}/edit`);
}

function phaseFields(formData: FormData) {
  const name = ((formData.get('name') as string) || '').trim();
  if (!name) throw new Error('Phase name is required');
  const durationWeeks = Math.max(1, parseInt((formData.get('durationWeeks') as string) || '4', 10) || 4);
  return {
    name,
    description: ((formData.get('description') as string) || '').trim() || null,
    googleFocus: ((formData.get('googleFocus') as string) || '').trim() || null,
    leadRole: ((formData.get('leadRole') as string) || '').trim() || null,
    durationWeeks,
    isEndPhase: formData.get('isEndPhase') === 'on',
  };
}

const depIds = (formData: FormData) =>
  formData.getAll('dependsOn').map((v) => parseInt(v as string, 10)).filter((n) => !isNaN(n));

export async function addPhaseTemplate(formData: FormData) {
  const templateId = parseInt(formData.get('templateId') as string, 10);
  await requireEditable(templateId);
  const fields = phaseFields(formData);
  const max = await prisma.phaseTemplate.aggregate({ where: { templateId }, _max: { sortOrder: true } });
  await prisma.$transaction(async (tx) => {
    const row = await tx.phaseTemplate.create({
      data: { templateId, ...fields, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    for (const dep of depIds(formData)) {
      await tx.phaseTemplateDep.create({ data: { phaseTemplateId: row.id, dependsOnId: dep } });
    }
  });
  revalidatePath(`/templates/${templateId}/edit`);
}

export async function updatePhaseTemplate(formData: FormData) {
  const id = parseInt(formData.get('id') as string, 10);
  const existing = await prisma.phaseTemplate.findUnique({ where: { id } });
  if (!existing) throw new Error('Unknown phase');
  await requireEditable(existing.templateId);
  const fields = phaseFields(formData);
  await prisma.$transaction(async (tx) => {
    await tx.phaseTemplate.update({ where: { id }, data: fields });
    await tx.phaseTemplateDep.deleteMany({ where: { phaseTemplateId: id } });
    for (const dep of depIds(formData)) {
      if (dep !== id) await tx.phaseTemplateDep.create({ data: { phaseTemplateId: id, dependsOnId: dep } });
    }
  });
  revalidatePath(`/templates/${existing.templateId}/edit`);
}

export async function deletePhaseTemplate(formData: FormData) {
  const id = parseInt(formData.get('id') as string, 10);
  const existing = await prisma.phaseTemplate.findUnique({ where: { id } });
  if (!existing) return;
  await requireEditable(existing.templateId);
  await prisma.phaseTemplate.delete({ where: { id } }); // deps cascade both directions
  revalidatePath(`/templates/${existing.templateId}/edit`);
}

// ---- Whole-graph save (the shared PhaseDagEditor surface) ----
// The card-DAG editor edits the template's complete phase layout and submits it in
// one shot, exactly like a program's layout: validated as a whole (acyclic + single
// final node; isEndPhase is DERIVED as the unique sink) and applied atomically.
// Errors are RETURNED — the editor shows them inline.

export interface TemplatePhaseDraft {
  id: number; // real id, or negative = create
  name: string;
  weeks: number;
  leadRole: string | null;
  description: string | null;
  googleFocus: string | null;
  dependsOn: number[];
}

export async function saveTemplatePhases(formData: FormData): Promise<{ error?: string }> {
  const templateId = parseInt(formData.get('templateId') as string, 10);
  if (isNaN(templateId)) return { error: 'Invalid template' };
  try {
    await requireEditable(templateId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not editable' };
  }

  let draft: TemplatePhaseDraft[];
  try {
    draft = JSON.parse(formData.get('payload') as string);
  } catch {
    return { error: 'Malformed payload' };
  }
  if (!Array.isArray(draft) || draft.some((d) => typeof d.id !== 'number' || !d.name?.trim())) {
    return { error: 'Malformed payload' };
  }

  const { validateTemplateDag } = await import('../../lib/templateDag');
  const { deriveEndPhase } = await import('../../lib/programDag');
  const withEnd = deriveEndPhase(draft.map((d, i) => ({ id: d.id, name: d.name, sortOrder: i, dependsOn: d.dependsOn })));
  const validation = validateTemplateDag(
    withEnd.map((n) => ({ id: n.id, isEndPhase: n.isEndPhase, name: n.name })),
    draft.flatMap((d) => d.dependsOn.map((up) => ({ nodeId: d.id, dependsOnId: up }))),
  );
  if (!validation.ok) return { error: validation.errors.map((e) => e.message).join(' ') };
  const endIds = new Set(withEnd.filter((n) => n.isEndPhase).map((n) => n.id));

  const existing = await prisma.phaseTemplate.findMany({ where: { templateId }, select: { id: true } });
  const existingIds = new Set(existing.map((p) => p.id));
  const keptIds = draft.filter((d) => d.id > 0).map((d) => d.id);
  if (keptIds.some((id) => !existingIds.has(id))) return { error: 'Phase does not belong to this template' };
  const removedIds = [...existingIds].filter((id) => !keptIds.includes(id));

  await prisma.$transaction(async (tx) => {
    if (removedIds.length > 0) {
      await tx.phaseTemplate.deleteMany({ where: { id: { in: removedIds } } }); // deps cascade
    }
    const realId = new Map<number, number>();
    for (const [i, d] of draft.entries()) {
      const data = {
        name: d.name.trim(),
        durationWeeks: Math.max(1, Math.round(d.weeks)),
        leadRole: d.leadRole?.trim() || null,
        description: d.description?.trim() || null,
        googleFocus: d.googleFocus?.trim() || null,
        isEndPhase: endIds.has(d.id),
        sortOrder: i,
      };
      if (d.id > 0) {
        realId.set(d.id, d.id);
        await tx.phaseTemplate.update({ where: { id: d.id }, data });
      } else {
        const created = await tx.phaseTemplate.create({ data: { templateId, ...data } });
        realId.set(d.id, created.id);
      }
    }
    await tx.phaseTemplateDep.deleteMany({ where: { phaseTemplateId: { in: [...realId.values()] } } });
    for (const d of draft) {
      for (const up of d.dependsOn) {
        await tx.phaseTemplateDep.create({
          data: { phaseTemplateId: realId.get(d.id)!, dependsOnId: realId.get(up)! },
        });
      }
    }
  });

  revalidatePath('/templates');
  revalidatePath(`/templates/${templateId}/edit`);
  return {};
}
