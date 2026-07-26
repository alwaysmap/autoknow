/** @jest-environment node */
// #127 E3. Editing a person did not exist; this is the action behind the new dialog.
//
// A CORRECTION, not a change: a misspelled name or a typo'd address was always wrong,
// so nothing is appended to the career and there is no effective date. That is what
// separates it from `movePersonCompany`, which takes one.
//
// The email is the interesting field — `Person.email` is unique AND `resolvePerson`
// matches on it — so these pin what happens at the edges of that, not the happy path
// alone.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
// next-auth v5 is ESM-only and won't compile under jest; the action reaches lib/session
// transitively through its sibling createMyProfile, so it has to be stubbed even though
// updatePerson never asks who is signed in.
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper', image: null })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

type People = typeof import('../src/app/actions/people');
let updatePerson: People['updatePerson'];

let aliceId: number;
let bobId: number;

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeAll(async () => {
  ({ updatePerson } = await import('../src/app/actions/people'));
});

beforeEach(async () => {
  await wipeAll();
  const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
  const partner = await prisma.partner.create({ data: { name: 'Bosch', region } });
  const mk = async (name: string, email: string) =>
    (await prisma.person.create({ data: { name, email, currentPartnerId: partner.id } })).id;
  aliceId = await mk('Alise Watrs', 'alice@old.example');
  bobId = await mk('Bob Miller', 'bob@example.com');
});

afterAll(async () => {
  // Leave the shared database as we found it — suites that assert exact row counts run
  // after this one.
  await wipeAll();
  await disconnectTestDb();
});

describe('updatePerson', () => {
  it('corrects name, email and notes together', async () => {
    const res = await updatePerson(form({
      personId: String(aliceId), name: 'Alice Waters', email: 'alice@example.com', notes: 'Cockpit lead',
    }));
    expect(res.error).toBeUndefined();
    const after = await prisma.person.findUniqueOrThrow({ where: { id: aliceId } });
    expect([after.name, after.email, after.notes]).toEqual(['Alice Waters', 'alice@example.com', 'Cockpit lead']);
  });

  it('clears notes when the field comes back empty, rather than keeping the old prose', async () => {
    await updatePerson(form({ personId: String(aliceId), name: 'A', email: 'a@example.com', notes: 'temp' }));
    await updatePerson(form({ personId: String(aliceId), name: 'A', email: 'a@example.com', notes: '' }));
    expect((await prisma.person.findUniqueOrThrow({ where: { id: aliceId } })).notes).toBeNull();
  });

  // A raw constraint failure reaches the user as `guarded`'s generic line, which is no
  // help when the duplicate is a person you could go and look at.
  it('refuses a taken address and NAMES who has it, without touching the row', async () => {
    const res = await updatePerson(form({
      personId: String(aliceId), name: 'Alice', email: 'bob@example.com', notes: '',
    }));
    expect(res.error).toContain('Bob Miller');
    const after = await prisma.person.findUniqueOrThrow({ where: { id: aliceId } });
    expect(after.email).toBe('alice@old.example'); // unchanged
  });

  // Saving a form you did not edit must not be an error just because the address in it
  // is already yours.
  it('lets a person keep their own address', async () => {
    const res = await updatePerson(form({
      personId: String(bobId), name: 'Bob M.', email: 'bob@example.com', notes: '',
    }));
    expect(res.error).toBeUndefined();
    expect((await prisma.person.findUniqueOrThrow({ where: { id: bobId } })).name).toBe('Bob M.');
  });

  it('rejects a malformed address at the boundary instead of writing it', async () => {
    const res = await updatePerson(form({
      personId: String(aliceId), name: 'Alice', email: 'not-an-address', notes: '',
    }));
    expect(res.error).toBeTruthy();
    expect((await prisma.person.findUniqueOrThrow({ where: { id: aliceId } })).email).toBe('alice@old.example');
  });
});
