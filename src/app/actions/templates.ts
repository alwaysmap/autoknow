'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
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

/**
 * The first name in a numbered series that no user template already holds.
 *
 * `ProgramTemplate` is `@@unique([name, isBuiltIn])`, and both writers below used to
 * name their row with a CONSTANT — `"${source.name} (copy)"` and `'New template'`. So the
 * second clone of any template, and the second unnamed template, threw P2002 out of a
 * server action, which fails before its `redirect`: the user stayed on /templates with a
 * generic error, no new template, and nothing to do about it (AGENTS lesson 5). Both had
 * this shape, so both call this — fixing one would have left the same bug wearing the
 * other name (AGENTS lesson 7).
 *
 * `format` receives 1 for the first candidate, so a caller decides whether that reads
 * "X (copy)" or "New template" and only the LATER ones carry a number.
 *
 * Bounded by construction: the candidates are distinct, so one of the first `taken.size
 * + 1` of them must be free. Scoped to `isBuiltIn: false` because that is the half of
 * the unique key every row written here lands on.
 */
async function firstFreeTemplateName(
  tx: Prisma.TransactionClient,
  format: (n: number) => string,
): Promise<string> {
  const rows = await tx.programTemplate.findMany({
    where: { isBuiltIn: false },
    select: { name: true },
  });
  const taken = new Set(rows.map((r) => r.name));
  for (let n = 1; n <= taken.size + 1; n++) {
    const candidate = format(n);
    if (!taken.has(candidate)) return candidate;
  }
  // Unreachable while the candidates stay distinct — a `format` that ignores `n` would
  // land here rather than silently colliding at the database.
  throw new Error('Could not find a free template name');
}

/** "X (copy)", then "X (copy 2)" — the number rides INSIDE the parenthesis so the copy
 *  marker stays one token. Applied to the source's whole name, so cloning something
 *  already called "X (copy)" yields "X (copy) (copy)": repetitive, but it never silently
 *  re-points the reader at a different lineage than the one they cloned. */
const copyName = (sourceName: string) => (n: number) =>
  n === 1 ? `${sourceName} (copy)` : `${sourceName} (copy ${n})`;

/** "New template", then "New template 2" — no parenthesis to sit inside, so the number
 *  trails. A fresh template is named by its author moments later; this only has to be
 *  free and obviously provisional. */
const newTemplateName = (n: number) => (n === 1 ? 'New template' : `New template ${n}`);

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
  const source = await prisma.programTemplate.findUnique({
    where: { id },
    include: { phases: { orderBy: { sortOrder: 'asc' }, include: { dependsOn: true } } },
  });
  if (!source) throw new Error('Unknown template');

  const createdBy = (await getCurrentUser()).handle;
  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.programTemplate.create({
      // Inside the transaction, so the read that picks the name and the write that takes
      // it cannot be separated by another clone committing between them.
      data: {
        name: await firstFreeTemplateName(tx, copyName(source.name)),
        description: source.description,
        createdBy,
      },
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
