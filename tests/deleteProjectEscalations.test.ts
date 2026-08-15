/** @jest-environment node */
// autoknow-40f, second instance. `Escalation.projectId` is an OPTIONAL relation, so its
// unstated FK is SET NULL — deleting a program would leave an escalation about only that
// program with `projectId=null, partnerId=null`, which `schemas.ts`'s ABOUT_SOMETHING
// refinement rejects on every create and update. The delete could write a state no
// mutation could.
//
// The answer here is NOT the partner one, and the difference is the point: deleting a
// partner is REFUSED while anything points at it (`lib/partnerDeletion`), while deleting
// a program removes the program's world — its phases, its context, its summaries. An
// escalation about only this program is part of that world; one that also names a partner
// still belongs to somebody and keeps the partner.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
// The actions module reaches lib/session, which pulls next-auth's ESM into a CJS test.
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev' })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('../src/lib/search', () => ({ indexEntity: jest.fn(async () => undefined) }));
// deleteProject ends in redirect('/ecosystem'), which works by throwing.
jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  }),
}));

// Dynamic import AFTER the env assignment above — a static import is hoisted and would
// evaluate src/lib/db before DATABASE_URL is set.
let deleteProject: typeof import('../src/app/programs/[id]/actions').deleteProject;

const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };

async function runDelete(projectId: number): Promise<boolean> {
  const fd = new FormData();
  fd.set('projectId', String(projectId));
  try {
    await deleteProject(fd);
    return false;
  } catch (e) {
    if (String((e as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) return true;
    throw e;
  }
}

beforeAll(async () => {
  ({ deleteProject } = await import('../src/app/programs/[id]/actions'));
});

beforeEach(async () => {
  await wipeAll();
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

describe('deleting a program and the escalations about it', () => {
  it('takes the program-only escalation with it, rather than orphaning it', async () => {
    const owner = await prisma.partner.create({ data: { name: 'Ford', region } });
    const project = await prisma.project.create({
      data: { name: 'Evos AAOS', partnerId: owner.id, ownerName: 'dylan' },
    });
    const esc = await prisma.escalation.create({
      data: { title: 'VHAL wait time', projectId: project.id },
    });

    expect(await runDelete(project.id)).toBe(true);
    expect(await prisma.escalation.findUnique({ where: { id: esc.id } })).toBeNull();
    // The state the FK would have produced: about nothing at all. Asserted directly,
    // because it is the row shape this whole change exists to make unreachable.
    expect(await prisma.escalation.count({ where: { projectId: null, partnerId: null } })).toBe(0);
  });

  it('keeps a dual-target escalation, on the partner it also names', async () => {
    const owner = await prisma.partner.create({ data: { name: 'Ford', region } });
    const supplier = await prisma.partner.create({ data: { name: 'Bosch', region } });
    const project = await prisma.project.create({
      data: { name: 'Evos AAOS', partnerId: owner.id, ownerName: 'dylan' },
    });
    const esc = await prisma.escalation.create({
      data: { title: 'Codec samples late', projectId: project.id, partnerId: supplier.id },
    });

    expect(await runDelete(project.id)).toBe(true);

    const after = await prisma.escalation.findUniqueOrThrow({ where: { id: esc.id } });
    expect(after.projectId).toBeNull();
    expect(after.partnerId).toBe(supplier.id); // still reachable, on Bosch's page
  });

  it('leaves another program\'s escalations alone', async () => {
    const owner = await prisma.partner.create({ data: { name: 'Ford', region } });
    const doomed = await prisma.project.create({
      data: { name: 'Evos AAOS', partnerId: owner.id, ownerName: 'dylan' },
    });
    const survivor = await prisma.project.create({
      data: { name: 'Lightning AAOS', partnerId: owner.id, ownerName: 'dylan' },
    });
    const esc = await prisma.escalation.create({
      data: { title: 'Unrelated', projectId: survivor.id },
    });

    expect(await runDelete(doomed.id)).toBe(true);
    expect((await prisma.escalation.findUniqueOrThrow({ where: { id: esc.id } })).projectId)
      .toBe(survivor.id);
  });
});
