// The ONE recipe for deleting copy/program phases with their records (extracted from
// saveProgramPhases when lib/initiativeSync grew a byte-identical copy — AGENTS
// lesson 7). Its own server module, NOT lib/phase.ts: that file is pure and
// client-shared, and this one needs the Prisma transaction client.

import type { Prisma } from '@prisma/client';

/** Delete phases and everything that references them. Context is DETACHED, not
 *  deleted — the digest may matter to the project/partner. Caller owns the
 *  transaction; dependency edges in BOTH directions go with the phases. */
export async function deletePhasesWithRecords(
  tx: Prisma.TransactionClient,
  phaseIds: number[],
): Promise<void> {
  if (phaseIds.length === 0) return;
  await tx.actionItem.deleteMany({ where: { phaseId: { in: phaseIds } } });
  await tx.phaseState.deleteMany({ where: { phaseId: { in: phaseIds } } });
  await tx.phasePartner.deleteMany({ where: { phaseId: { in: phaseIds } } });
  await tx.phasePerson.deleteMany({ where: { phaseId: { in: phaseIds } } });
  await tx.contextUrl.updateMany({ where: { phaseId: { in: phaseIds } }, data: { phaseId: null } });
  await tx.phaseDependency.deleteMany({
    where: { OR: [{ phaseId: { in: phaseIds } }, { dependsOnPhaseId: { in: phaseIds } }] },
  });
  await tx.phase.deleteMany({ where: { id: { in: phaseIds } } });
}
