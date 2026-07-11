// Shared test fixtures. Everything goes through tests/helpers/db (the *_test database).

import { prisma } from './db';

/** Wipe the TEST database in FK-safe order. */
export async function wipeAll() {
  await prisma.actionItem.deleteMany();
  await prisma.contextUrl.deleteMany();
  await prisma.phasePartner.deleteMany();
  await prisma.phasePerson.deleteMany();
  await prisma.phaseState.deleteMany();
  await prisma.phaseDependency.deleteMany();
  await prisma.phase.deleteMany();
  await prisma.projectState.deleteMany();
  await prisma.programBrief.deleteMany();
  await prisma.partnerState.deleteMany();
  await prisma.project.deleteMany();
  await prisma.personAffiliation.deleteMany();
  await prisma.person.deleteMany();
  await prisma.partner.deleteMany();
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
    data: { name: 'Rivian', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } } },
  });
  const supplier = await prisma.partner.create({
    data: { name: 'Denso', type: { connectOrCreate: { where: { name: 'Supplier' }, create: { name: 'Supplier' } } } },
  });

  const project = await prisma.project.create({
    data: {
      name: 'R2 AAOS Bring-up',
      partnerId: oem.id,
      ownerName: 'dylan',
      theNeedle: 'Concerned',
      hillChartProgress: 40,
      volumeFirstYear: 150000,
    },
  });

  const mkPhase = async (name: string, forecastedDuration: number, progress: number, notes: string | null = null) => {
    const phase = await prisma.phase.create({ data: { name, projectId: project.id, forecastedDuration } });
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
  const integration = await mkPhase('Integration', 40, 40, 'Codec drops blocking the DSP path.');
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
