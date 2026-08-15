/** @jest-environment node */
// autoknow-6ls — renaming a user template. `ProgramTemplate` is `@@unique([name,
// isBuiltIn])`, and this is the third writer of that column; the other two
// (`createTemplate`, `cloneTemplate`) name rows from a CONSTANT and so correctly pick
// the next free name via `firstFreeTemplateName`. This one takes the name the user
// TYPED, so the same treatment would save something other than what they asked for.
// It therefore has to REFUSE, by name — and refuse by returning, because a throw out of
// a server action becomes the route error boundary and takes the half-written
// description on the same form with it.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev' })),
  getAccessToken: jest.fn(async () => null),
}));

// Dynamic import AFTER the env assignment above — a static import is hoisted and would
// evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
let updateTemplateMeta: typeof import('../src/app/actions/templates').updateTemplateMeta;

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

let mineId: number;
let otherId: number;

beforeAll(async () => {
  ({ updateTemplateMeta } = await import('../src/app/actions/templates'));
  await wipeAll();
  mineId = (await prisma.programTemplate.create({ data: { name: 'Digital Key' } })).id;
  otherId = (await prisma.programTemplate.create({ data: { name: 'AAOS bring-up' } })).id;
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

describe('updateTemplateMeta', () => {
  it('renames to a free name', async () => {
    await expect(
      updateTemplateMeta(form({ id: String(mineId), name: 'Digital Key v2', description: 'notes' })),
    ).resolves.toEqual({});
    const row = await prisma.programTemplate.findUniqueOrThrow({ where: { id: mineId } });
    expect(row.name).toBe('Digital Key v2');
    expect(row.description).toBe('notes');
  });

  it('refuses a name another template already holds, and NAMES it', async () => {
    const result = await updateTemplateMeta(form({ id: String(mineId), name: 'AAOS bring-up' }));
    // The conflicting name is in the sentence: the author has to be able to find the
    // other row and decide, which is exactly what silently renumbering would deny them.
    expect(result.error).toContain('AAOS bring-up');
    expect(result.error).toMatch(/already exists/);
    // And nothing moved — including the OTHER row, which a renumbering fix could touch.
    expect((await prisma.programTemplate.findUniqueOrThrow({ where: { id: mineId } })).name)
      .toBe('Digital Key v2');
    expect((await prisma.programTemplate.findUniqueOrThrow({ where: { id: otherId } })).name)
      .toBe('AAOS bring-up');
  });

  it('refuses an empty name rather than saving a nameless template', async () => {
    const result = await updateTemplateMeta(form({ id: String(mineId), name: '   ' }));
    expect(result.error).toMatch(/name is required/i);
  });

  it('refuses a built-in, which is clone-only', async () => {
    const builtIn = await prisma.programTemplate.create({
      data: { name: 'Reference chain', isBuiltIn: true },
    });
    const result = await updateTemplateMeta(form({ id: String(builtIn.id), name: 'Mine now' }));
    expect(result.error).toMatch(/clone-only/);
    expect((await prisma.programTemplate.findUniqueOrThrow({ where: { id: builtIn.id } })).name)
      .toBe('Reference chain');
  });

  it('refuses an id that is not a number', async () => {
    expect(await updateTemplateMeta(form({ id: 'nope', name: 'x' }))).toEqual({ error: 'Invalid template' });
  });
});
