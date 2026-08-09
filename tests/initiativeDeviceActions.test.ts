/** @jest-environment node */
// Device-link semantics against a real database (autoknow-hcz.14): the rules — same
// partner, real program — live in the ACTION, deliberately not the schema, so only a
// DB-backed test can prove a bad reference is refused before the write. Pattern
// follows tests/initiativeActions.test.ts.
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
let linkDevice: Actions['linkDevice'];
let unlinkDevice: Actions['unlinkDevice'];

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const isNextRedirect = (e: unknown) =>
  typeof (e as { digest?: string })?.digest === 'string' && (e as { digest: string }).digest.startsWith('NEXT_REDIRECT');

let initiativeId: number;
let bmwId: number;
let audiId: number; // never a member — a link for it has no membership to hang on
let bmwProgramId: number; // BMW's REAL device program — the only legal link target
let audiProgramId: number; // another partner's real program — must be refused
let copyId: number; // BMW's initiative copy — must be refused

beforeAll(async () => {
  ({ createInitiative, addPartners, linkDevice, unlinkDevice } = await import('../src/app/actions/initiatives'));
  await wipeAll();
  const t = await prisma.programTemplate.create({ data: { name: 'AAOS feature rollout' } });
  await prisma.phaseTemplate.create({
    data: { templateId: t.id, name: 'Design', durationWeeks: 2, sortOrder: 0, isEndPhase: true },
  });
  const oem = { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } };
  const emea = { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } };
  const bmw = await prisma.partner.create({ data: { name: 'BMW', type: oem, region: emea } });
  bmwId = bmw.id;
  const audi = await prisma.partner.create({ data: { name: 'Audi', type: oem, region: emea } });
  audiId = audi.id;
  bmwProgramId = (await prisma.project.create({ data: { name: 'iDrive X head unit', partnerId: bmw.id } })).id;
  audiProgramId = (await prisma.project.create({ data: { name: 'MIB4', partnerId: audi.id } })).id;

  await createInitiative(form({ name: 'Gemini built-in', templateId: String(t.id) })).catch((e) => {
    if (!isNextRedirect(e)) throw e; // create redirects to the new page on success
  });
  initiativeId = (await prisma.initiative.findFirstOrThrow()).id;
  await addPartners(form({ initiativeId: String(initiativeId), partnerIds: String(bmwId) }));
  copyId = (await prisma.project.findFirstOrThrow({ where: { initiativeId } })).id;
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

it('refuses an initiative copy, another partner’s program, and an unknown program — whole, at the boundary', async () => {
  // The copy IS a Project row belonging to BMW, so only the real-program rule stops it.
  const asCopy = await linkDevice(form({ initiativeId: String(initiativeId), partnerId: String(bmwId), projectId: String(copyId) }));
  expect(asCopy.error).toMatch(/initiative copy/);
  // Audi's program is real, so only the same-partner rule stops it.
  const wrongPartner = await linkDevice(form({ initiativeId: String(initiativeId), partnerId: String(bmwId), projectId: String(audiProgramId) }));
  expect(wrongPartner.error).toMatch(/different partner/);
  const unknown = await linkDevice(form({ initiativeId: String(initiativeId), partnerId: String(bmwId), projectId: '999999' }));
  expect(unknown.error).toMatch(/Unknown program/);
  // A partner that is not a member has no membership row to hang a link on.
  const notMember = await linkDevice(form({ initiativeId: String(initiativeId), partnerId: String(audiId), projectId: String(audiProgramId) }));
  expect(notMember.error).toMatch(/Not an active member/);
  expect(await prisma.initiativeDevice.count()).toBe(0);
});

it('links the member’s own real program; re-linking is a no-op', async () => {
  const r = await linkDevice(form({ initiativeId: String(initiativeId), partnerId: String(bmwId), projectId: String(bmwProgramId) }));
  expect(r).toEqual({});
  const membership = await prisma.initiativePartner.findUniqueOrThrow({
    where: { initiativeId_partnerId: { initiativeId, partnerId: bmwId } },
  });
  const links = await prisma.initiativeDevice.findMany();
  expect(links).toHaveLength(1);
  expect(links[0].initiativePartnerId).toBe(membership.id);
  expect(links[0].projectId).toBe(bmwProgramId);

  // Retry-safe, the same stance as addMembers: linking what is linked changes nothing.
  await linkDevice(form({ initiativeId: String(initiativeId), partnerId: String(bmwId), projectId: String(bmwProgramId) }));
  expect(await prisma.initiativeDevice.count()).toBe(1);
});

it('unlink removes the link and keeps the program; a second unlink is a readable failure', async () => {
  const link = await prisma.initiativeDevice.findFirstOrThrow();
  const r = await unlinkDevice(form({ deviceId: String(link.id) }));
  expect(r).toEqual({});
  expect(await prisma.initiativeDevice.count()).toBe(0);
  // The program itself is untouched — only the join went.
  expect(await prisma.project.count({ where: { id: bmwProgramId } })).toBe(1);

  const again = await unlinkDevice(form({ deviceId: String(link.id) }));
  expect(again.error).toMatch(/nothing to unlink/);
});
