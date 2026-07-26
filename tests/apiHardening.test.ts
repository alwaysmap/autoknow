/** @jest-environment node */
// Route-hardening batch: the nested phase routes must verify parentage (a
// mismatched project/phase pair is a 404, not a silent accept), validate input at
// the boundary (400, never a Prisma P2003→500), and write multi-step mutations
// atomically. The dependency action must survive concurrent duplicate adds, and
// built-in template seeding must survive concurrent callers.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram, SeededProgram } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

type Routes = {
  phases: typeof import('../src/app/api/projects/[id]/phases/route');
  state: typeof import('../src/app/api/projects/[id]/phases/[phaseId]/state/route');
  actionItems: typeof import('../src/app/api/projects/[id]/phases/[phaseId]/action-items/route');
  affiliations: typeof import('../src/app/api/people/[id]/affiliations/route');
  needle: typeof import('../src/app/api/projects/[id]/needle/route');
};
let routes: Routes;
let deps: typeof import('../src/app/actions/dependencies');
let templates: typeof import('../src/lib/programTemplates');
let seeded: SeededProgram;
let otherProjectId: number;

const jsonReq = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  routes = {
    phases: await import('../src/app/api/projects/[id]/phases/route'),
    state: await import('../src/app/api/projects/[id]/phases/[phaseId]/state/route'),
    actionItems: await import('../src/app/api/projects/[id]/phases/[phaseId]/action-items/route'),
    affiliations: await import('../src/app/api/people/[id]/affiliations/route'),
    needle: await import('../src/app/api/projects/[id]/needle/route'),
  };
  deps = await import('../src/app/actions/dependencies');
  templates = await import('../src/lib/programTemplates');

  seeded = await seedProgram();
  const other = await prisma.project.create({
    data: { name: 'Unrelated program', partnerId: seeded.oemId },
  });
  otherProjectId = other.id;
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('POST /api/projects/[id]/phases', () => {
  const post = (projectId: number | string, body: unknown) =>
    routes.phases.POST(jsonReq(`http://localhost/api/projects/${projectId}/phases`, body), {
      params: Promise.resolve({ id: String(projectId) }),
    });

  it('404s on an unknown project instead of a FK 500', async () => {
    expect((await post(999999, { name: 'Ghost' })).status).toBe(404);
  });

  it('400s on garbage duration instead of NaN→500', async () => {
    expect((await post(seeded.projectId, { name: 'X', forecastedDuration: 'soon' })).status).toBe(400);
    expect((await post(seeded.projectId, {})).status).toBe(400);
  });

  it('creates phase and its initial state together', async () => {
    const res = await post(seeded.projectId, { name: 'Hardening Phase', forecastedDuration: 14 });
    expect(res.status).toBe(201);
    const { phase } = await res.json();
    expect(await prisma.phaseState.count({ where: { phaseId: phase.id } })).toBe(1);
  });
});

