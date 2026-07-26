/** @jest-environment node */
// #127 E5. The as-of resolvers, against a real database — because the whole point of
// them is that the predicate runs in SQL, and a JS-level test of the same rule would
// pass while the query returned the wrong rows.
//
// The fixture is one career with a scheduled move, which is the shape that breaks the
// old `where: { endDate: null }`: three settled periods and a fourth that starts in the
// future. On the day these run, exactly ONE period covers today — and it is not the open
// one.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { Prisma } from '@prisma/client';
import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));

// Dynamic import AFTER the env assignment above — a static one is hoisted and would
// evaluate src/lib/db before DATABASE_URL is set (docs/knowledge).
type Profiles = typeof import('../src/lib/profiles');
let profileAsOf: Profiles['profileAsOf'];
let profilesAsOf: Profiles['profilesAsOf'];
let partnerRosterAsOf: Profiles['partnerRosterAsOf'];
let rostersByPartnerAsOf: Profiles['rostersByPartnerAsOf'];
let personIsAtPartnerAsOfSql: Profiles['personIsAtPartnerAsOfSql'];

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Asked about a FIXED day, never `new Date()`: a resolver whose test drifts with the
 *  clock stops being a test on the day the clock crosses one of these boundaries. */
const TODAY = d('2026-07-26');

let alice: number;
let bob: number;
let bosch: number;
let google: number;
let honda: number;

beforeAll(async () => {
  ({ profileAsOf, profilesAsOf, partnerRosterAsOf, rostersByPartnerAsOf, personIsAtPartnerAsOfSql } =
    await import('../src/lib/profiles'));
  await wipeAll();

  const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
  const mk = async (name: string) => (await prisma.partner.create({ data: { name, region } })).id;
  bosch = await mk('Bosch');
  google = await mk('Google LLC');
  honda = await mk('Honda');

  const person = async (name: string, email: string, currentPartnerId: number) =>
    (await prisma.person.create({ data: { name, email, currentPartnerId } })).id;
  alice = await person('Alice Waters', 'alice@example.com', google);
  // A second person at Google today, so the roster has someone to be right about
  // besides Alice — a one-row roster passes for the wrong reason.
  bob = await person('Bob Miller', 'bob@example.com', google);

  const period = (personId: number, partnerId: number, role: string, start: string, end: string | null) =>
    prisma.personAffiliation.create({
      data: { personId, partnerId, role, startDate: d(start), endDate: end ? d(end) : null },
    });
  // Alice: contiguous and half-open, with Honda genuinely ahead of today.
  await period(alice, bosch, 'Platform Engineer', '2022-01-01', '2024-03-01');
  await period(alice, google, 'Lead Program Manager', '2024-03-01', '2026-11-01');
  await period(alice, honda, 'Cockpit Platform Lead', '2026-11-01', null);
  await period(bob, google, 'Staff Engineer', '2025-01-01', null);
});

afterAll(async () => {
  // Leave the shared database as we found it: a fixture that only cleans up on the way
  // IN donates an order-dependence to every suite that asserts an exact row count —
  // seedMock's `expect(await prisma.partner.count()).toBe(15)` is three short of true
  // with our partners still sitting there.
  await wipeAll();
  await disconnectTestDb();
});

describe('profileAsOf', () => {
  it('returns the period containing the day, not the open one', async () => {
    const now = await profileAsOf(alice, TODAY);
    expect(now?.partnerId).toBe(google);
    expect(now?.role).toBe('Lead Program Manager');
  });

  it('reads history by moving the day, which is the point of taking one', async () => {
    expect((await profileAsOf(alice, d('2023-06-01')))?.partnerId).toBe(bosch);
    expect((await profileAsOf(alice, d('2027-01-01')))?.partnerId).toBe(honda);
  });

  // Half-open: the period ENDING that day has already handed over.
  it('hands over on the boundary date itself', async () => {
    expect((await profileAsOf(alice, d('2024-02-29')))?.partnerId).toBe(bosch);
    expect((await profileAsOf(alice, d('2024-03-01')))?.partnerId).toBe(google);
  });

  it('answers null before the career starts — a gap is a real answer, not a fallback', async () => {
    expect(await profileAsOf(alice, d('2020-01-01'))).toBeNull();
  });
});

