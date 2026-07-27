/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { unmanagedConstraintSql } from './helpers/provisionTestDatabases';

// Dynamic import AFTER the env assignment above — a static import is hoisted and would
// evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type CheckLib = typeof import('../src/lib/emailConflictCheck');
type ProfilesLib = typeof import('../src/lib/profiles');
let findEmailConflicts: CheckLib['findEmailConflicts'];
let addressHolderAsOf: ProfilesLib['addressHolderAsOf'];
let correctPersonRecord: ProfilesLib['correctPersonRecord'];

// #127 E9 — unique-at-an-instant (spec #124 §2, §5 row 4). `Person.email @unique` claimed
// one address belongs to one human forever, which is false in both directions: addresses
// are reassigned, and the person who left keeps the artifacts that quote theirs. The
// truth is narrower and temporal, and it now lives in the DATABASE as an exclusion
// constraint rather than in a column modifier — so these tests write through Prisma and
// let Postgres answer, which is the only way to prove a guard that the application layer
// does not implement.
//
// The boundary cases are the point. A career handover — she leaves on the 1st, he starts
// on the 1st, same shared address — is the single most likely real use of one address by
// two people, and the half-open convention (`start <= t < end`) is exactly what makes it
// legal. Get that wrong and the constraint rejects an honest handover.
describe('unique-at-an-instant', () => {
  let partnerId: number;
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  const newPerson = async (name: string, email: string) =>
    (await prisma.person.create({ data: { name, email, currentPartnerId: partnerId } })).id;

  const period = (personId: number, start: string, end: string | null, email: string | null) =>
    prisma.personAffiliation.create({
      data: {
        personId,
        partnerId,
        role: 'Member',
        startDate: day(start),
        endDate: end === null ? null : day(end),
        email,
      },
    });

  beforeAll(async () => {
    ({ findEmailConflicts } = await import('../src/lib/emailConflictCheck'));
    ({ addressHolderAsOf, correctPersonRecord } = await import('../src/lib/profiles'));
  });

  beforeEach(async () => {
    await wipeAll();
    const partner = await prisma.partner.create({
      data: {
        name: 'Google LLC',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    partnerId = partner.id;
  });

  afterAll(async () => {
    await wipeAll();
    await disconnectTestDb();
  });

  // If this fails, nothing else in this file is testing anything: `prisma db push` builds
  // the test databases and cannot express an exclusion constraint, so the constraint is
  // replayed from the migration by tests/helpers/provisionTestDatabases. A silently
  // absent constraint would leave every rejection case below passing writes it should
  // refuse — and passing them QUIETLY.
  it('is actually present in this database', async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
       WHERE conname = 'PersonAffiliation_email_unique_at_an_instant'`;
    expect(rows).toHaveLength(1);
  });

  describe('the database refuses', () => {
    it('one address recorded against two people over overlapping periods', async () => {
      const alice = await newPerson('Alice Waters', 'alice@google.com');
      const bob = await newPerson('Bob Stone', 'bob@google.com');
      await period(alice, '2024-01-01', null, 'tel@google.com');
      await expect(period(bob, '2025-01-01', null, 'tel@google.com')).rejects.toThrow();
    });

    it('the same overlap when the two addresses differ only in case', async () => {
      const alice = await newPerson('Alice Waters', 'alice@google.com');
      const bob = await newPerson('Bob Stone', 'bob@google.com');
      await period(alice, '2024-01-01', null, 'tel@google.com');
      // Not reachable through lib/schemas, which canonicalizes — which is the point:
      // the constraint folds case itself, so an address arriving by any other route
      // (a raw statement, a future backfill) cannot slip past by capitalising.
      await expect(
        prisma.$executeRaw`
          INSERT INTO "PersonAffiliation" ("personId","partnerId","role","startDate","endDate","email")
          VALUES (${bob}, ${partnerId}, 'Member', ${day('2025-01-01')}, NULL, 'TEL@Google.com')`,
      ).rejects.toThrow();
    });
  });

  describe('the database allows', () => {
    it('a handover: her period ends the day his begins', async () => {
      const alice = await newPerson('Alice Waters', 'alice@google.com');
      const bob = await newPerson('Bob Stone', 'bob@google.com');
      await period(alice, '2024-01-01', '2026-07-01', 'tel@google.com');
      await expect(period(bob, '2026-07-01', null, 'tel@google.com')).resolves.toBeTruthy();
    });

    it('overlapping periods whose address was never recorded', async () => {
      const alice = await newPerson('Alice Waters', 'alice@google.com');
      const bob = await newPerson('Bob Stone', 'bob@google.com');
      await period(alice, '2024-01-01', null, null);
      await expect(period(bob, '2025-01-01', null, null)).resolves.toBeTruthy();
    });

    // ONE person's periods overlapping is a different defect with a different owner
    // (bead autoknow-2of, at the mutation boundary). Folding it in here would make one
    // constraint answer two questions and report the wrong one — and would fail a
    // deploy over a career shape that has nothing to do with identity.
    it('one person holding one address across overlapping periods of their own', async () => {
      const alice = await newPerson('Alice Waters', 'alice@google.com');
      await period(alice, '2024-01-01', null, 'alice@google.com');
      await expect(period(alice, '2025-01-01', null, 'alice@google.com')).resolves.toBeTruthy();
    });

    // The replacement for `@unique` is about instants, not rows. Two people whose
    // CURRENT addresses collide is still wrong — but it is caught where the address
    // meets a period, not by the column.
    it('two Person rows carrying the same current address', async () => {
      await newPerson('Alice Waters', 'shared@google.com');
      await expect(newPerson('Alice W', 'shared@google.com')).resolves.toBeTruthy();
    });
  });

  // The migration preflights with this predicate spelled in SQL and this module spells it
  // again in a raw query, because the migration cannot import TypeScript. Two spellings
  // of one rule is normally the bug (AGENTS lesson 7), so they are pinned against each
  // other here: what the checker reports must be exactly what the constraint rejects.
  describe('findEmailConflicts sees what the constraint would reject', () => {
    it('reports nothing when every write above was accepted', async () => {
      const alice = await newPerson('Alice Waters', 'alice@google.com');
      const bob = await newPerson('Bob Stone', 'bob@google.com');
      await period(alice, '2024-01-01', '2026-07-01', 'tel@google.com');
      await period(bob, '2026-07-01', null, 'tel@google.com');
      await expect(findEmailConflicts()).resolves.toEqual([]);
    });

    it('reports the pair the constraint refused, naming both people', async () => {
      const alice = await newPerson('Alice Waters', 'alice@google.com');
      const bob = await newPerson('Bob Stone', 'bob@google.com');
      await period(alice, '2024-01-01', null, 'tel@google.com');
      const refused = period(bob, '2025-01-01', null, 'tel@google.com');
      await expect(refused).rejects.toThrow();

      // Reproduce the row the constraint kept out, so the checker has something to find:
      // dropping the constraint is what a database that PREDATES this migration is.
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "PersonAffiliation" DROP CONSTRAINT "PersonAffiliation_email_unique_at_an_instant"',
      );
      try {
        await period(bob, '2025-01-01', null, 'tel@google.com');
        const conflicts = await findEmailConflicts();
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].address).toBe('tel@google.com');
        expect([conflicts[0].a.personName, conflicts[0].b.personName].sort())
          .toEqual(['Alice Waters', 'Bob Stone']);
      } finally {
        // Leave the database as it was found: this file's other cases and every suite
        // after it share it, and a missing constraint fails them silently, not loudly.
        // Restored from the MIGRATION, via the same reader that provisioned it — a hand
        // copy here would quietly reinstate a stale definition into a shared database the
        // moment the migration's changed, which is worse than not restoring it at all.
        await prisma.personAffiliation.deleteMany({ where: { personId: bob } });
        for (const sql of unmanagedConstraintSql()) await prisma.$executeRawUnsafe(sql);
      }
    });
  });

  describe('the app names the clash before Postgres refuses it', () => {
    it('finds the other person holding an address today, whichever column records it', async () => {
      const alice = await newPerson('Alice Waters', 'alice@google.com');
      const bob = await newPerson('Bob Stone', 'bob@google.com');
      await period(bob, '2024-01-01', null, 'tel@google.com');

      // Recorded on the period only.
      await expect(addressHolderAsOf('tel@google.com', { exceptPersonId: alice }))
        .resolves.toMatchObject({ id: bob, name: 'Bob Stone' });
      // Recorded on the person only, and matched case-insensitively.
      await expect(addressHolderAsOf('BOB@google.com', { exceptPersonId: alice }))
        .resolves.toMatchObject({ id: bob });
      // Nobody else holds their own address.
      await expect(addressHolderAsOf('bob@google.com', { exceptPersonId: bob })).resolves.toBeNull();
      // An address he HELD but has since left names nobody today.
      await prisma.personAffiliation.updateMany({
        where: { personId: bob },
        data: { endDate: day('2025-01-01') },
      });
      await expect(addressHolderAsOf('tel@google.com', { exceptPersonId: alice, at: day('2026-01-01') }))
        .resolves.toBeNull();
    });

    it('correcting an address moves the period they are in, not just the row', async () => {
      const alice = await newPerson('Alice Waters', 'awaters@qualcomm.com');
      await period(alice, '2024-01-01', null, 'awaters@qualcomm.com');

      await correctPersonRecord({
        personId: alice,
        name: 'Alice Waters',
        email: '  Alice@Google.com ',
        notes: null,
      });

      const row = await prisma.person.findUniqueOrThrow({
        where: { id: alice },
        include: { affiliations: true },
      });
      expect(row.email).toBe('alice@google.com');
      expect(row.affiliations.map((a) => a.email)).toEqual(['alice@google.com']);
    });

    it('leaves history alone — only the period covering today is corrected', async () => {
      const alice = await newPerson('Alice Waters', 'alice@google.com');
      await period(alice, '2022-01-01', '2024-03-01', 'alice.waters@bosch.com');
      await period(alice, '2024-03-01', null, 'awaters@qualcomm.com');

      await correctPersonRecord({
        personId: alice,
        name: 'Alice Waters',
        email: 'alice@google.com',
        notes: null,
      });

      const rows = await prisma.personAffiliation.findMany({
        where: { personId: alice },
        orderBy: { startDate: 'asc' },
      });
      expect(rows.map((r) => r.email)).toEqual(['alice.waters@bosch.com', 'alice@google.com']);
    });
  });
});
