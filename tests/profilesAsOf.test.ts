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

// The JS twin, imported statically: it is pure and touches no database, so it needs
// none of the dynamic-import dance below.
import { coversDay } from '../src/lib/people';

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
let carla: number;
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
  // Bosch's third body, so that on ONE day (2021-09-01) Bosch has a leaver, a sitting
  // employee and a hire who has not arrived — the three-bucket case #127 E12 renders,
  // which no partner in the two-person fixture could produce.
  carla = await person('Carla Nunes', 'carla@example.com', bosch);

  const period = (personId: number, partnerId: number, role: string, start: string, end: string | null) =>
    prisma.personAffiliation.create({
      data: { personId, partnerId, role, startDate: d(start), endDate: end ? d(end) : null },
    });
  // Alice: contiguous and half-open, with Honda genuinely ahead of today.
  await period(alice, bosch, 'Platform Engineer', '2022-01-01', '2024-03-01');
  await period(alice, google, 'Lead Program Manager', '2024-03-01', '2026-11-01');
  await period(alice, honda, 'Cockpit Platform Lead', '2026-11-01', null);
  await period(bob, google, 'Staff Engineer', '2025-01-01', null);
  // Both closed well before today, so every "nobody is at Bosch now" assertion below
  // still means what it did — and Bob's is a genuine GAP before Google, which the spec
  // calls legal (#124 §2), not an oversight.
  await period(bob, bosch, 'Firmware Engineer', '2020-06-01', '2021-01-01');
  await period(carla, bosch, 'Toolchain Lead', '2021-06-01', '2023-01-01');
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

