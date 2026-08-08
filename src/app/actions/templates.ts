'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { getCurrentUser } from '../../lib/session';
import { firstFreeTemplateName, cloneTemplateGraph, type NameSeries } from '../../lib/programTemplates';

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

// NameSeries + firstFreeTemplateName moved to lib/programTemplates (gh-286 part c)
// so the initiative snapshot-clone shares them; the naming POLICY (the series) stays here.

/** "X (copy)", then "X (copy 2)" — the number rides INSIDE the parenthesis so the copy
 *  marker stays one token. Applied to the source's whole name, so cloning something
 *  already called "X (copy)" yields "X (copy) (copy)": repetitive, but it never silently
 *  re-points the reader at a different lineage than the one they cloned. */
const copyName = (sourceName: string): NameSeries => (n) =>
  n === 1 ? `${sourceName} (copy)` : `${sourceName} (copy ${n})`;

/** "New template", then "New template 2" — no parenthesis to sit inside, so the number
 *  trails. A fresh template is named by its author moments later; this only has to be
 *  free and obviously provisional. */
const newTemplateName: NameSeries = (n) => (n === 1 ? 'New template' : `New template ${n}`);

export async function createTemplate() {
  const createdBy = (await getCurrentUser()).handle;
  const t = await prisma.programTemplate.create({
    data: { name: await firstFreeTemplateName(prisma, newTemplateName), createdBy },
  });
  revalidatePath('/templates');
  redirect(`/templates/${t.id}/edit`);
}

export async function cloneTemplate(formData: FormData) {
  const id = parseInt(formData.get('id') as string, 10);
  const createdBy = (await getCurrentUser()).handle;
  // The name pick runs inside the transaction so it and the phase copy are one unit of
  // work — NOT because that serializes it. This `$transaction` takes no `isolationLevel`,
  // so it runs at READ COMMITTED and a concurrent clone may still commit between that read
  // and its write; `@@unique([name, isBuiltIn])` is what stops that becoming a duplicate,
  // exactly as `prisma/schema.prisma` describes it. Two people cloning the same template
  // in the same instant can still see the P2002 — the sequential case this fixes is the
  // one that was reachable by one person clicking twice. Making the race impossible is
  // `dependencies.ts`'s explicit Serializable isolation, which costs retry handling this
  // does not need.
  const source = await prisma.programTemplate.findUnique({ where: { id }, select: { name: true } });
  if (!source) throw new Error('Unknown template');
  const copy = await prisma.$transaction((tx) => cloneTemplateGraph(tx, id, copyName(source.name), createdBy));

  revalidatePath('/templates');
  redirect(`/templates/${copy.id}/edit`);
}

export async function deleteTemplate(formData: FormData) {
  const id = parseInt(formData.get('id') as string, 10);
  await requireEditable(id);
  await prisma.programTemplate.delete({ where: { id } }); // phases + deps cascade
  revalidatePath('/templates');
}

/** DELIBERATELY does not route through `firstFreeTemplateName` (unlike the two
 *  constant-name writers above): a name the user typed should come back as a validation
 *  message naming the conflict, never be silently renumbered into something they did not
 *  ask to save. That message does not exist yet — a clash still throws a raw P2002 out
 *  of the server action, before its revalidate (autoknow-6ls). */
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