describe('profilesAsOf', () => {
  it('keys one query by person, and picks the same period profileAsOf would', async () => {
    const map = await profilesAsOf([alice, bob], TODAY);
    expect(map.get(alice)?.role).toBe('Lead Program Manager');
    expect(map.get(bob)?.role).toBe('Staff Engineer');
  });

  it('omits a person with no period that day rather than inventing one', async () => {
    const map = await profilesAsOf([alice, bob], d('2020-01-01'));
    expect(map.has(alice)).toBe(false);
    expect(map.has(bob)).toBe(false);
  });

  it('takes an empty list without touching the database', async () => {
    expect((await profilesAsOf([], TODAY)).size).toBe(0);
  });
});

describe('partnerRosterAsOf', () => {
  // The old `where: { endDate: null }` was wrong in BOTH directions here, which is why
  // both are asserted: Alice belongs on Google's roster today and must NOT be on
  // Honda's, even though Honda is the only partner her open period names.
  it('lists who is there on the day', async () => {
    const roster = await partnerRosterAsOf(google, TODAY);
    expect(roster.map((r) => r.person.name)).toEqual(['Alice Waters', 'Bob Miller']);
  });

  it('does not list someone whose period there has not begun', async () => {
    expect(await partnerRosterAsOf(honda, TODAY)).toEqual([]);
  });

  it('lists them once it has', async () => {
    const roster = await partnerRosterAsOf(honda, d('2027-01-01'));
    expect(roster.map((r) => r.person.name)).toEqual(['Alice Waters']);
  });

  it('drops someone whose period there has ended', async () => {
    expect(await partnerRosterAsOf(bosch, TODAY)).toEqual([]);
    expect((await partnerRosterAsOf(bosch, d('2023-06-01'))).map((r) => r.person.name))
      .toEqual(['Alice Waters']);
  });
});

describe('rostersByPartnerAsOf', () => {
  // Must agree with the singular and must drop leavers — the two properties
  // `getAllPartners` needs and its predecessor had neither of (see partnerQueries).
  it('gives each partner the same roster the singular would', async () => {
    const all = await rostersByPartnerAsOf(TODAY);
    expect(all.get(google)?.map((p) => p.name)).toEqual(['Alice Waters', 'Bob Miller']);
    const single = await partnerRosterAsOf(google, TODAY);
    expect(all.get(google)?.map((p) => p.id)).toEqual(single.map((r) => r.person.id));
  });

  it('drops a leaver rather than keeping them forever', async () => {
    // Alice left Bosch in 2024; the old union listed her there permanently.
    expect((await rostersByPartnerAsOf(TODAY)).has(bosch)).toBe(false);
    expect((await rostersByPartnerAsOf(d('2023-06-01'))).get(bosch)?.map((p) => p.name))
      .toEqual(['Alice Waters']);
  });

  it('omits a partner nobody is at that day rather than mapping it to []', async () => {
    // Same contract as profilesAsOf: callers default, they do not distinguish two empties.
    expect((await rostersByPartnerAsOf(TODAY)).has(honda)).toBe(false);
  });
});

describe('personIsAtPartnerAsOfSql', () => {
  // lib/search's UNION is hand-written SQL and cannot call the Prisma resolvers, so this
  // is the same sentence rendered as a predicate. It must agree with them: a column name
  // inside a template literal is just text, so no AST rule can catch a drift here — this
  // test is the only thing that can.
  const at = async (partnerId: number, day: Date) =>
    (
      await prisma.$queryRaw<{ id: number; name: string }[]>`
        SELECT pe.id, pe.name FROM "Person" pe
        WHERE ${personIsAtPartnerAsOfSql(Prisma.sql`pe.id`, partnerId, day)}
        ORDER BY pe.name ASC`
    ).map((r) => r.name);

  it('agrees with partnerRosterAsOf on who is there today', async () => {
    expect(await at(google, TODAY)).toEqual(['Alice Waters', 'Bob Miller']);
  });

  it('excludes the partner someone has not started at, and the one they left', async () => {
    expect(await at(honda, TODAY)).toEqual([]);
    expect(await at(bosch, TODAY)).toEqual([]);
  });

  it('moves with the day, which is why it takes one', async () => {
    expect(await at(honda, d('2027-01-01'))).toEqual(['Alice Waters']);
    expect(await at(bosch, d('2023-06-01'))).toEqual(['Alice Waters']);
  });
});
