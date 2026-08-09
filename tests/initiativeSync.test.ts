/** @jest-environment node */
// Template propagation semantics against a real database (gh-286 hcz.13): renames keep
// progress (matched by provenance, not name), removals take their records, additions
// arrive at zero, and finished/cancelled copies are history the sync never touches.
// Pattern follows tests/initiativeActions.test.ts.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { isNextRedirect } from '../src/lib/actionResult';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper', image: null })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('../src/lib/search', () => ({ indexEntity: jest.fn(async () => undefined) }));

type InitiativeActions = typeof import('../src/app/actions/initiatives');
let createInitiative: InitiativeActions['createInitiative'];
let addPartners: InitiativeActions['addPartners'];
let removePartner: InitiativeActions['removePartner'];
type TemplateActions = typeof import('../src/app/actions/templates');
let saveTemplatePhases: TemplateActions['saveTemplatePhases'];

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

let initiativeId: number;
let snapshotId: number;
let bmwId: number;
let hondaId: number;

beforeAll(async () => {
  ({ createInitiative, addPartners, removePartner } = await import('../src/app/actions/initiatives'));
  ({ saveTemplatePhases } = await import('../src/app/actions/templates'));
  await wipeAll();
  const mkOem = (name: string) =>
    prisma.partner.create({
      data: { name, type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } } },
    });
  bmwId = (await mkOem('BMW')).id;
  hondaId = (await mkOem('Honda')).id;
  const t = await prisma.programTemplate.create({ data: { name: 'AAOS feature rollout' } });
  const design = await prisma.phaseTemplate.create({ data: { templateId: t.id, name: 'Design', durationWeeks: 3, sortOrder: 0 } });
  const ship = await prisma.phaseTemplate.create({ data: { templateId: t.id, name: 'Ship', durationWeeks: 2, sortOrder: 1, isEndPhase: true } });
  await prisma.phaseTemplateDep.create({ data: { phaseTemplateId: ship.id, dependsOnId: design.id } });

  await createInitiative(form({ name: 'Gemini built-in', templateId: String(t.id) })).catch((e) => {
    if (!isNextRedirect(e)) throw e;
  });
  const initiative = await prisma.initiative.findFirstOrThrow();
  initiativeId = initiative.id;
  snapshotId = initiative.templateId;
  await addPartners(form({ initiativeId: String(initiativeId), partnerIds: `${bmwId},${hondaId}` }));
  // Honda leaves: their cancelled copy is the history the sync must not rewrite.
  await removePartner(form({ initiativeId: String(initiativeId), partnerId: String(hondaId) }));
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

it('rename keeps progress, removal takes its records, addition arrives at zero — and history is untouched', async () => {
  // BMW makes progress on Design before the edit.
  const bmwCopy = await prisma.project.findFirstOrThrow({ where: { initiativeId, partnerId: bmwId } });
  const bmwDesign = await prisma.phase.findFirstOrThrow({ where: { projectId: bmwCopy.id, name: 'Design' } });
  await prisma.phaseState.create({
    data: { phaseId: bmwDesign.id, status: 'In Progress', hillChartProgress: 60, theNeedle: 'On Track', source: 'testbot' },
  });

  // The initiative-level edit: Design → "Discovery" (same step, 5 weeks now), Ship
  // removed, "Launch" added as the new end.
  const steps = await prisma.phaseTemplate.findMany({ where: { templateId: snapshotId }, orderBy: { sortOrder: 'asc' } });
  const designStep = steps.find((s) => s.name === 'Design')!;
  const payload = [
    { id: designStep.id, name: 'Discovery', weeks: 5, leadRole: null, description: null, googleFocus: null, dependsOn: [] },
    { id: -1, name: 'Launch', weeks: 2, leadRole: null, description: null, googleFocus: null, dependsOn: [designStep.id] },
  ];
  const result = await saveTemplatePhases(form({ templateId: String(snapshotId), payload: JSON.stringify(payload) }));
  expect(result).toEqual({});

  // BMW's active copy: the renamed step is the SAME phase row — progress intact.
  const phases = await prisma.phase.findMany({
    where: { projectId: bmwCopy.id },
    include: { states: true, dependencies: true },
    orderBy: { id: 'asc' },
  });
  expect(phases.map((p) => p.name).sort()).toEqual(['Discovery', 'Launch']);
  const discovery = phases.find((p) => p.name === 'Discovery')!;
  expect(discovery.id).toBe(bmwDesign.id);
  expect(discovery.forecastedDuration).toBe(35); // 5 weeks, runtime stays days
  expect(discovery.states.some((s) => s.hillChartProgress === 60)).toBe(true);
  const launch = phases.find((p) => p.name === 'Launch')!;
  expect(launch.isEndPhase).toBe(true);
  expect(launch.states.map((s) => s.hillChartProgress)).toEqual([0]);
  expect(launch.dependencies.map((d) => d.dependsOnPhaseId)).toEqual([discovery.id]);
  // Ship went with its records.
  expect(await prisma.phase.count({ where: { projectId: bmwCopy.id, name: 'Ship' } })).toBe(0);

  // Honda's cancelled copy is history: still Design/Ship, untouched by the edit.
  const hondaCopy = await prisma.project.findFirstOrThrow({ where: { initiativeId, partnerId: hondaId } });
  const hondaPhases = await prisma.phase.findMany({ where: { projectId: hondaCopy.id } });
  expect(hondaPhases.map((p) => p.name).sort()).toEqual(['Design', 'Ship']);
});

it('a later join instantiates the EDITED steps — the snapshot is the single definition', async () => {
  // Honda rejoins after the edit: fresh copy, current steps.
  await addPartners(form({ initiativeId: String(initiativeId), partnerIds: String(hondaId) }));
  const fresh = await prisma.project.findFirstOrThrow({
    where: { initiativeId, partnerId: hondaId, lifecycle: 'active' },
    include: { phases: true },
  });
  expect(fresh.phases.map((p) => p.name).sort()).toEqual(['Discovery', 'Launch']);
  // Every phase carries provenance — the next edit matches by id, not name.
  expect(fresh.phases.every((p) => p.sourcePhaseTemplateId != null)).toBe(true);
});
