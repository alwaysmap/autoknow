// DB access for program templates: idempotent built-in seeding plus the fetch shapes
// the creation flow and authoring UI share. Server-only (imports prisma).

import { prisma } from './db';
import { BUILTIN_TEMPLATES } from './builtinTemplates';

/**
 * Write the BUILTIN_TEMPLATES constant into the ProgramTemplate tables (once per
 * template name). Idempotent and cheap when everything exists — safe to call from
 * the pages that need templates present.
 */
export async function ensureBuiltinTemplates(): Promise<void> {
  const existing = await prisma.programTemplate.findMany({
    where: { isBuiltIn: true },
    select: { name: true },
  });
  const have = new Set(existing.map((t) => t.name));

  for (const t of BUILTIN_TEMPLATES) {
    if (have.has(t.name)) continue;
    await prisma.$transaction(async (tx) => {
      const created = await tx.programTemplate.create({
        data: { name: t.name, description: t.description, isBuiltIn: true },
      });
      const idByKey = new Map<string, number>();
      for (const [i, p] of t.phases.entries()) {
        const row = await tx.phaseTemplate.create({
          data: {
            templateId: created.id,
            name: p.name,
            description: p.description,
            googleFocus: p.googleFocus,
            leadRole: p.leadRole,
            durationWeeks: p.durationWeeks,
            isEndPhase: !!p.isEndPhase,
            sortOrder: i,
          },
        });
        idByKey.set(p.key, row.id);
      }
      for (const p of t.phases) {
        for (const dep of p.dependsOn) {
          await tx.phaseTemplateDep.create({
            data: { phaseTemplateId: idByKey.get(p.key)!, dependsOnId: idByKey.get(dep)! },
          });
        }
      }
    });
  }
}

/** A template with its phases (sorted) and dependency edges — the shape both the
 *  creation flow and the editor consume. */
export async function getTemplateWithPhases(id: number) {
  return prisma.programTemplate.findUnique({
    where: { id },
    include: {
      phases: { orderBy: { sortOrder: 'asc' }, include: { dependsOn: true } },
    },
  });
}

export async function listTemplates() {
  await ensureBuiltinTemplates();
  return prisma.programTemplate.findMany({
    orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { phases: true } } },
  });
}
