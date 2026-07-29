// Shared test fixtures. Everything goes through tests/helpers/db (the *_test database).

import { prisma } from './db';

/**
 * Wipe the TEST database — EVERY model, in FK-safe child→parent order.
 *
 * "Every" is the contract, not an aspiration: `tests/wipeAllCoverage.test.ts` reads the
 * model list out of prisma/schema.prisma and fails when one of them is missing here, so
 * a new model cannot be added without a decision about this function (AGENTS lesson 2).
 *
 * There are no exceptions, because a table this skips is state that survives the wipe and
 * therefore leaks between runs — which is how the suite gets a bug that only appears the
 * SECOND time you run it. Two have been paid for already:
 *
 *  - SkippedSource has no FKs, but it IS shared-DB state; omitting it is what pushed
 *    driveSync.test.ts to hand-roll its own wipe and lose the FK-safe ordering below
 *    (AGENTS lesson 9 flake).
 *  - ProgramTemplate was skipped as "reference data", so the clones made by
 *    phase_screenshots.spec.ts accumulated, and the second run of the `screens` e2e
 *    project died on `@@unique([name, isBuiltIn])` — `Digital Key (copy)` already
 *    existed, so cloneTemplate threw P2002 and never redirected (autoknow-93a).
 *
 * Nothing here needs to survive: the reference rows are all recreated on demand.
 * Region/PartnerType are `connectOrCreate`d by the fixtures and specs that need them,
 * the built-in templates by `ensureBuiltinTemplates()` on every /templates and
 * /programs/new render, and the two singletons (IngestionSettings,
 * IngestionCycleSummary) are upserted by their own writers.
 *
 * src/lib/seed.ts's `wipeAllData` is a SEPARATE and narrower list of the same shape,
 * and the ratchet guards only THIS one. It spares the three template tables, plus
 * SkippedSource and the two ingestion singletons — state somebody looking at a reseeded
 * demo database may still want. So do not "align" the two on sight: this is the total
 * wipe of a disposable database, and that one is a reseed of a database with a reader.
 */
export async function wipeAll() {
  // Standalone tables (no FKs in either direction) — order is irrelevant.
  await prisma.skippedSource.deleteMany();
  await prisma.ingestionCycleSummary.deleteMany();
  await prisma.ingestionSettings.deleteMany();
  await prisma.summaryPrompt.deleteMany();
  await prisma.summary.deleteMany();
  await prisma.syncCursor.deleteMany();
  // #127 E15's not-a-person suppressions. Standalone by design — it records a decision
  // about an address NO row holds, which is the whole reason it is its own table.
  await prisma.ignoredAddress.deleteMany();
  // Program graph, child → parent.
  await prisma.actionItem.deleteMany();
  // Escalations (#245) precede every table they reference — ContextUrl, Project, Partner
  // and Person, all of which are deleted below. The self-FK needs no ordering: one
  // `DELETE FROM` clears the table in a single statement.
  await prisma.escalation.deleteMany();
  await prisma.contextRevision.deleteMany();
  await prisma.contextUrl.deleteMany();
  await prisma.phasePartner.deleteMany();
  await prisma.phasePerson.deleteMany();
  await prisma.phaseState.deleteMany();
  await prisma.phaseDependency.deleteMany();
  await prisma.phase.deleteMany();
  await prisma.projectState.deleteMany();
  await prisma.partnerState.deleteMany();
  await prisma.project.deleteMany();
  await prisma.personAffiliation.deleteMany();
  await prisma.person.deleteMany();
  await prisma.partner.deleteMany();
  // The lookup tables Partner points at, so only after Partner is gone.
  await prisma.region.deleteMany();
  await prisma.partnerType.deleteMany();
  // Program templates, child → parent. The two children would cascade from
  // ProgramTemplate, but tests/wipeAllCoverage.test.ts requires every model to be NAMED
  // here, so all three are deleted explicitly.
  await prisma.phaseTemplateDep.deleteMany();
  await prisma.phaseTemplate.deleteMany();
  await prisma.programTemplate.deleteMany();
}

