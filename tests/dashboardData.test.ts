/** @jest-environment node */
// Dashboard loader: cycle times must come from state history without materializing
// the whole append-only PhaseState table, archived projects stay out of the
// cycle-time scatter, and the live-constraint rollup reports phases that are
// ACTUALLY on a critical chain — never a synthetic stand-in (#129).
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram, SeededProgram } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();

let getEcosystemDashboardData: typeof import('../src/lib/dashboardData').getEcosystemDashboardData;
let seeded: SeededProgram;

beforeAll(async () => {
  ({ getEcosystemDashboardData } = await import('../src/lib/dashboardData'));
  seeded = await seedProgram();

  // A legacy row: progress 0 but a stale free-text status. Derivations must treat
  // this phase as unstarted regardless of the string.
  const legacy = await prisma.phase.create({
    data: { name: 'Legacy Status Phase', projectId: seeded.projectId, forecastedDuration: 15 },
  });
  await prisma.phaseState.create({
    data: {
      phaseId: legacy.id,
      status: 'Active WIP', // legacy value, contradicts progress
      theNeedle: 'On Track',
      hillChartProgress: 0,
      source: 'testbot',
    },
  });

  // An archived project with a finished phase — must not appear in cycle times.
  const oem = await prisma.partner.findFirstOrThrow({ where: { name: 'Rivian' } });
  const archived = await prisma.project.create({
    data: {
      name: 'Archived program',
      partnerId: oem.id,
      isArchived: true,
      theNeedle: 'On Track',
      hillChartProgress: 100,
      volumeFirstYear: 0,
      sopDate: new Date(Date.UTC(2026, 0, 31)),
    },
  });
  const archivedPhase = await prisma.phase.create({
    data: { name: 'Archived Phase', projectId: archived.id, forecastedDuration: 10 },
  });
  await prisma.phaseState.create({
    data: {
      phaseId: archivedPhase.id,
      status: 'Done',
      theNeedle: 'On Track',
      hillChartProgress: 100,
      source: 'testbot',
    },
  });
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('getEcosystemDashboardData', () => {
  it('reports live constraints as real phases of live programs, most-blocking first', async () => {
    // The panel this feeds used to be five phase names typed into JSX (#129). The
    // property that makes it honest is that every name here came out of the DB, on a
    // program that is actually live — so assert provenance, not a fixed list.
    const data = await getEcosystemDashboardData();
    const liveIds = new Set(
      data.serializedProjects.filter((p) => !p.isArchived && p.lifecycle === 'active').map((p) => p.id),
    );
    const phaseNames = new Set((await prisma.phase.findMany({ select: { name: true } })).map((p) => p.name));

    for (const c of data.liveConstraints) {
      expect(phaseNames.has(c.phaseName)).toBe(true);
      expect(c.programs.length).toBeGreaterThan(0);
      for (const prog of c.programs) expect(liveIds.has(prog.id)).toBe(true);
    }
    const counts = data.liveConstraints.map((c) => c.programs.length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('computes cycle times from first-in-flight to first-complete', async () => {
    const data = await getEcosystemDashboardData();
    const byName = Object.fromEntries(data.cycleTimeData.map((c) => [c.phaseName, c]));

    // bringUp seeded straight at 100: started and finished on the same state row.
    expect(byName['Bring-up']?.isFinished).toBe(true);
    expect(byName['Bring-up']?.cycleTimeDays).toBeGreaterThanOrEqual(1);
    // integration is in flight (40)
    expect(byName['Integration']?.isFinished).toBe(false);
    // certification never started (0) — no cycle time at all
    expect(byName['Certification']).toBeUndefined();
  });

  it('excludes archived projects from cycle times', async () => {
    const data = await getEcosystemDashboardData();
    expect(data.cycleTimeData.some((c) => c.phaseName === 'Archived Phase')).toBe(false);
  });
});
