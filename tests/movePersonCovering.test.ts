/** @jest-environment node */
// autoknow-pvn (#127 E14 follow-on). The move used to close the OPEN period
// rather than the period COVERING the move date. The two coincide only while nothing is
// scheduled and nothing is backdated past an existing period — so every case below is a
// career where they DIVERGE, and each one asserts the shape of the whole timeline
// afterwards rather than just the row that changed. An assertion on one row cannot see
// the second period the old rule left overlapping it, which is exactly how this survived.
//
// Against a real database, like tests/profilesAsOf.test.ts, because the selection is a
// SQL predicate (`asOfWhere`) and a JS-level test of the rule would pass while the query
// returned the wrong rows.
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

// Dynamic import AFTER the env assignment above — a static import is hoisted and would
// evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type PeopleActions = typeof import('../src/app/actions/people');
let revisePerson: PeopleActions['revisePerson'];

// Dates are stated as offsets from TODAY, never as literals, because the action asks
// `coversDay` against the wall clock — a fixture with a hard-coded 2026 date stops
// testing "a move already scheduled" the day that date goes past (docs/knowledge:
// a-literal-future-date-in-a-fixture-expires). Offsets stay far from ±1 day so nothing
// here can flip at UTC midnight mid-run.
const isoDay = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
/** The instant an `<input type="date">` posting `isoDay(n)` coerces to — so a fixture
 *  boundary and a move date written with the same offset are EXACTLY equal. */
const utcMidnight = (offset: number) => new Date(`${isoDay(offset)}T00:00:00.000Z`);

let bosch: number;
let google: number;
let honda: number;
let toyota: number;
let personId: number;

const named: Record<number, string> = {};

/** The whole career, oldest first, as `[company, from, to]` — the shape a reader of the
 *  History table would see. Comparing timelines, not rows. */
async function timeline() {
  const rows = await prisma.personAffiliation.findMany({
    where: { personId },
    orderBy: { startDate: 'asc' },
  });
  return rows.map((r) => [
    named[r.partnerId],
    r.startDate.toISOString().slice(0, 10),
    r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
  ]);
}

async function currentPartnerName() {
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: personId },
    include: { currentPartner: { select: { name: true } } },
  });
  return person.currentPartner.name;
}

const move = async (partnerId: number, offset: number) => {
  const f = new FormData();
  f.append('personId', String(personId));
  // The whole record rides the form since #127 E14 folded the Move dialog into the one
  // editor; name and address are her current ones, so this submit changes only the job.
  f.append('name', 'Alice Waters');
  f.append('email', 'alice.waters@example.com');
  f.append('partnerId', String(partnerId));
  f.append('role', 'Cockpit Platform Lead');
  f.append('effectiveDate', isoDay(offset));
  const result = await revisePerson(f);
  expect(result.error).toBeUndefined();
};

/** Lay down a career from scratch: `[partnerId, startOffset, endOffset|null]`. */
async function career(...periods: [number, number, number | null][]) {
  await prisma.personAffiliation.deleteMany({ where: { personId } });
  for (const [partnerId, start, end] of periods) {
    await prisma.personAffiliation.create({
      data: {
        personId, partnerId, role: 'Engineer',
        startDate: utcMidnight(start),
        endDate: end === null ? null : utcMidnight(end),
      },
    });
  }
}

beforeAll(async () => {
  ({ revisePerson } = await import('../src/app/actions/people'));
  await wipeAll();

  const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
  const mk = async (name: string) => {
    const p = await prisma.partner.create({ data: { name, region } });
    named[p.id] = name;
    return p.id;
  };
  bosch = await mk('Bosch');
  google = await mk('Google LLC');
  honda = await mk('Honda');
  toyota = await mk('Toyota');

  personId = (await prisma.person.create({
    data: { name: 'Alice Waters', email: 'alice.waters@example.com', currentPartnerId: bosch },
  })).id;
});

// Each test lays down its own career and moves the same person, so the cache has to be
// put back too — otherwise the second test inherits the first one's employer.
beforeEach(async () => {
  await prisma.person.update({ where: { id: personId }, data: { currentPartnerId: bosch } });
});

afterAll(async () => {
  // Leave the shared database as we found it (AGENTS lesson 9): a fixture that only
  // cleans up on the way IN donates an order-dependence to every suite that counts rows.
  await wipeAll();
  await disconnectTestDb();
});

