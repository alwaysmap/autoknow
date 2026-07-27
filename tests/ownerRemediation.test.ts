/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Dynamic import AFTER the env assignment above — a static import is hoisted and would
// evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type RemediationLib = typeof import('../src/lib/ownerRemediation');
let repointUnresolvableOwners: RemediationLib['repointUnresolvableOwners'];
let formatOwnerRemediationReport: RemediationLib['formatOwnerRemediationReport'];
let MAX_REPOINTED: RemediationLib['MAX_REPOINTED'];

// The remediation arm for prod's two mock programs whose `ownerName` names nobody. It
// WRITES to production through the dispatch runner, so what is pinned here is not the
// happy path — it is every way it must decline: rows it may not touch, a count it may not
// exceed, and a second run that must change nothing.

beforeAll(async () => {
  ({ repointUnresolvableOwners, formatOwnerRemediationReport, MAX_REPOINTED } = await import(
    '../src/lib/ownerRemediation'
  ));
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

describe('repointUnresolvableOwners', () => {
  let google: number;
  const person: Record<string, number> = {};
  const project: Record<string, number> = {};

  const partner = async (name: string) =>
    (await prisma.partner.create({
      data: {
        name,
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    })).id;

  const newPerson = async (key: string, name: string, email: string) => {
    person[key] = (await prisma.person.create({
      data: { name, email, currentPartnerId: google },
    })).id;
  };

  const newProject = async (key: string, ownerName: string | null, ownerPersonId?: number) => {
    project[key] = (await prisma.project.create({
      data: { name: key, partnerId: google, ownerName, ownerPersonId: ownerPersonId ?? null },
    })).id;
  };

  const ownerOf = async (key: string) =>
    prisma.project.findUniqueOrThrow({
      where: { id: project[key] },
      select: { ownerName: true, ownerPersonId: true },
    });

  /** Prod's shape: two programs whose owner is a display name matching nobody, some
   *  programs already owned, and one row the E6 backfill can still resolve itself. */
  beforeEach(async () => {
    await wipeAll();
    google = await partner('Google LLC');
    // Ids ascend in creation order, which is what the tie-break below rides on.
    await newPerson('jane', 'Jane Smith', 'jsmith@google.com'); // lowest id
    await newPerson('raj', 'Raj Patel', 'rpatel@google.com');
    await newProject('ownedByRaj1', 'rpatel@google.com', person.raj);
    await newProject('ownedByRaj2', 'rpatel@google.com', person.raj);
    await newProject('ownedByJane', 'jsmith@google.com', person.jane);
    await newProject('alicePM', 'Alice PM');
    await newProject('claraOps', 'Clara Operations');
    await newProject('resolvable', 'jsmith@google.com'); // E6's job, not this arm's
    await newProject('noOwner', null);
  });

  it('repoints exactly the rows whose ownerName names nobody, and reports both columns before and after', async () => {
    const report = await repointUnresolvableOwners();

    expect(report.refused).toBeNull();
    // Raj owns two programs to Jane's one, so the rule picks Raj — and says so.
    expect(report.owner).toMatchObject({ id: person.raj, email: 'rpatel@google.com', programsAlreadyOwned: 2 });
    expect(report.repointed.map((r) => r.id).sort()).toEqual([project.alicePM, project.claraOps].sort());
    expect(report.repointed.find((r) => r.id === project.alicePM)).toEqual({
      id: project.alicePM,
      name: 'alicePM',
      before: { ownerName: 'Alice PM', ownerPersonId: null },
      after: { ownerName: 'rpatel@google.com', ownerPersonId: person.raj },
    });

    // BOTH columns, on both rows — the requireOwner pairing, not half of it.
    expect(await ownerOf('alicePM')).toEqual({ ownerName: 'rpatel@google.com', ownerPersonId: person.raj });
    expect(await ownerOf('claraOps')).toEqual({ ownerName: 'rpatel@google.com', ownerPersonId: person.raj });
  });

  it('leaves a row the E6 backfill can still resolve alone, and one with no owner at all', async () => {
    const report = await repointUnresolvableOwners();

    expect(report.resolvable).toBe(1);
    expect(await ownerOf('resolvable')).toEqual({ ownerName: 'jsmith@google.com', ownerPersonId: null });
    expect(await ownerOf('noOwner')).toEqual({ ownerName: null, ownerPersonId: null });
  });

  it('never touches a program that already has an owner id', async () => {
    const before = await prisma.project.findMany({
      where: { ownerPersonId: { not: null } },
      select: { id: true, ownerName: true, ownerPersonId: true },
      orderBy: { id: 'asc' },
    });

    await repointUnresolvableOwners();

    expect(
      await prisma.project.findMany({
        where: { id: { in: before.map((p) => p.id) } },
        select: { id: true, ownerName: true, ownerPersonId: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it('is idempotent — the second run finds nothing and changes no row', async () => {
    await repointUnresolvableOwners();
    const after = await prisma.project.findMany({
      select: { id: true, ownerName: true, ownerPersonId: true },
      orderBy: { id: 'asc' },
    });

    const second = await repointUnresolvableOwners();

    expect(second.unresolvable).toEqual([]);
    expect(second.repointed).toEqual([]);
    expect(second.refused).toBeNull();
    expect(second.owner).toBeNull();
    expect(
      await prisma.project.findMany({
        select: { id: true, ownerName: true, ownerPersonId: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(after);
  });

  it('REFUSES and writes nothing when a THIRD unresolvable row appears', async () => {
    await newProject('thirdSurprise', 'Somebody Nobody Added');
    const before = await prisma.project.findMany({
      select: { id: true, ownerName: true, ownerPersonId: true },
      orderBy: { id: 'asc' },
    });

    const report = await repointUnresolvableOwners();

    expect(report.unresolvable).toHaveLength(MAX_REPOINTED + 1);
    expect(report.refused).toMatch(/refuses above 2/);
    expect(report.owner).toBeNull();
    expect(report.repointed).toEqual([]);
    expect(
      await prisma.project.findMany({
        select: { id: true, ownerName: true, ownerPersonId: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it('breaks a tie in programs owned to the lowest Person.id', async () => {
    // Give Jane a second program so she and Raj both own two. Jane was created first.
    await newProject('ownedByJane2', 'jsmith@google.com', person.jane);

    const report = await repointUnresolvableOwners();

    expect(report.owner?.id).toBe(person.jane);
    expect(person.jane).toBeLessThan(person.raj);
  });

  it('falls back to the lowest Person.id when no program has an owner at all', async () => {
    await prisma.project.updateMany({ data: { ownerPersonId: null } });

    const report = await repointUnresolvableOwners();

    expect(report.owner).toMatchObject({ id: person.jane, programsAlreadyOwned: 0 });
  });

  it('REFUSES rather than inventing an owner when there is no Person to choose', async () => {
    await wipeAll();
    google = await partner('Google LLC');
    await newProject('alicePM', 'Alice PM');

    const report = await repointUnresolvableOwners();

    expect(report.refused).toMatch(/no Person rows/i);
    expect(report.repointed).toEqual([]);
    expect(await ownerOf('alicePM')).toEqual({ ownerName: 'Alice PM', ownerPersonId: null });
  });
});

// The report IS the deliverable — a human reads it on the run's summary page and decides
// from it alone whether production is now in the state they wanted. docs/OPERATIONS.md
// quotes these lines, so what is pinned here is the vocabulary that runbook explains.
describe('formatOwnerRemediationReport', () => {
  // A type-only import is erased at compile time, so it does not evaluate src/lib/db
  // ahead of the DATABASE_URL assignment the way a value import would.
  const base: import('../src/lib/ownerRemediation').OwnerRemediationReport = {
    scanned: 2, unresolvable: [], resolvable: 0, owner: null, repointed: [], skipped: 0, refused: null,
  };

  it('shows both columns before and after for every row it wrote, and names the rule', () => {
    const text = formatOwnerRemediationReport({
      ...base,
      unresolvable: [{ id: 2, name: 'Toyota Highlander Digital Key', ownerName: 'Alice PM' }],
      owner: { id: 1, name: 'Dylan Thomas', email: 'dylan@alwaysmap.com', programsAlreadyOwned: 4 },
      repointed: [{
        id: 2,
        name: 'Toyota Highlander Digital Key',
        before: { ownerName: 'Alice PM', ownerPersonId: null },
        after: { ownerName: 'dylan@alwaysmap.com', ownerPersonId: 1 },
      }],
    });

    expect(text).toContain('Owner chosen by rule: Dylan Thomas <dylan@alwaysmap.com> (person #1), who already owns 4 program(s).');
    expect(text).toContain('RULE: the person owning the most programs');
    expect(text).toContain('REPOINTED  #2 Toyota Highlander Digital Key');
    expect(text).toContain('before: ownerName “Alice PM”, ownerPersonId NULL');
    expect(text).toContain('after:  ownerName “dylan@alwaysmap.com”, ownerPersonId #1');
    expect(text).toContain('repointed: 1');
    expect(text).not.toContain('skipped');
  });

  it('leads with REFUSED and lists what it saw, with no owner and no writes to read past', () => {
    const text = formatOwnerRemediationReport({
      ...base,
      scanned: 3,
      unresolvable: [
        { id: 2, name: 'Toyota Highlander Digital Key', ownerName: 'Alice PM' },
        { id: 3, name: 'Ford Explorer VHAL Integration (Bosch)', ownerName: 'Clara Operations' },
        { id: 4, name: 'GM Ultium Infotainment', ownerName: 'Nobody At All' },
      ],
      refused: '3 projects have an ownerName matching nobody, and this arm refuses above 2. Nothing was written.',
    });

    expect(text).toContain('REFUSED: 3 projects have an ownerName matching nobody');
    // The row label the E6 backfill uses for the identical predicate — one vocabulary
    // across the two reports an operator reads back to back.
    expect(text).toContain('UNMATCHED  #4 GM Ultium Infotainment — ownerName “Nobody At All” matches no person');
    // Nothing that could be mistaken for a write.
    expect(text).not.toContain('REPOINTED');
    expect(text).not.toContain('Owner chosen by rule');
  });

  it('says plainly that there was nothing to do — what every run after the first prints', () => {
    expect(formatOwnerRemediationReport({ ...base, scanned: 0 })).toContain(
      'Nothing to do — every ownerName here names a real person.',
    );
  });

  it('surfaces a skipped row as the re-run condition it is', () => {
    const text = formatOwnerRemediationReport({
      ...base,
      unresolvable: [{ id: 2, name: 'Toyota Highlander Digital Key', ownerName: 'Alice PM' }],
      owner: { id: 1, name: 'Dylan Thomas', email: 'dylan@alwaysmap.com', programsAlreadyOwned: 4 },
      skipped: 1,
    });

    expect(text).toContain('repointed: 0');
    expect(text).toContain('skipped:   1 (claimed by a concurrent write — re-run and compare)');
  });
});
