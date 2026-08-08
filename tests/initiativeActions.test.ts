/** @jest-environment node */
// Initiative membership semantics against a real database (gh-286 part c): the
// invariants live in the ACTIONS, not the schema, so a JS-level test could pass while
// the writes produced two active copies or resurrected a removed member's history.
// Pattern follows tests/movePersonCovering.test.ts.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper', image: null })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
// indexEntity embeds via Gemini when configured; the test DB never wants that.
jest.mock('../src/lib/search', () => ({ indexEntity: jest.fn(async () => undefined) }));

type Actions = typeof import('../src/app/actions/initiatives');
let createInitiative: Actions['createInitiative'];
let addPartners: Actions['addPartners'];
let removePartner: Actions['removePartner'];
type Templates = typeof import('../src/lib/programTemplates');
let listTemplates: Templates['listTemplates'];

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const isNextRedirect = (e: unknown) =>
  typeof (e as { digest?: string })?.digest === 'string' && (e as { digest: string }).digest.startsWith('NEXT_REDIRECT');

let sourceTemplateId: number;
let oemId: number;

beforeAll(async () => {
  ({ createInitiative, addPartners, removePartner } = await import('../src/app/actions/initiatives'));
  ({ listTemplates } = await import('../src/lib/programTemplates'));
  await wipeAll();
  // A source template with a 2-phase chain, and one partner to enroll.
  const t = await prisma.programTemplate.create({ data: { name: 'AAOS feature rollout' } });
  const design = await prisma.phaseTemplate.create({
    data: { templateId: t.id, name: 'Design', durationWeeks: 2, sortOrder: 0 },
  });
  const ship = await prisma.phaseTemplate.create({
    data: { templateId: t.id, name: 'Ship', durationWeeks: 2, sortOrder: 1, isEndPhase: true },
  });
  await prisma.phaseTemplateDep.create({ data: { phaseTemplateId: ship.id, dependsOnId: design.id } });
  sourceTemplateId = t.id;
  const partner = await prisma.partner.create({
    data: {
      name: 'BMW',
      type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
      region: { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } },
    },
  });
  oemId = partner.id;
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

it('creation snapshots the template; the snapshot is hidden from every template list', async () => {
  await createInitiative(
    form({ name: 'Gemini built-in', templateId: String(sourceTemplateId), targetMonth: '2026-12' }),
  ).catch((e) => {
    if (!isNextRedirect(e)) throw e; // create redirects to the new page on success
  });
  const initiative = await prisma.initiative.findFirstOrThrow({ include: { template: { include: { phases: true } } } });
  // A private copy, not a pointer at the source.
  expect(initiative.templateId).not.toBe(sourceTemplateId);
  expect(initiative.template.phases).toHaveLength(2);
  expect(initiative.targetDate).not.toBeNull();
  // Editing the SOURCE now cannot redefine the initiative — distinct rows.
  await prisma.phaseTemplate.deleteMany({ where: { templateId: sourceTemplateId, name: 'Ship' } });
  expect(
    await prisma.phaseTemplate.count({ where: { templateId: initiative.templateId } }),
  ).toBe(2);
  // Hidden from the list the pickers read; the source stays visible.
  const listed = (await listTemplates()).map((t) => t.id);
  expect(listed).toContain(sourceTemplateId);
  expect(listed).not.toContain(initiative.templateId);
});

it('add → one active copy with the phase graph and the initiative default date; re-add is a no-op', async () => {
  const initiative = await prisma.initiative.findFirstOrThrow();
  const r1 = await addPartners(form({ initiativeId: String(initiative.id), partnerIds: String(oemId) }));
  expect(r1).toEqual({});
  const copies = await prisma.project.findMany({ where: { initiativeId: initiative.id }, include: { phases: true } });
  expect(copies).toHaveLength(1);
  expect(copies[0].partnerId).toBe(oemId);
  expect(copies[0].phases).toHaveLength(2);
  // The copy inherits the initiative's default target when the batch names none.
  expect(copies[0].sopDate?.toISOString()).toBe(initiative.targetDate?.toISOString());
  // The join row is the membership fact.
  const membership = await prisma.initiativePartner.findUniqueOrThrow({
    where: { initiativeId_partnerId: { initiativeId: initiative.id, partnerId: oemId } },
  });
  expect(membership.status).toBe('active');

  // Adding an existing active member instantiates nothing new.
  await addPartners(form({ initiativeId: String(initiative.id), partnerIds: String(oemId) }));
  expect(await prisma.project.count({ where: { initiativeId: initiative.id } })).toBe(1);
});

it('remove cancels and KEEPS the copy; re-add flips the same join row and starts fresh', async () => {
  const initiative = await prisma.initiative.findFirstOrThrow();
  const r = await removePartner(form({ initiativeId: String(initiative.id), partnerId: String(oemId) }));
  expect(r).toEqual({});
  const membership = await prisma.initiativePartner.findUniqueOrThrow({
    where: { initiativeId_partnerId: { initiativeId: initiative.id, partnerId: oemId } },
  });
  expect(membership.status).toBe('removed');
  expect(membership.removedAt).not.toBeNull();
  const cancelled = await prisma.project.findFirstOrThrow({ where: { initiativeId: initiative.id } });
  expect(cancelled.lifecycle).toBe('cancelled'); // kept, not deleted

  // Removing again is a readable failure, not a second write.
  const again = await removePartner(form({ initiativeId: String(initiative.id), partnerId: String(oemId) }));
  expect(again.error).toMatch(/Not an active member/);

  // Re-add: SAME join row (one per pair, forever), fresh second copy beside the history.
  await addPartners(form({ initiativeId: String(initiative.id), partnerIds: String(oemId) }));
  expect(await prisma.initiativePartner.count({ where: { initiativeId: initiative.id } })).toBe(1);
  const copies = await prisma.project.findMany({ where: { initiativeId: initiative.id }, orderBy: { id: 'asc' } });
  expect(copies).toHaveLength(2);
  expect(copies.map((c) => c.lifecycle).sort()).toEqual(['active', 'cancelled']);
});

it('a batch naming any unknown partner is rejected whole', async () => {
  const initiative = await prisma.initiative.findFirstOrThrow();
  const before = await prisma.project.count({ where: { initiativeId: initiative.id } });
  const r = await addPartners(form({ initiativeId: String(initiative.id), partnerIds: `${oemId},999999` }));
  expect(r.error).toMatch(/Unknown partner/);
  expect(await prisma.project.count({ where: { initiativeId: initiative.id } })).toBe(before);
});