describe('a dated change closes the period COVERING its effective date', () => {
  // The bead's own scenario. Google runs until a move to Honda already recorded for
  // +100d. Under "close the open period" the Honda row — the one that has not started —
  // was closed today and Google was left running to +100d, so today had TWO employers.
  it('with a move already scheduled, closes today\'s period and leaves the scheduled one alone', async () => {
    await career([google, -500, 100], [honda, 100, null]);

    await move(toyota, 0);

    expect(await timeline()).toEqual([
      ['Google LLC', isoDay(-500), isoDay(0)], // closed AT the move, not at +100
      ['Toyota', isoDay(0), isoDay(100)], // bounded by the move that follows it
      ['Honda', isoDay(100), null], // untouched: the user did not cancel it
    ]);
    expect(await currentPartnerName()).toBe('Toyota');
  });

  // BEFORE ANY PERIOD. There is nothing covering the move date, which is not an error —
  // it is a hire being backdated in. The old rule closed the open period at a date
  // BEFORE that period's own start, producing `end < start`.
  it('backdated before the whole career, opens a prefix and closes nothing', async () => {
    await career([bosch, -100, null]);

    await move(honda, -300);

    expect(await timeline()).toEqual([
      ['Honda', isoDay(-300), isoDay(-100)], // ends where the career already began
      ['Bosch', isoDay(-100), null], // still the job held today
    ]);
    // The move's date has arrived, but the period it opened ENDED 100 days ago — that is
    // the difference between `hasTakenEffect(startDate)` and `coversDay(the new period)`.
    expect(await currentPartnerName()).toBe('Bosch');
  });

  // INTO A GAP, with a move scheduled after it. Nothing covers the move date, and the
  // period the old rule reached for is the one that has not started yet.
  it('backdated into a gap, fills the gap without disturbing a scheduled move', async () => {
    await career([bosch, -400, -200], [honda, 100, null]);

    await move(toyota, -50);

    expect(await timeline()).toEqual([
      ['Bosch', isoDay(-400), isoDay(-200)],
      ['Toyota', isoDay(-50), isoDay(100)], // the gap stays a gap; the new period is bounded
      ['Honda', isoDay(100), null],
    ]);
    expect(await currentPartnerName()).toBe('Toyota');
  });

  // ON A BOUNDARY, both senses at once. The move date is the START of the Honda period
  // and the END of the Google one. Half-open: the boundary belongs to the period
  // starting there, so Honda is the covering period and Google is not touched. Closing
  // Honda at its own start would leave `[+100, +100)` — a period containing no day —
  // so it is deleted instead, and re-recording a move reads as CORRECTING it.
  it('dated exactly on a period\'s start, replaces it rather than leaving an empty row', async () => {
    await career([google, -500, 100], [honda, 100, null]);

    await move(toyota, 100);

    expect(await timeline()).toEqual([
      ['Google LLC', isoDay(-500), isoDay(100)], // the period ENDING that day is left alone
      ['Toyota', isoDay(100), null], // Honda is gone, not zero-length
    ]);
    // Still a future-dated move: recording it must not apply it (#124 Class 1).
    expect(await currentPartnerName()).toBe('Bosch');
  });

  // OVERLAPPING INPUT (autoknow-2of). Nothing in the schema prevents two periods
  // covering one day, and the affiliations API can still author it. A move ends ALL of
  // them, which heals the overlap; the old rule ended only the open one and left the
  // other running straight through the new period.
  it('with an overlap already on the books, closes every covering period', async () => {
    await career([bosch, -400, 100], [google, -200, null]);

    await move(honda, 0);

    expect(await timeline()).toEqual([
      ['Bosch', isoDay(-400), isoDay(0)],
      ['Google LLC', isoDay(-200), isoDay(0)],
      ['Honda', isoDay(0), null],
    ]);
    expect(await currentPartnerName()).toBe('Honda');
  });

  // The ordinary case, which must keep working: one open period, moving forward.
  it('with nothing scheduled, still closes the open period at the move date', async () => {
    await career([bosch, -400, null]);

    await move(honda, -30);

    expect(await timeline()).toEqual([
      ['Bosch', isoDay(-400), isoDay(-30)],
      ['Honda', isoDay(-30), null],
    ]);
    expect(await currentPartnerName()).toBe('Honda');
  });
});
