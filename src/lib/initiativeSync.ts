// Initiative template propagation (gh-286, bead hcz.13; owner call 2026-08-08: every
// member's copy carries the SAME steps, and only the initiative-level edit changes
// them). Called by saveTemplatePhases inside ITS transaction whenever the template
// being saved is an initiative's snapshot: each ACTIVE copy is re-shaped to the new
// step graph. Server-only (Prisma transaction client).
//
// The matching key is Phase.sourcePhaseTemplateId — provenance written at
// instantiation — so a RENAMED step finds its copy phase and keeps its progress and
// history; name-matching could not promise that. Semantics per copy:
//  - kept step: name/duration/description/googleFocus/isEndPhase overwritten (copies
//    cannot be edited structurally, so nothing per-copy is lost), leadPartner
//    re-resolved the way the creator resolves it;
//  - removed step: the copy phase and its records go, context DETACHED not deleted —
//    the same recipe saveProgramPhases uses for a program's own edit;
//  - added step: created at zero progress with an initial state row; no seed action
//    item (that is a creation-time nicety, not a step property);
//  - dependencies: rebuilt wholesale from the template's edges.
// Complete and cancelled copies are left exactly as they are: they are history, and
// rewriting a finished graph to match a later definition would falsify it.

import type { Prisma } from '@prisma/client';
import { hillStatus } from './phase';
import { deletePhasesWithRecords } from './phaseDeletion';
import { leadPartnerForRole } from './createProgramFromTemplate';

/** Re-shape every ACTIVE copy of `initiativeId` to its snapshot's current step graph.
 *  Caller owns the transaction (saveTemplatePhases runs this inside its own); throws
 *  if the initiative is gone. */
export async function syncInitiativeCopies(
  tx: Prisma.TransactionClient,
  initiativeId: number,
): Promise<void> {
  const initiative = await tx.initiative.findUniqueOrThrow({
    where: { id: initiativeId },
    include: {
      template: {
        include: { phases: { orderBy: { sortOrder: 'asc' }, include: { dependsOn: true } } },
      },
    },
  });
  const steps = initiative.template.phases;

  const copies = await tx.project.findMany({
    where: { initiativeId, lifecycle: 'active', isArchived: false },
    include: {
      partner: { include: { type: true } },
      phases: { select: { id: true, name: true, sourcePhaseTemplateId: true } },
    },
  });

  for (const copy of copies) {
    const byProvenance = new Map(
      copy.phases.filter((p) => p.sourcePhaseTemplateId != null).map((p) => [p.sourcePhaseTemplateId!, p]),
    );
    // Legacy copies (pre-provenance) fall back to name ONCE; the update below then
    // stamps the id so the next edit matches by id.
    const byName = new Map(copy.phases.map((p) => [p.name, p]));

    const phaseIdByStep = new Map<number, number>();
    const matchedCopyPhaseIds = new Set<number>();

    for (const step of steps) {
      const data = {
        name: step.name,
        forecastedDuration: step.durationWeeks * 7, // templates store weeks; runtime stays days
        description: step.description,
        googleFocus: step.googleFocus,
        isEndPhase: step.isEndPhase,
        leadPartnerId: leadPartnerForRole(step.leadRole, copy.partner),
        sourcePhaseTemplateId: step.id,
      };
      // The matched-set guard keeps two steps from claiming ONE legacy phase through
      // the name fallback (e.g. a step renamed to another step's old name).
      const existing = byProvenance.get(step.id) ?? byName.get(step.name);
      if (existing && !matchedCopyPhaseIds.has(existing.id)) {
        matchedCopyPhaseIds.add(existing.id);
        phaseIdByStep.set(step.id, existing.id);
        await tx.phase.update({ where: { id: existing.id }, data });
      } else {
        const created = await tx.phase.create({ data: { ...data, projectId: copy.id } });
        phaseIdByStep.set(step.id, created.id);
        await tx.phaseState.create({
          data: { phaseId: created.id, status: hillStatus(0), hillChartProgress: 0, theNeedle: 'On Track' },
        });
      }
    }

    await deletePhasesWithRecords(
      tx,
      copy.phases.filter((p) => !matchedCopyPhaseIds.has(p.id)).map((p) => p.id),
    );

    await tx.phaseDependency.deleteMany({ where: { phaseId: { in: [...phaseIdByStep.values()] } } });
    for (const step of steps) {
      for (const dep of step.dependsOn) {
        const from = phaseIdByStep.get(step.id);
        const to = phaseIdByStep.get(dep.dependsOnId);
        if (from != null && to != null) {
          await tx.phaseDependency.create({ data: { phaseId: from, dependsOnPhaseId: to } });
        }
      }
    }
  }
}