export interface SeededProgram {
  oemId: number; // Rivian — owns the program
  supplierId: number; // Denso — involved via one phase
  personId: number; // Kenji Sato (Denso) — involved in the integration phase
  projectId: number;
  phases: {
    bringUp: number; // Done (100), 20d — chain start
    integration: number; // In Progress (40), 40d, after bringUp — the CONSTRAINT
    certification: number; // Not Started (0), 50d, after integration — chain end
    audio: number; // In Progress (30), 25d, after bringUp — off the critical chain
  };
}

/**
 * One program with a small DAG whose critical chain is deterministic:
 *   bringUp(0d left) → integration(24d left) → certification(50d left)  = ≈74 days
 * `audio` (17.5d left) branches off bringUp and stays off the chain.
 */
export async function seedProgram(): Promise<SeededProgram> {
  await wipeAll();

  const oem = await prisma.partner.create({
    data: { name: 'Rivian', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } },
  });
  const supplier = await prisma.partner.create({
    data: { name: 'Denso', type: { connectOrCreate: { where: { name: 'Supplier' }, create: { name: 'Supplier' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } },
  });

  const project = await prisma.project.create({
    data: {
      name: 'R2 AAOS Bring-up',
      partnerId: oem.id,
      ownerName: 'dylan',
      theNeedle: 'Concerned',
      hillChartProgress: 40,
      volumeFirstYear: 150000,
      // every program must carry a target SOP (month-end) — the on-track yardstick
      sopDate: new Date(Date.UTC(2027, 2, 31)),
      hasGas: true,
    },
  });

  const mkPhase = async (
    name: string, forecastedDuration: number, progress: number,
    notes: string | null = null, description: string | null = null,
  ) => {
    const phase = await prisma.phase.create({ data: { name, projectId: project.id, forecastedDuration, description } });
    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: progress >= 100 ? 'Done' : progress > 0 ? 'In Progress' : 'Not Started',
        theNeedle: 'On Track',
        hillChartProgress: progress,
        notes,
        source: 'testbot',
      },
    });
    return phase.id;
  };

  const bringUp = await mkPhase('Bring-up', 20, 100, 'Board is stable.');
  // One phase carries a Goal so the rail's goal excerpt is exercised — it is what
  // separates the one-line MIN card from the standard one.
  const integration = await mkPhase(
    'Integration', 40, 40, 'Codec drops blocking the DSP path.',
    '**Goal:** The codec path is stable on the target board.',
  );
  const certification = await mkPhase('Certification', 50, 0);
  const audio = await mkPhase('Audio', 25, 30);

  await prisma.phaseDependency.createMany({
    data: [
      { phaseId: integration, dependsOnPhaseId: bringUp },
      { phaseId: certification, dependsOnPhaseId: integration },
      { phaseId: audio, dependsOnPhaseId: bringUp },
    ],
  });

  await prisma.phasePartner.create({
    data: { phaseId: integration, partnerId: supplier.id, role: 'Supplier' },
  });

  // A person involved in the same phase (with a role), for the People affordances.
  const person = await prisma.person.create({
    data: { name: 'Kenji Sato', email: 'kenji@denso.example', currentPartnerId: supplier.id },
  });
  await prisma.phasePerson.create({
    data: { phaseId: integration, personId: person.id, role: 'FAE' },
  });

  // A weekly program update + an ingested doc, so the activity feed has one of each kind.
  await prisma.projectState.create({
    data: {
      projectId: project.id,
      theNeedle: 'Concerned',
      hillChartProgress: 40,
      notes: 'Codec blockers slowing integration.',
      source: 'testbot',
    },
  });
  await prisma.contextUrl.create({
    data: {
      projectId: project.id,
      url: 'https://docs.google.com/document/d/test-codec-doc',
      type: 'Doc',
      title: 'Codec delivery plan',
      ingestedText: 'Supplier codec samples delayed two weeks; recovery plan drafted.',
    },
  });

  return {
    oemId: oem.id,
    supplierId: supplier.id,
    personId: person.id,
    projectId: project.id,
    phases: { bringUp, integration, certification, audio },
  };
}
