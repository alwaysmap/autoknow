/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { unmanagedConstraintSql } from './helpers/provisionTestDatabases';

// Dynamic import AFTER the env assignment above — a static import is hoisted and would
// evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type RemediationLib = typeof import('../src/lib/addressConflictRemediation');
let clearConflictingAddresses: RemediationLib['clearConflictingAddresses'];
let formatAddressConflictRemediationReport: RemediationLib['formatAddressConflictRemediationReport'];
let MAX_CLEARED: RemediationLib['MAX_CLEARED'];

// The remediation arm for a conflict nothing in the app can edit — one address recorded
// against two people over overlapping time, where the losing period is CLOSED. It WRITES
// to production through the dispatch runner, so what is pinned here is the whole of the
// judgement: who wins, whose address is erased, what it refuses to touch, and that a
// second run changes nothing.
//
// EVERY FIXTURE BELOW IS WRITTEN WITH THE CONSTRAINT DROPPED, because a conflict is
// precisely what `PersonAffiliation_email_unique_at_an_instant` refuses — and that is not
// a testing trick, it is the arm's own premise: a database holding a conflict is by
// construction one the E9 migration has not reached. The constraint goes back on after
// every case, restored from the MIGRATION via the same reader that provisioned it, so the
// suites sharing this database do not inherit a silently missing guard (knowledge note
// db-push-silently-drops-constraints-prisma-cannot-express).

const CONSTRAINT = 'PersonAffiliation_email_unique_at_an_instant';

