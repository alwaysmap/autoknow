/** @jest-environment node */
// Exercises the phase-state POST route against the *_test database. The route module
// imports src/lib/db, which connects wherever DATABASE_URL points — so the URL is
// forced to the test database before the route is (dynamically) imported.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram, SeededProgram } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));
// next-auth v5 is ESM-only and won't compile under jest; auth-unconfigured is the
// deterministic test posture (requireRouteAuth admits in test mode).
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));

type StateRoute = typeof import('../src/app/api/projects/[id]/phases/[phaseId]/state/route');

let route: StateRoute;
let seeded: SeededProgram;

function post(projectId: number, phaseId: number, body: unknown) {
  const req = new Request(`http://localhost/api/projects/${projectId}/phases/${phaseId}/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return route.POST(req, { params: Promise.resolve({ id: String(projectId), phaseId: String(phaseId) }) });
}

async function latestState(phaseId: number) {
  return prisma.phaseState.findFirstOrThrow({ where: { phaseId }, orderBy: { timestamp: 'desc' } });
}

beforeAll(async () => {
  route = await import('../src/app/api/projects/[id]/phases/[phaseId]/state/route');
  seeded = await seedProgram();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('POST /api/projects/[id]/phases/[phaseId]/state', () => {
  it('a notes-only update preserves the latest hill progress', async () => {
    // integration phase seeds at 40% — a risk note must not move the dot.
    const res = await post(seeded.projectId, seeded.phases.integration, {
      notes: 'Audio HAL blocked on vendor drop',
      theNeedle: 'Concerned',
    });
    expect(res.status).toBe(201);

    const latest = await latestState(seeded.phases.integration);
    expect(latest.hillChartProgress).toBe(40);
    expect(latest.status).toBe('In Progress');
    expect(latest.notes).toBe('Audio HAL blocked on vendor drop');
  });

  it('an explicit hillChartProgress still moves the dot', async () => {
    const res = await post(seeded.projectId, seeded.phases.integration, {
      hillChartProgress: 55,
      source: 'testbot',
    });
    expect(res.status).toBe(201);

    const latest = await latestState(seeded.phases.integration);
    expect(latest.hillChartProgress).toBe(55);
  });

  it('a first state on a phase with no history defaults to 0', async () => {
    const bare = await prisma.phase.create({
      data: { name: 'Bare phase', projectId: seeded.projectId, forecastedDuration: 10 },
    });
    const res = await post(seeded.projectId, bare.id, { notes: 'first contact' });
    expect(res.status).toBe(201);

    const latest = await latestState(bare.id);
    expect(latest.hillChartProgress).toBe(0);
    expect(latest.status).toBe('Not Started');
  });

  it('rejects out-of-range progress', async () => {
    const res = await post(seeded.projectId, seeded.phases.integration, { hillChartProgress: 140 });
    expect(res.status).toBe(400);
  });
});