describe('POST .../phases/[phaseId]/state parentage', () => {
  it('404s when the phase does not belong to the project in the URL', async () => {
    const res = await routes.state.POST(
      jsonReq(`http://localhost/api/projects/${otherProjectId}/phases/${seeded.phases.integration}/state`, { notes: 'sneak' }),
      { params: Promise.resolve({ id: String(otherProjectId), phaseId: String(seeded.phases.integration) }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('POST .../phases/[phaseId]/action-items', () => {
  const post = (projectId: number, phaseId: number, body: unknown) =>
    routes.actionItems.POST(
      jsonReq(`http://localhost/api/projects/${projectId}/phases/${phaseId}/action-items`, body),
      { params: Promise.resolve({ id: String(projectId), phaseId: String(phaseId) }) },
    );

  it('rejects free-text status that would hide items from summaries', async () => {
    const res = await post(seeded.projectId, seeded.phases.integration, {
      description: 'check codec drop',
      status: 'pending', // must be exactly 'Pending'
    });
    expect(res.status).toBe(400);
  });

  it('404s on a project/phase mismatch', async () => {
    const res = await post(otherProjectId, seeded.phases.integration, {
      description: 'x',
      status: 'Pending',
    });
    expect(res.status).toBe(404);
  });

  it('accepts a canonical item', async () => {
    const res = await post(seeded.projectId, seeded.phases.integration, {
      description: 'check codec drop',
      status: 'Pending',
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/people/[id]/affiliations', () => {
  let personId: number;
  beforeAll(async () => {
    const p = await prisma.person.create({
      data: { name: 'Aiko', email: 'aiko@example.com', currentPartnerId: seeded.supplierId },
    });
    personId = p.id;
  });

  const post = (id: number | string, body: unknown) =>
    routes.affiliations.POST(jsonReq(`http://localhost/api/people/${id}/affiliations`, body), {
      params: Promise.resolve({ id: String(id) }),
    });

  it('400s on an invalid date instead of Invalid Date→500', async () => {
    const res = await post(personId, { partnerId: seeded.supplierId, role: 'FAE', startDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  it('400s on a non-numeric partnerId', async () => {
    const res = await post(personId, { partnerId: 'abc', role: 'FAE', startDate: '2026-01-01' });
    expect(res.status).toBe(400);
  });

  it('404s on unknown person or partner instead of FK 500', async () => {
    expect((await post(999999, { partnerId: seeded.supplierId, role: 'FAE', startDate: '2026-01-01' })).status).toBe(404);
    expect((await post(personId, { partnerId: 999999, role: 'FAE', startDate: '2026-01-01' })).status).toBe(404);
  });

  it('creates a valid affiliation', async () => {
    const res = await post(personId, { partnerId: seeded.supplierId, role: 'FAE', startDate: '2026-01-01' });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/projects/[id]/needle', () => {
  const post = (body: unknown) =>
    routes.needle.POST(jsonReq(`http://localhost/api/projects/${seeded.projectId}/needle`, body), {
      params: Promise.resolve({ id: String(seeded.projectId) }),
    });

  it('400s on out-of-range or garbage progress', async () => {
    expect((await post({ hillChartProgress: 'lots' })).status).toBe(400);
    expect((await post({ hillChartProgress: 250 })).status).toBe(400);
  });

  it('keeps the project column and the state log in agreement', async () => {
    const res = await post({ theNeedle: 'Concerned', hillChartProgress: 61, notes: 'sync check' });
    expect(res.status).toBe(200);
    const proj = await prisma.project.findUniqueOrThrow({ where: { id: seeded.projectId } });
    const latest = await prisma.projectState.findFirstOrThrow({
      where: { projectId: seeded.projectId },
      orderBy: { timestamp: 'desc' },
    });
    expect(proj.hillChartProgress).toBe(61);
    expect(latest.hillChartProgress).toBe(61);
    expect(latest.theNeedle).toBe(proj.theNeedle);
  });
});

describe('addPhaseDependency', () => {
  const form = (phaseId: number, dependsOnPhaseId: number) => {
    const fd = new FormData();
    fd.set('phaseId', String(phaseId));
    fd.set('dependsOnPhaseId', String(dependsOnPhaseId));
    fd.set('projectId', String(seeded.projectId));
    return fd;
  };

  it('concurrent duplicate adds produce exactly one edge', async () => {
    // audio ← certification does not exist yet and creates no cycle
    const [a, b] = await Promise.all([
      deps.addPhaseDependency(form(seeded.phases.audio, seeded.phases.certification)),
      deps.addPhaseDependency(form(seeded.phases.audio, seeded.phases.certification)),
    ]);
    const errors = [a, b].filter((r) => r.error);
    expect(errors.length).toBe(1); // one wins, one reports duplicate
    const count = await prisma.phaseDependency.count({
      where: { phaseId: seeded.phases.audio, dependsOnPhaseId: seeded.phases.certification },
    });
    expect(count).toBe(1);
  });

  it('still rejects cycles', async () => {
    // integration depends on bringUp (seeded); adding bringUp→integration is a cycle
    const res = await deps.addPhaseDependency(form(seeded.phases.bringUp, seeded.phases.integration));
    expect(res.error).toMatch(/cycle/i);
  });
});

describe('ensureBuiltinTemplates', () => {
  it('concurrent seeding never duplicates a built-in', async () => {
    await prisma.phaseTemplateDep.deleteMany();
    await prisma.phaseTemplate.deleteMany();
    await prisma.programTemplate.deleteMany();
    await Promise.all([templates.ensureBuiltinTemplates(), templates.ensureBuiltinTemplates()]);
    const rows = await prisma.programTemplate.findMany({ where: { isBuiltIn: true } });
    const names = rows.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
