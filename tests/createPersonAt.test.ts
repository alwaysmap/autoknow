/** @jest-environment node */
// #127 E5. Creating a person also OPENS their employment period — the seam this bead
// moved, and the one most likely to surprise someone, because `POST /api/people` gained
// a side effect its request body does not obviously describe.
//
// Why it needs a test at all: while `currentPartnerId` was what surfaces displayed, a
// person with no affiliation looked completely normal. Now the affiliation is the answer,
// so a creation path that skips it produces a person with no company anywhere — which is
// exactly the state the API route was in, silently, until this change.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));

// Dynamic import AFTER the env assignment above (docs/knowledge).
let createPersonAt: typeof import('../src/lib/profiles')['createPersonAt'];
let profileAsOf: typeof import('../src/lib/profiles')['profileAsOf'];
let POST: typeof import('../src/app/api/people/route')['POST'];

let bosch: number;
let google: number;

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const postPerson = (body: unknown) =>
  POST(
    new Request('http://localhost/api/people', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  ({ createPersonAt, profileAsOf } = await import('../src/lib/profiles'));
  ({ POST } = await import('../src/app/api/people/route'));
  await wipeAll();
  const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
  bosch = (await prisma.partner.create({ data: { name: 'Bosch', region } })).id;
  google = (await prisma.partner.create({ data: { name: 'Google LLC', region } })).id;
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

describe('createPersonAt', () => {
  it('opens the employment period, so the person has a company the day they exist', async () => {
    const p = await createPersonAt({
      name: 'Ada Lovelace', email: 'ada@example.com', partnerId: bosch,
      role: 'Principal Engineer', startDate: d('2020-01-01'),
    });
    const at = await profileAsOf(p.id);
    expect(at?.partnerId).toBe(bosch);
    expect(at?.role).toBe('Principal Engineer');
  });

  it('defaults to Member from today, which is all a caller who knows only the company can say', async () => {
    const p = await createPersonAt({ name: 'Grace H', email: 'grace@example.com', partnerId: google });
    const at = await profileAsOf(p.id);
    expect(at?.partnerId).toBe(google);
    expect(at?.role).toBe('Member');
  });

  it('creates the person and the period as ONE write, so neither can exist alone', async () => {
    // A duplicate email fails the unique constraint. If this were two statements the
    // affiliation could still land (or the person could), leaving the orphan the whole
    // function exists to prevent.
    const before = await prisma.personAffiliation.count();
    await expect(
      createPersonAt({ name: 'Ada Again', email: 'ada@example.com', partnerId: google }),
    ).rejects.toThrow();
    expect(await prisma.personAffiliation.count()).toBe(before);
  });
});

describe('POST /api/people', () => {
  it('opens a period too — the route and the server action agree', async () => {
    const res = await postPerson({
      name: 'Alan Turing', email: 'alan@example.com', currentPartnerId: bosch,
      role: 'Cryptanalyst', startDate: '2019-06-01',
    });
    expect(res.status).toBe(201);
    const { person } = (await res.json()) as { person: { id: number } };

    // Asked as-of a day inside the stated period, not just "today": the route must have
    // honoured startDate rather than stamping now.
    const at = await profileAsOf(person.id, d('2019-07-01'));
    expect(at?.partnerId).toBe(bosch);
    expect(at?.role).toBe('Cryptanalyst');
  });

  it('still accepts the minimal body — role and startDate are optional', async () => {
    const res = await postPerson({
      name: 'Katherine J', email: 'katherine@example.com', currentPartnerId: google,
    });
    expect(res.status).toBe(201);
    const { person } = (await res.json()) as { person: { id: number } };
    expect((await profileAsOf(person.id))?.partnerId).toBe(google);
  });
});
