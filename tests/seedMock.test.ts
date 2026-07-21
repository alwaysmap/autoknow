/** @jest-environment node */
// seedMockData creates its data THROUGH the application's API routes and server
// actions (docs/CRITICAL_CHAIN_VIEW_PLAN.md §6), so this suite is the proof that the
// mutation boundaries accept the whole seed and that what lands is correct by
// construction: canonical owners, resolved assignees, canonical health labels,
// dated histories that survive newest-wins ordering, and dependency edges that
// passed cycle rejection.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl();

import { prisma, disconnectTestDb } from './helpers/db';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com' })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

// The full seed touches every route many times; give it room.
jest.setTimeout(180_000);

beforeAll(async () => {
  const { seedMockData } = await import('../src/lib/seed');
  await seedMockData();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('seedMockData through the API', () => {
  it('lands the full entity graph', async () => {
    // 1 Google + 4 classic + 10 enrichment partners.
    expect(await prisma.partner.count()).toBe(15);
    // 7 classic-era people (incl. Alice + Clara, the once-freeform owners) + 8 enrichment.
    expect(await prisma.person.count()).toBe(15);
    // 4 classic + 7 enrichment + 4 showcase programs.
    expect(await prisma.project.count()).toBe(15);
    expect(await prisma.phaseDependency.count()).toBeGreaterThan(0);
    expect(await prisma.phasePartner.count()).toBeGreaterThan(0);
    expect(await prisma.phasePerson.count()).toBeGreaterThan(0);
    expect(await prisma.contextUrl.count()).toBe(4);
  });

  it('program owners are canonical emails of existing people (requireOwnerEmail at the route)', async () => {
    const byName = async (name: string) =>
      prisma.project.findFirstOrThrow({ where: { name }, select: { ownerName: true } });
    expect((await byName('Ford Evos AAOS Bring-up')).ownerName).toBe('dylan@google.com');
    expect((await byName('Toyota Highlander Digital Key')).ownerName).toBe('alice@google.com');
    expect((await byName('Ford Explorer VHAL Integration (Bosch)')).ownerName).toBe('clara@google.com');
    expect((await byName('Honda Accord AAOS Bring-up')).ownerName).toBe('marcusw@google.com');

    // Every seeded owner resolves to a person on file — none is freeform text.
    const owners = await prisma.project.findMany({ select: { ownerName: true } });
    const emails = new Set((await prisma.person.findMany({ select: { email: true } })).map((p) => p.email));
    for (const { ownerName } of owners) {
      expect(ownerName && emails.has(ownerName)).toBe(true);
    }
  });

  it('health labels are canonical — the routes normalized the legacy risk values', async () => {
    const bosch = await prisma.project.findFirstOrThrow({
      where: { name: 'Ford Explorer VHAL Integration (Bosch)' },
    });
    expect(bosch.theNeedle).toBe('Concerned'); // seeded as legacy 'High'
    expect(bosch.hillChartProgress).toBe(60);

    const allStates = await prisma.projectState.findMany({ select: { theNeedle: true } });
    for (const s of allStates) {
      expect(['On Track', 'Some Risk', 'Concerned']).toContain(s.theNeedle);
    }
  });

  it('project columns agree with the newest project state (the needle route writes both in one tx)', async () => {
    const projects = await prisma.project.findMany({
      include: { states: { orderBy: { timestamp: 'desc' }, take: 1 } },
    });
    for (const p of projects) {
      expect(p.states).toHaveLength(1);
      expect(p.states[0].theNeedle).toBe(p.theNeedle);
      expect(p.states[0].hillChartProgress).toBe(p.hillChartProgress);
    }
  });

  it('showcase phases carry dated histories and the newest row is the real progress', async () => {
    const gemini = await prisma.project.findFirstOrThrow({
      where: { name: 'Gemini X Cockpit' },
      include: { phases: { include: { states: { orderBy: { timestamp: 'desc' } } } } },
    });
    const cert = gemini.phases.find((ph) => ph.name === 'Cert');
    expect(cert).toBeDefined();
    // Initial state + 3 dated rows, all in the past, newest-first = 30%.
    expect(cert!.states.length).toBeGreaterThanOrEqual(4);
    expect(cert!.states[0].hillChartProgress).toBe(30);
    for (const s of cert!.states) {
      expect(s.timestamp.getTime()).toBeLessThan(Date.now());
    }
    // The Active toggle landed an explicit start.
    expect(cert!.startedAt).not.toBeNull();

    const hw = gemini.phases.find((ph) => ph.name === 'HW bring-up');
    expect(hw!.states[0].hillChartProgress).toBe(100);
    // History spans months — the buffer-trend replay has something to chew on.
    const span = hw!.states[0].timestamp.getTime() - hw!.states[hw!.states.length - 1].timestamp.getTime();
    expect(span).toBeGreaterThan(60 * 86_400_000);
  });

  it('classic dated histories beat the phase-create initial state (stateTimestamp override)', async () => {
    const ford = await prisma.project.findFirstOrThrow({
      where: { name: 'Ford Evos AAOS Bring-up' },
      include: { phases: { include: { states: { orderBy: { timestamp: 'desc' } } } } },
    });
    const bsp = ford.phases.find((ph) => ph.name === 'BSP & power-on');
    expect(bsp!.states[0].hillChartProgress).toBe(100);
    expect(bsp!.states[0].status).toBe('Done');
    // The auto-created initial row exists and sits at the back of the history.
    const oldest = bsp!.states[bsp!.states.length - 1];
    expect(oldest.hillChartProgress).toBe(0);
  });

  it('dependency edges follow the template DAG (via the cycle-rejecting action)', async () => {
    const ford = await prisma.project.findFirstOrThrow({
      where: { name: 'Ford Evos AAOS Bring-up' },
      include: { phases: true },
    });
    const edges = await prisma.phaseDependency.count({
      where: { phaseId: { in: ford.phases.map((p) => p.id) } },
    });
    expect(edges).toBe(4); // AAOS template: 4 dependsOn edges across 5 phases
  });

  it('action items resolved their assignees to people (resolvePerson at the route)', async () => {
    const dylan = await prisma.person.findFirstOrThrow({ where: { email: 'dylan@google.com' } });
    const kenji = await prisma.person.findFirstOrThrow({ where: { email: 'kenji.sato@toyota.com' } });

    const vhal = await prisma.actionItem.findFirstOrThrow({
      where: { description: 'Determine cause for VHAL wait time delay' },
    });
    expect(vhal.assignedToPersonId).toBe(dylan.id);
    expect(vhal.source).toBe('Buganizer');
    expect(vhal.sourceUrl).toContain('buganizer');

    const cluster = await prisma.actionItem.findFirstOrThrow({
      where: { description: 'Verify cluster instrumentation panel interface specifications' },
    });
    expect(cluster.assignedToPersonId).toBe(kenji.id);

    // Nothing seeded an unlinked assignee.
    expect(await prisma.actionItem.count({ where: { assignedToPersonId: null } })).toBe(0);
  });

  it('relationship journal keeps the ghost-ring pair with canonical derived health', async () => {
    const honda = await prisma.partner.findFirstOrThrow({ where: { name: 'Honda' } });
    const states = await prisma.partnerState.findMany({
      where: { partnerId: honda.id },
      orderBy: { timestamp: 'desc' },
    });
    expect(states).toHaveLength(2);
    expect(states[0].relationshipScore).toBe(4);
    expect(states[0].theNeedle).toBe('On Track'); // scoreToHealth(4)
    expect(states[1].relationshipScore).toBe(3);
    expect(states[1].theNeedle).toBe('Some Risk'); // scoreToHealth(3)
    expect(states[0].notes).toBeTruthy(); // the journal requires a written note
  });

  // Faulty-mock-data guard. A phase must not be seeded as started (current progress
  // > 0) while any dependency is still incomplete — that would draw the schedule
  // chart as if a downstream phase began before its prerequisite finished, which the
  // DAG forbids. seedTemplatePhases enforces it for template programs; the chain-ledger
  // showcase is hand-authored to respect it. This asserts it holds across EVERY seeded
  // program, so a future edit that reintroduces the incoherence fails loudly here. (A
  // deliberate edge case would be documented and exempted — none exists today.)
  it('no phase is started before its dependencies are complete (DAG coherence)', async () => {
    const projects = await prisma.project.findMany({
      include: {
        phases: {
          include: {
            states: { orderBy: { timestamp: 'desc' }, take: 1 },
            dependencies: true,
          },
        },
      },
    });
    const violations: string[] = [];
    for (const proj of projects) {
      const progressById = new Map(proj.phases.map((ph) => [ph.id, ph.states[0]?.hillChartProgress ?? 0]));
      const nameById = new Map(proj.phases.map((ph) => [ph.id, ph.name]));
      for (const ph of proj.phases) {
        const progress = progressById.get(ph.id) ?? 0;
        if (progress <= 0) continue; // not started — nothing to gate
        for (const dep of ph.dependencies) {
          const depProgress = progressById.get(dep.dependsOnPhaseId) ?? 0;
          if (depProgress < 100) {
            violations.push(
              `${proj.name}: "${ph.name}" is ${progress}% but its dependency ` +
                `"${nameById.get(dep.dependsOnPhaseId)}" is only ${depProgress}%`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
