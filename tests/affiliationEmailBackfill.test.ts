/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Dynamic import AFTER the env assignment above — a static import is hoisted and would
// evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type BackfillLib = typeof import('../src/lib/affiliationEmailBackfill');
let backfillAffiliationEmail: BackfillLib['backfillAffiliationEmail'];

// #127 E8. The backfill copies `Person.email` onto the ONE employment period that
// covers the run instant, because that is the only period the address demonstrably
// belongs to. Everything interesting is at the edges: a career with no period covering
// today, and a career with two, are both left NULL and reported — never guessed at,
// because a wrong address is a permanent, silent mis-resolution of every artifact that
// quotes it, and NULL simply means "not recorded".
describe('backfillAffiliationEmail', () => {
  const partner: Record<string, number> = {};
  const person: Record<string, number> = {};

  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  // A fixed instant to resolve "today" against, so the fixture's dates are literal and
  // this suite does not start failing on a calendar boundary.
  const NOW = new Date('2026-07-26T12:00:00.000Z');

  /** A person plus their career, written directly: these are the shapes that PREDATE
   *  the column, so they must not come from `createPersonAt` — which stamps the address
   *  on the way in and would leave nothing for the backfill to find.
   *
   *  `currentPartnerId` takes the LAST period's partner. It is a required FK and nothing
   *  under test reads it (ADR currentpartnerid-is-a-cache-affiliations-are-the-truth);
   *  the last period is simply the least misleading value to park there. */
  const newPerson = async (
    key: string,
    email: string,
    periods: { at: string; role?: string; start: string; end?: string; email?: string }[],
  ) => {
    const row = await prisma.person.create({
      data: {
        name: key,
        email,
        currentPartnerId: partner[periods[periods.length - 1].at],
        affiliations: {
          create: periods.map((p) => ({
            partnerId: partner[p.at],
            role: p.role ?? 'Member',
            startDate: day(p.start),
            endDate: p.end ? day(p.end) : null,
            email: p.email ?? null,
          })),
        },
      },
    });
    person[key] = row.id;
  };

  beforeAll(async () => {
    ({ backfillAffiliationEmail } = await import('../src/lib/affiliationEmailBackfill'));
    await wipeAll();

    for (const name of ['google', 'bosch', 'qualcomm']) {
      partner[name] = (await prisma.partner.create({
        data: {
          name,
          type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
          region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
        },
      })).id;
    }

    // The ordinary case, and the fixture the whole epic is demonstrated on: a career
    // whose current period is open-ended, with two closed ones behind it.
    await newPerson('alice', 'alice.waters@google.com', [
      { at: 'bosch', start: '2022-01-01', end: '2024-03-01' },
      { at: 'qualcomm', start: '2024-03-01', end: '2026-07-01' },
      { at: 'google', start: '2026-07-01' },
    ]);
    // A closed current period — covering today by its RANGE, not by being open. The
    // distinction is the whole of #124 Class 1, and it must hold here too.
    await newPerson('bruno', 'bruno@bosch.com', [
      { at: 'bosch', start: '2025-01-01', end: '2027-01-01' },
    ]);
    // Nobody covers today: she left in 2025 and starts somewhere new in 2027.
    await newPerson('carla', 'carla@qualcomm.com', [
      { at: 'qualcomm', start: '2023-01-01', end: '2025-06-01' },
      { at: 'google', start: '2027-01-01' },
    ]);
    // Two periods cover today — overlapping data (autoknow-2of), not a career.
    await newPerson('dan', 'dan@google.com', [
      { at: 'google', start: '2024-01-01' },
      { at: 'bosch', start: '2025-01-01' },
    ]);
    // The covering period already carries an address (what `createPersonAt` produces),
    // and a historical one does not. Deliberately an address the Person row does NOT
    // hold, so a run that overwrote instead of skipping could not hide behind equality.
    await newPerson('erin', 'erin@google.com', [
      { at: 'bosch', start: '2021-01-01', end: '2024-01-01' },
      { at: 'google', start: '2024-01-01', email: 'erin.older@google.com' },
    ]);
  });

  afterAll(async () => {
    await wipeAll();
    await disconnectTestDb();
  });

  const periodsOf = async (key: string) =>
    prisma.personAffiliation.findMany({
      where: { personId: person[key] },
      select: { email: true, startDate: true },
      orderBy: { startDate: 'asc' },
    });

  // MUST be the first backfill in this file — `linked` and `scanned` are first-run
  // numbers, and every later `it` runs the backfill again.
  it('writes the current address to the ONE period covering today, and to no other', async () => {
    const report = await backfillAffiliationEmail(NOW);

    // Bosch and Qualcomm stay NULL: nothing anywhere records what she used then, and
    // deriving something plausible is exactly the guess this refuses to make.
    expect((await periodsOf('alice')).map((p) => p.email))
      .toEqual([null, null, 'alice.waters@google.com']);
    expect(report.linked).toBe(2); // alice + bruno
    expect(report.scanned).toBe(5);
    expect(report.alreadyRecorded).toBe(1); // erin
  });

  it('selects the covering period by its RANGE, not by being open-ended', async () => {
    await backfillAffiliationEmail(NOW);
    // Bruno's only period ends in 2027 — closed, and current.
    expect((await periodsOf('bruno')).map((p) => p.email)).toEqual(['bruno@bosch.com']);
  });

  it('leaves a career with NO period covering today alone, and names it', async () => {
    const report = await backfillAffiliationEmail(NOW);

    expect((await periodsOf('carla')).map((p) => p.email)).toEqual([null, null]);
    expect(report.uncovered.map((r) => r.id)).toContain(person.carla);
    expect(report.uncovered.find((r) => r.id === person.carla)?.email)
      .toBe('carla@qualcomm.com');
  });

  it('leaves OVERLAPPING periods alone rather than picking one, and names both', async () => {
    const report = await backfillAffiliationEmail(NOW);

    expect((await periodsOf('dan')).map((p) => p.email)).toEqual([null, null]);
    const row = report.ambiguous.find((r) => r.id === person.dan);
    expect(row?.periods.map((p) => p.partner).sort()).toEqual(['bosch', 'google']);
  });

  it('never overwrites a period that already carries an address', async () => {
    await backfillAffiliationEmail(NOW);
    // Still the older address, not the one on the Person row — a recorded address is
    // the answer, and this script is not an editor.
    expect((await periodsOf('erin')).map((p) => p.email))
      .toEqual([null, 'erin.older@google.com']);
  });

  it('counts the periods it deliberately left NULL, so the hole is a number', async () => {
    const report = await backfillAffiliationEmail(NOW);
    // alice ×2 (Bosch, Qualcomm), carla ×2, dan ×0 (both cover today, so neither is
    // history), erin ×1 (Bosch). Dan's two are reported as ambiguous instead.
    expect(report.unrecordedHistory).toBe(5);
  });

  it('is idempotent — a second run writes nothing and changes no row', async () => {
    await backfillAffiliationEmail(NOW);
    const before = await prisma.personAffiliation.findMany({
      select: { id: true, email: true },
      orderBy: { id: 'asc' },
    });

    const second = await backfillAffiliationEmail(NOW);

    expect(second.linked).toBe(0);
    // Alice and Bruno drop out entirely once Bruno has no address-less period left;
    // Alice stays a candidate only because her history does.
    expect(second.alreadyRecorded).toBe(2); // alice + erin
    expect(
      await prisma.personAffiliation.findMany({
        select: { id: true, email: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it('picks up a career once it becomes resolvable — which is why it re-runs', async () => {
    // What an operator does with an UNCOVERED line: Carla's new job actually started,
    // so her period is corrected to have begun. The next run stamps it. No migration
    // edit, no re-deploy.
    await prisma.personAffiliation.updateMany({
      where: { personId: person.carla, startDate: day('2027-01-01') },
      data: { startDate: day('2026-01-01') },
    });

    const report = await backfillAffiliationEmail(NOW);

    expect(report.linked).toBe(1);
    expect((await periodsOf('carla')).map((p) => p.email))
      .toEqual([null, 'carla@qualcomm.com']);
    expect(report.uncovered).toEqual([]);
  });

  it('moves its target as time passes — a later run stamps the period current THEN', async () => {
    // A scheduled move, then a run after it has arrived: the backfill fills the NEW
    // period, because the address on the row is now that job's address. The as-of
    // instant is the run instant and nothing else.
    await prisma.personAffiliation.create({
      data: {
        personId: person.alice,
        partnerId: partner.bosch,
        role: 'Cockpit Platform Lead',
        startDate: day('2026-11-01'),
      },
    });
    await prisma.personAffiliation.updateMany({
      where: { personId: person.alice, startDate: day('2026-07-01') },
      data: { endDate: day('2026-11-01') },
    });

    const later = await backfillAffiliationEmail(new Date('2026-12-01T12:00:00.000Z'));

    expect(later.linked).toBe(1);
    expect((await periodsOf('alice')).map((p) => p.email))
      .toEqual([null, null, 'alice.waters@google.com', 'alice.waters@google.com']);
  });
});
