/** @jest-environment node */
// For a program a partner is INVOLVED in (not owner), the card must surface all of
// the program's in-flight phases — not just the single phase this partner sits on —
// while still marking the partner's own phase with its role.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl();

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

let getPartnerPrograms: typeof import('../src/lib/partnerPrograms').getPartnerPrograms;

async function mkPartner(name: string) {
  return prisma.partner.create({
    data: {
      name,
      type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
      region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
    },
  });
}
async function mkPhase(projectId: number, name: string, progress: number) {
  const phase = await prisma.phase.create({ data: { name, projectId, forecastedDuration: 10 } });
  await prisma.phaseState.create({
    data: { phaseId: phase.id, status: 'x', theNeedle: 'On Track', hillChartProgress: progress, source: 't' },
  });
  return phase;
}

let honda: Awaited<ReturnType<typeof mkPartner>>;
let supplier: Awaited<ReturnType<typeof mkPartner>>;
let halPhaseId: number;

beforeAll(async () => {
  ({ getPartnerPrograms } = await import('../src/lib/partnerPrograms'));
  await wipeAll();

  honda = await mkPartner('Honda');
  supplier = await mkPartner('Denso');

  const program = await prisma.project.create({
    data: { name: 'Honda Accord AAOS Bring-up', partnerId: honda.id },
  });
  const bringUp = await mkPhase(program.id, 'BSP Bring-up', 60); // in flight
  const hal = await mkPhase(program.id, 'HAL Integration', 40); // in flight, supplier is on it
  await mkPhase(program.id, 'Certification', 0); // not started
  halPhaseId = hal.id;

  // The supplier is INVOLVED only via HAL Integration.
  await prisma.phasePartner.create({ data: { phaseId: hal.id, partnerId: supplier.id, role: 'Audio' } });
  void bringUp;
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('getPartnerPrograms — involved program phases', () => {
  it('shows every in-flight phase, not just the partner’s own', async () => {
    const programs = await getPartnerPrograms(supplier.id);
    const involved = programs.find((p) => p.relationship === 'involved');
    expect(involved).toBeTruthy();
    const names = involved!.phases.map((p) => p.name).sort();
    // both in-flight phases appear; the not-started one does not
    expect(names).toEqual(['BSP Bring-up', 'HAL Integration']);
  });

  it('keeps the partner’s role on the phase they’re on', async () => {
    const programs = await getPartnerPrograms(supplier.id);
    const involved = programs.find((p) => p.relationship === 'involved')!;
    const hal = involved.phases.find((p) => p.id === halPhaseId)!;
    expect(hal.role).toBe('Audio');
    // a phase they are NOT on carries no role
    expect(involved.phases.find((p) => p.name === 'BSP Bring-up')!.role).toBeNull();
  });
});
