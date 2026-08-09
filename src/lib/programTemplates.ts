// DB access for program templates: idempotent built-in seeding plus the fetch shapes
// the creation flow and authoring UI share. Server-only (imports prisma).

import { Prisma } from '@prisma/client';
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
    try {
      await seedOneTemplate(t);
    } catch (e) {
      // Two pages can call this concurrently (check-then-create): the
      // @@unique([name, isBuiltIn]) backstop means the loser lands here — the
      // template exists, which is all we wanted.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
      throw e;
    }
  }
}

async function seedOneTemplate(t: (typeof BUILTIN_TEMPLATES)[number]): Promise<void> {
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
    // Initiative snapshots are private per-initiative clones (gh-286): hidden from
    // every list/picker by the back-relation, not a flag that could drift from the FK.
    where: { initiative: null },
    orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { phases: true } } },
  });
}

export type NameSeries = (n: number) => string;

/**
 * First name in `series` not already taken by a user template. Moved here from
 * app/actions/templates.ts (gh-286 part c) so the initiative snapshot-clone shares it.
 *
 * `series` receives 1 for the first candidate, so the caller decides whether that reads
 * "X (copy)" or "New template" and only the LATER ones carry a number.
 *
 * Bounded by construction: the candidates are distinct, so one of the first `taken.size
 * + 1` of them must be free. Scoped to `isBuiltIn: false` because that is the half of
 * the unique key every row written through this lands on. Callers run it INSIDE their
 * write transaction so pick and write are one unit of work; the `@@unique([name,
 * isBuiltIn])` backstop still owns the concurrent case (see actions/templates.ts).
 */
export async function firstFreeTemplateName(
  db: Prisma.TransactionClient,
  series: NameSeries,
): Promise<string> {
  const rows = await db.programTemplate.findMany({
    where: { isBuiltIn: false },
    select: { name: true },
  });
  const taken = new Set(rows.map((r) => r.name));
  for (let n = 1; n <= taken.size + 1; n++) {
    const candidate = series(n);
    if (!taken.has(candidate)) return candidate;
  }
  // Unreachable while the candidates stay distinct — a `series` that ignores `n` would
  // land here rather than silently colliding at the database.
  throw new Error('Could not find a free template name');
}

/**
 * Deep-copy a template's phase graph into a new user template named by `series`,
 * inside the caller's transaction. The one clone mechanism for both callers: the
 * /templates "clone" button and the initiative snapshot (gh-286 part c) — a second
 * hand-rolled copy loop is how the two would drift (AGENTS lesson 7).
 */
export async function cloneTemplateGraph(
  tx: Prisma.TransactionClient,
  sourceId: number,
  series: NameSeries,
  createdBy: string | null,
): Promise<{ id: number }> {
  const source = await tx.programTemplate.findUnique({
    where: { id: sourceId },
    include: { phases: { orderBy: { sortOrder: 'asc' }, include: { dependsOn: true } } },
  });
  if (!source) throw new Error('Unknown template');
  const created = await tx.programTemplate.create({
    data: {
      name: await firstFreeTemplateName(tx, series),
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
  return { id: created.id };
}
