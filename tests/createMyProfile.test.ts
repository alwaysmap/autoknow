/** @jest-environment node */
// `createMyProfile` — self-provisioning from /me. It takes ONLY the organization from the
// form, unlike its sibling `createPerson`; `myProfileSchema` in lib/schemas argues why.
//
// This file is the ENFORCEMENT of that argument, which is the half prose cannot do: the
// negative case, where a form posting a name and an address must still create the
// SESSION's person, not the form's.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
// Auth UNCONFIGURED is the deterministic test posture, and it is also the only posture in
// which the `?user=` override is honoured at all — so it is the harder case to get right.
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({
    handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper', image: null,
  })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

type People = typeof import('../src/app/actions/people');
let createMyProfile: People['createMyProfile'];

let partnerId: number;

const form = (fields: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  return fd;
};

/** The action ends in `redirect()`, which works by THROWING — so a success looks like a
 *  rejection with Next's digest, and only a non-redirect throw is a real failure. */
const runToRedirect = async (fd: FormData): Promise<void> => {
  try {
    await createMyProfile(fd);
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return;
    throw e;
  }
  throw new Error('expected createMyProfile to redirect');
};

beforeAll(async () => {
  ({ createMyProfile } = await import('../src/app/actions/people'));
});

beforeEach(async () => {
  await wipeAll();
  const partner = await prisma.partner.create({
    data: {
      name: 'Rivian',
      type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
      region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
    },
  });
  partnerId = partner.id;
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('createMyProfile', () => {
  it('takes the organization from the form and the identity from the session', async () => {
    await runToRedirect(form({ partnerId }));

    const person = await prisma.person.findFirstOrThrow({});
    expect(person.email).toBe('dev@google.com');
    expect(person.name).toBe('Dev Eloper');
    expect(person.currentPartnerId).toBe(partnerId);
  });

  it('ignores a name and address posted in the form — those are the session\'s to say', async () => {
    await runToRedirect(form({
      partnerId,
      name: 'Mallory Impostor',
      email: 'mallory@evil.example',
    }));

    const person = await prisma.person.findFirstOrThrow({});
    expect(person.email).toBe('dev@google.com');
    expect(person.name).toBe('Dev Eloper');
  });

  it('requires an organization that is actually an id', async () => {
    for (const bad of ['', '0', '-2', 'nope']) {
      await expect(createMyProfile(form({ partnerId: bad }))).rejects.toThrow(/partnerId/);
    }
    expect(await prisma.person.count()).toBe(0);
  });

  it('honours the stub-mode ?user= override, which is a HANDLE, not a free-text identity', async () => {
    await runToRedirect(form({ partnerId, user: '  @kenji  ' }));

    // Trimmed by the schema, then resolved by lib/auth — the form supplies which login to
    // stand in for, never the address that login owns.
    const person = await prisma.person.findFirstOrThrow({});
    expect(person.email).toMatch(/^kenji@/);
  });
});