beforeAll(async () => {
  ({ clearConflictingAddresses, formatAddressConflictRemediationReport, MAX_CLEARED } =
    await import('../src/lib/addressConflictRemediation'));
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

describe('clearConflictingAddresses', () => {
  let partnerId: number;
  const person: Record<string, number> = {};
  const period: Record<string, number> = {};
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const TODAY = day('2026-07-28');

  const newPerson = async (key: string, name: string, email: string) => {
    person[key] = (await prisma.person.create({ data: { name, email, currentPartnerId: partnerId } })).id;
  };

  const newPeriod = async (
    key: string,
    personKey: string,
    start: string,
    end: string | null,
    email: string | null,
  ) => {
    period[key] = (
      await prisma.personAffiliation.create({
        data: {
          personId: person[personKey],
          partnerId,
          role: 'Member',
          startDate: day(start),
          endDate: end === null ? null : day(end),
          email,
        },
      })
    ).id;
  };

  const addressOf = async (key: string) =>
    (await prisma.personAffiliation.findUniqueOrThrow({
      where: { id: period[key] },
      select: { email: true },
    })).email;

  const everyAddress = async () =>
    prisma.personAffiliation.findMany({ select: { id: true, email: true }, orderBy: { id: 'asc' } });

  beforeEach(async () => {
    await wipeAll();
    // Dropped for the whole case: the fixtures below are rows this constraint exists to
    // keep out, and the arm's job is to clean up a database that predates it.
    await prisma.$executeRawUnsafe(`ALTER TABLE "PersonAffiliation" DROP CONSTRAINT "${CONSTRAINT}"`);
    partnerId = (
      await prisma.partner.create({
        data: {
          name: 'Google LLC',
          type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
          region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
        },
      })
    ).id;
  });

  afterEach(async () => {
    // Wipe FIRST: a case that ends with a conflict still on file (every REFUSED and every
    // UNDECIDABLE one does) would make re-adding the constraint fail, and the failure
    // would land in the next suite rather than in this one.
    await wipeAll();
    for (const sql of unmanagedConstraintSql()) await prisma.$executeRawUnsafe(sql);
  });

  /** The shape the bead describes: `tel@google.com` was Bob's, is Alice's now, and both
   *  periods recording it are CLOSED — so nothing in the app can reach either. */
  const historicalConflict = async () => {
    await newPerson('alice', 'Alice Waters', 'tel@google.com');
    await newPerson('bob', 'Bob Stone', 'bstone@google.com');
    await newPeriod('aliceHeld', 'alice', '2022-01-01', '2024-01-01', 'tel@google.com');
    await newPeriod('bobHeld', 'bob', '2023-01-01', '2024-06-01', 'tel@google.com');
    // Alice's live period, on her own address — never part of a conflict, so never a
    // target. It is here so "touched nothing else" means something.
    await newPeriod('aliceNow', 'alice', '2024-01-01', null, 'tel@google.com');
  };

  it('clears the loser and keeps the address on whoever holds it today', async () => {
    await historicalConflict();

    const report = await clearConflictingAddresses(TODAY);

    expect(report.refused).toBeNull();
    // Alice's two periods overlap Bob's one, so the check sees two pairs — one address.
    expect(report.conflicts).toBe(2);
    expect(report.addresses).toBe(1);
    expect(report.cleared).toHaveLength(1);
    expect(report.cleared[0]).toMatchObject({
      address: 'tel@google.com',
      period: { periodId: period.bobHeld, personId: person.bob, personName: 'Bob Stone' },
      winner: { personId: person.alice, personName: 'Alice Waters' },
    });
    expect(await addressOf('bobHeld')).toBeNull();
    // The winner's history is untouched — both of Alice's periods keep the address.
    expect(await addressOf('aliceHeld')).toBe('tel@google.com');
    expect(await addressOf('aliceNow')).toBe('tel@google.com');
  });

  it('leaves the database with nothing for the check to find, and re-adds the constraint', async () => {
    await historicalConflict();
    const check = await import('../src/lib/emailConflictCheck');
    expect(await check.findEmailConflicts()).toHaveLength(2);

    await clearConflictingAddresses(TODAY);

    expect(await check.findEmailConflicts()).toEqual([]);
    // The gate the whole arm exists to open: the migration's constraint now applies.
    for (const sql of unmanagedConstraintSql()) {
      await expect(prisma.$executeRawUnsafe(sql)).resolves.toBeDefined();
    }
    await prisma.$executeRawUnsafe(`ALTER TABLE "PersonAffiliation" DROP CONSTRAINT "${CONSTRAINT}"`);
  });

  it('is idempotent — the second run finds nothing and changes no row', async () => {
    await historicalConflict();
    await clearConflictingAddresses(TODAY);
    const after = await everyAddress();

    const second = await clearConflictingAddresses(TODAY);

    expect(second.conflicts).toBe(0);
    expect(second.cleared).toEqual([]);
    expect(second.refused).toBeNull();
    expect(await everyAddress()).toEqual(after);
  });

  it('never touches a period whose address is nobody else’s', async () => {
    await newPerson('alice', 'Alice Waters', 'alice@google.com');
    await newPerson('bob', 'Bob Stone', 'bstone@google.com');
    // A HANDOVER, which the constraint deliberately permits: she leaves the day he starts.
    await newPeriod('aliceHeld', 'alice', '2022-01-01', '2024-01-01', 'tel@google.com');
    await newPeriod('bobHeld', 'bob', '2024-01-01', null, 'tel@google.com');
    const before = await everyAddress();

    const report = await clearConflictingAddresses(TODAY);

    expect(report.conflicts).toBe(0);
    expect(report.cleared).toEqual([]);
    expect(await everyAddress()).toEqual(before);
  });

  it('DEFERS to the app when the losing period covers today, and erases nothing', async () => {
    await newPerson('alice', 'Alice Waters', 'tel@google.com');
    await newPerson('bob', 'Bob Stone', 'bstone@google.com');
    await newPeriod('aliceHeld', 'alice', '2022-01-01', null, 'tel@google.com');
    // Bob's conflicting period is OPEN, so #127 E14's editor can correct it — and a human
    // there can record the address he actually uses instead of erasing the wrong one.
    await newPeriod('bobNow', 'bob', '2023-01-01', null, 'tel@google.com');

    const report = await clearConflictingAddresses(TODAY);

    expect(report.refused).toBeNull();
    expect(report.clearable).toEqual([]);
    expect(report.cleared).toEqual([]);
    expect(report.deferred).toHaveLength(1);
    expect(report.deferred[0].period).toMatchObject({ periodId: period.bobNow, personId: person.bob });
    expect(await addressOf('bobNow')).toBe('tel@google.com');
  });

  it('leaves an address NOBODY holds today alone rather than guessing who held it', async () => {
    await newPerson('alice', 'Alice Waters', 'awaters@qualcomm.com');
    await newPerson('bob', 'Bob Stone', 'bstone@google.com');
    await newPeriod('aliceHeld', 'alice', '2022-01-01', '2024-01-01', 'tel@google.com');
    await newPeriod('bobHeld', 'bob', '2023-01-01', '2024-06-01', 'tel@google.com');
    const before = await everyAddress();

    const report = await clearConflictingAddresses(TODAY);

    expect(report.cleared).toEqual([]);
    expect(report.undecidable).toHaveLength(1);
    expect(report.undecidable[0].reason).toMatch(/nobody records this as their current address/);
    expect(report.undecidable[0].periods.map((p) => p.periodId).sort()).toEqual(
      [period.aliceHeld, period.bobHeld].sort(),
    );
    // Reported, not refused — a run that could also fix four decidable addresses must not
    // be blocked by one nothing in this repository can decide.
    expect(report.refused).toBeNull();
    expect(await everyAddress()).toEqual(before);
  });

  it('leaves an address TWO people hold today alone — the rule names no single winner', async () => {
    // Legal since #127 E9 dropped `Person.email @unique`: uniqueness became a statement
    // about instants on the timeline, not about the column.
    await newPerson('alice', 'Alice Waters', 'tel@google.com');
    await newPerson('bob', 'Bob Stone', 'tel@google.com');
    await newPeriod('aliceHeld', 'alice', '2022-01-01', '2024-01-01', 'tel@google.com');
    await newPeriod('bobHeld', 'bob', '2023-01-01', '2024-06-01', 'tel@google.com');

    const report = await clearConflictingAddresses(TODAY);

    expect(report.cleared).toEqual([]);
    expect(report.undecidable[0].reason).toMatch(/2 people record this as their current address/);
    expect(await addressOf('aliceHeld')).toBe('tel@google.com');
    expect(await addressOf('bobHeld')).toBe('tel@google.com');
  });

  it('clears every loser when THREE people overlap on one address', async () => {
    await newPerson('alice', 'Alice Waters', 'tel@google.com');
    await newPerson('bob', 'Bob Stone', 'bstone@google.com');
    await newPerson('carla', 'Carla Reyes', 'creyes@google.com');
    await newPeriod('aliceHeld', 'alice', '2022-01-01', '2024-01-01', 'tel@google.com');
    await newPeriod('bobHeld', 'bob', '2022-06-01', '2023-06-01', 'tel@google.com');
    await newPeriod('carlaHeld', 'carla', '2022-09-01', '2023-09-01', 'tel@google.com');

    const report = await clearConflictingAddresses(TODAY);

    // Three pairs, one address, one winner — and crucially the Bob/Carla pair, where
    // NEITHER side holds the address today, is not undecidable: the rule decides per
    // ADDRESS, and Alice wins the address.
    expect(report.conflicts).toBe(3);
    expect(report.undecidable).toEqual([]);
    expect(report.cleared.map((c) => c.period.periodId).sort()).toEqual(
      [period.bobHeld, period.carlaHeld].sort(),
    );
    expect(await addressOf('aliceHeld')).toBe('tel@google.com');
    expect(await addressOf('bobHeld')).toBeNull();
    expect(await addressOf('carlaHeld')).toBeNull();
  });

  it('REFUSES and writes nothing when more periods qualify than the bound allows', async () => {
    await newPerson('alice', 'Alice Waters', 'tel@google.com');
    await newPeriod('aliceHeld', 'alice', '2022-01-01', '2024-01-01', 'tel@google.com');
    for (let i = 0; i <= MAX_CLEARED; i += 1) {
      await newPerson(`loser${i}`, `Loser ${i}`, `loser${i}@google.com`);
      await newPeriod(`loserHeld${i}`, `loser${i}`, '2022-02-01', '2023-02-01', 'tel@google.com');
    }
    const before = await everyAddress();

    const report = await clearConflictingAddresses(TODAY);

    expect(report.clearable).toHaveLength(MAX_CLEARED + 1);
    expect(report.refused).toMatch(new RegExp(`refuses above ${MAX_CLEARED}`));
    expect(report.cleared).toEqual([]);
    expect(await everyAddress()).toEqual(before);
  });

  // `skipped` — a target a concurrent write claimed between the scan and the UPDATE — is
  // pinned in the FORMATTER below rather than here, exactly as `ownerRemediation.test.ts`
  // pins its own: driving the race would mean interleaving two clients inside one call,
  // and the property that matters (the UPDATE is pinned to the address the scan read, so
  // a correction that landed first WINS) is visible in the `where` clause and would not
  // be made more true by a mock.
});

// The report IS the deliverable — a human reads it on the run's summary page and decides
// from it alone whether the database is now in the state they wanted. docs/OPERATIONS.md
// quotes these lines, so what is pinned here is the vocabulary that runbook explains.
describe('formatAddressConflictRemediationReport', () => {
  // A type-only import is erased at compile time, so it does not evaluate src/lib/db the
  // way a value import would.
  type Report = import('../src/lib/addressConflictRemediation').AddressConflictRemediationReport;
  const period = {
    personId: 4,
    personName: 'Bob Stone',
    periodId: 12,
    startDate: new Date('2022-01-01T00:00:00.000Z'),
    endDate: new Date('2024-01-01T00:00:00.000Z'),
  };
  const resolved = {
    address: 'tel@google.com',
    period,
    winner: { personId: 3, personName: 'Alice Waters' },
  };
  const base: Report = {
    conflicts: 1,
    addresses: 1,
    clearable: [],
    cleared: [],
    deferred: [],
    undecidable: [],
    skipped: 0,
    refused: null,
  };

  it('names the period it erased, the person who kept the address, and the rule', () => {
    const text = formatAddressConflictRemediationReport({
      ...base,
      clearable: [resolved],
      cleared: [resolved],
    });

    expect(text).toContain('RULE: whoever holds the address NOW keeps it');
    expect(text).toContain('CLEARED      tel@google.com');
    // The CHECK's own period line, shared rather than re-spelled — an operator reads that
    // report and this one in a single sitting.
    expect(text).toContain('#4 Bob Stone — period 12, 2022-01-01 → 2024-01-01');
    expect(text).toContain('kept by #3 Alice Waters, who holds it today');
    expect(text).toContain('cleared: 1');
    expect(text).not.toContain('skipped');
    // Nothing left over means no "conflicts remain" tail to scroll past.
    expect(text).not.toContain('Conflicts remain');
  });

  it('leads with REFUSED, lists what it would have touched, and shows no write to read past', () => {
    const text = formatAddressConflictRemediationReport({
      ...base,
      conflicts: 6,
      clearable: [resolved],
      refused: '6 periods would have their address cleared, and this arm refuses above 5. Nothing was written.',
    });

    expect(text).toContain('REFUSED: 6 periods would have their address cleared');
    expect(text).toContain('CLEARABLE    tel@google.com');
    expect(text).toContain('#4 Bob Stone — period 12, 2022-01-01 → 2024-01-01');
    expect(text).not.toContain('CLEARED ');
    expect(text).not.toContain('RULE:');
  });

  it('sends a deferred period to the app, and says the check will still see it', () => {
    const text = formatAddressConflictRemediationReport({ ...base, deferred: [resolved] });

    expect(text).toContain('DEFERRED     tel@google.com');
    expect(text).toContain('edit #4 Bob Stone on /people/4');
    expect(text).toContain('this arm wrote nothing here');
    expect(text).toContain('db:check:email-conflicts will still report the DEFERRED and');
  });

  it('says why an undecidable address was left alone, and names every period on it', () => {
    const text = formatAddressConflictRemediationReport({
      ...base,
      undecidable: [
        {
          address: 'tel@google.com',
          periods: [period],
          reason: 'nobody records this as their current address, so the rule names no winner',
        },
      ],
    });

    expect(text).toContain('UNDECIDABLE  tel@google.com — nobody records this as their current address');
    expect(text).toContain('nothing was written');
    expect(text).toContain('#4 Bob Stone — period 12');
  });

  it('says plainly that there was nothing to do — what every run after the first prints', () => {
    expect(formatAddressConflictRemediationReport({ ...base, conflicts: 0, addresses: 0 })).toBe(
      'Nothing to do — no address in this database is recorded against two people at once.',
    );
  });

  it('surfaces a skipped period as the re-run condition it is', () => {
    const text = formatAddressConflictRemediationReport({ ...base, clearable: [resolved], skipped: 1 });

    expect(text).toContain('cleared: 0');
    expect(text).toContain('skipped: 1 (claimed by a concurrent write — re-run and compare)');
  });
});