// autoknow-yid. The two sanctioned as-of spellings used to compare at DIFFERENT
// granularities — `asOfWhere` on raw instants, `coversDay` on UTC days — so a period
// whose boundary carried a clock time answered differently depending on which one asked.
// /people/:id renders BOTH, so the disagreement was visible on one screen: the identity
// line blank while the feed and the Programs table named the new employer.
//
// The fixture is deliberately the awkward shape: a period starting at 09:30 rather than
// at midnight. Every date surface writes midnight today, which is exactly why this has
// to be authored by hand — the bug is invisible on the data the app produces and waits
// for the first row that comes from anywhere else (an import, a backfill, a fixture).
describe('the two as-of spellings agree on a boundary day (autoknow-yid)', () => {
  let mika: number;
  // The handover instant, and an hour before it — both INSIDE the same UTC day. Named
  // once so the relationship is stated rather than re-derived at each assertion.
  const HANDOVER = new Date('2026-07-26T09:30:00.000Z');
  const BEFORE_HANDOVER = new Date('2026-07-26T09:00:00.000Z');
  const AFTER_HANDOVER = new Date('2026-07-26T18:00:00.000Z');
  // Its OWN partners, not the shared three. The roster assertions in the describes below
  // count who is at the shared partners on a given day, so a person added to those would
  // change their answers — a fixture that edits another test's premise fails it for a
  // reason that has nothing to do with what either test is about.
  let fromCo: number;
  let toCo: number;

  beforeAll(async () => {
    const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
    fromCo = (await prisma.partner.create({ data: { name: 'Boundary From', region } })).id;
    toCo = (await prisma.partner.create({ data: { name: 'Boundary To', region } })).id;
    mika = (await prisma.person.create({
      data: { name: 'Mika Boundary', email: 'mika@example.com', currentPartnerId: fromCo },
    })).id;
    await prisma.personAffiliation.createMany({
      data: [
        { personId: mika, partnerId: fromCo, role: 'Engineer',
          startDate: d('2024-01-01'), endDate: HANDOVER },
        { personId: mika, partnerId: toCo, role: 'Lead',
          startDate: HANDOVER },
      ],
    });
  });

  // BEFORE_HANDOVER is an hour ahead of the stored instant and inside the same UTC day.
  // The old predicate said Boundary From here and Boundary To an hour later; `coversDay`
  // said Boundary To all day.
  it('SQL and JS name the same employer before the clock time on the boundary day', async () => {
    const at = BEFORE_HANDOVER;
    const sql = await profileAsOf(mika, at);
    const career = await prisma.personAffiliation.findMany({
      where: { personId: mika }, orderBy: { startDate: 'desc' },
    });
    const js = career.find((period) => coversDay(period, at));
    expect(sql?.id).toBe(js?.id);
    expect(sql?.partnerId).toBe(toCo);
  });

  it('…and after it, which is the case that already agreed', async () => {
    const at = AFTER_HANDOVER;
    expect((await profileAsOf(mika, at))?.partnerId).toBe(toCo);
  });

  it('the day BEFORE is still the old employer — the boundary moved to the day, not away', async () => {
    expect((await profileAsOf(mika, d('2026-07-25')))?.partnerId).toBe(fromCo);
  });

  // The roster buckets are the same rule one level up, and they used to carry the
  // instant spelling on purpose to match `asOfWhere`. They must move together.
  it('the roster buckets this person on the same day the resolvers do', async () => {
    const at = BEFORE_HANDOVER;
    const roster = await partnerRosterAsOf(toCo, at);
    expect(roster.current.map((r) => r.personId)).toContain(mika);
    expect(roster.incoming.map((r) => r.personId)).not.toContain(mika);
    expect((await partnerRosterAsOf(fromCo, at)).past.map((r) => r.personId)).toContain(mika);
  });

  it('the raw-SQL spelling agrees with the Prisma one, which is why both exist', async () => {
    const at = BEFORE_HANDOVER;
    const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT p.id FROM "Person" p
      WHERE ${personIsAtPartnerAsOfSql(Prisma.sql`p.id`, toCo, at)} AND p.id = ${mika}`);
    expect(rows.map((r) => r.id)).toEqual([mika]);
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
  const names = (rows: { person: { name: string } }[]) => rows.map((r) => r.person.name);

  // The old `where: { endDate: null }` was wrong in BOTH directions here, which is why
  // both are asserted: Alice belongs on Google's roster today and must NOT be on
  // Honda's, even though Honda is the only partner her open period names.
  it('lists who is there on the day', async () => {
    expect(names((await partnerRosterAsOf(google, TODAY)).current))
      .toEqual(['Alice Waters', 'Bob Miller']);
  });

  it('does not list someone whose period there has not begun as CURRENT', async () => {
    expect((await partnerRosterAsOf(honda, TODAY)).current).toEqual([]);
  });

  it('lists them once it has', async () => {
    expect(names((await partnerRosterAsOf(honda, d('2027-01-01'))).current))
      .toEqual(['Alice Waters']);
  });

  it('drops someone whose period there has ended', async () => {
    expect((await partnerRosterAsOf(bosch, TODAY)).current).toEqual([]);
    expect(names((await partnerRosterAsOf(bosch, d('2023-06-01'))).current))
      .toEqual(['Alice Waters']);
  });

  // ---- The two buckets the predecessor could not express at all (#127 E12) ----

  it('files a departed person under past, carrying the date they left', async () => {
    const roster = await partnerRosterAsOf(bosch, TODAY);
    expect(names(roster.past)).toEqual(['Alice Waters', 'Bob Miller', 'Carla Nunes']);
    expect(roster.past.find((r) => r.person.name === 'Alice Waters')?.endDate)
      .toEqual(d('2024-03-01'));
  });

  it('files a future hire under incoming, carrying the date they arrive — never current', async () => {
    const roster = await partnerRosterAsOf(honda, TODAY);
    expect(names(roster.incoming)).toEqual(['Alice Waters']);
    expect(roster.incoming[0].startDate).toEqual(d('2026-11-01'));
    expect(roster.current).toEqual([]);
    expect(roster.past).toEqual([]);
  });

  // One day, one partner, all three buckets — the surface E12 renders, and the only
  // arrangement in which a bucket can steal a row from its neighbour.
  it('splits one partner three ways on a single day', async () => {
    const roster = await partnerRosterAsOf(bosch, d('2021-09-01'));
    expect(names(roster.past)).toEqual(['Bob Miller']);
    expect(names(roster.current)).toEqual(['Carla Nunes']);
    expect(names(roster.incoming)).toEqual(['Alice Waters']);
  });

  // Half-open, on both edges: the day a period ENDS it is already past, and the day one
  // STARTS it is already current. An off-by-one here is a person shown at the wrong
  // company for a day, which is exactly what #124 §4's interval table exists to prevent.
  it('turns over on the boundary day itself, at both ends', async () => {
    expect(names((await partnerRosterAsOf(bosch, d('2024-02-29'))).current)).toEqual(['Alice Waters']);
    expect(names((await partnerRosterAsOf(bosch, d('2024-03-01'))).past)).toContain('Alice Waters');
    expect(names((await partnerRosterAsOf(honda, d('2026-10-31'))).incoming)).toEqual(['Alice Waters']);
    expect(names((await partnerRosterAsOf(honda, d('2026-11-01'))).current)).toEqual(['Alice Waters']);
  });

  it('puts every affiliation in exactly one bucket, and loses none', async () => {
    const roster = await partnerRosterAsOf(bosch, d('2021-09-01'));
    const total = roster.current.length + roster.past.length + roster.incoming.length;
    expect(total).toBe(await prisma.personAffiliation.count({ where: { partnerId: bosch } }));
  });

  // The current bucket is decided in JS while `profileAsOf` decides the same sentence in
  // SQL, and nothing static can compare two renderings of one rule — the same hole
  // `personIsAtPartnerAsOfSql` has, closed the same way.
  it('agrees with profileAsOf about who is at the partner, on every day tried', async () => {
    for (const day of [d('2021-09-01'), d('2023-06-01'), TODAY, d('2027-01-01')]) {
      const bucketed = (await partnerRosterAsOf(bosch, day)).current.map((r) => r.personId).sort();
      const resolved: number[] = [];
      for (const personId of [alice, bob, carla]) {
        if ((await profileAsOf(personId, day))?.partnerId === bosch) resolved.push(personId);
      }
      expect(bucketed).toEqual(resolved.sort());
    }
  });
});

describe('rostersByPartnerAsOf', () => {
  // Must agree with the singular and must drop leavers — the two properties
  // `getAllPartners` needs and its predecessor had neither of (see partnerQueries).
  it('gives each partner the same roster the singular would', async () => {
    const all = await rostersByPartnerAsOf(TODAY);
    expect(all.get(google)?.map((p) => p.name)).toEqual(['Alice Waters', 'Bob Miller']);
    const single = await partnerRosterAsOf(google, TODAY);
    expect(all.get(google)?.map((p) => p.id)).toEqual(single.current.map((r) => r.person.id));
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
