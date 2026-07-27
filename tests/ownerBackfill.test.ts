/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Dynamic import AFTER the env assignment above — a static import is hoisted and
// would evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type BackfillLib = typeof import('../src/lib/ownerBackfill');
let backfillProjectOwnerPerson: BackfillLib['backfillProjectOwnerPerson'];

// #127 E6. The backfill turns the legacy `Project.ownerName` TEXT into `ownerPersonId`.
// The whole point of these tests is the decision at the edges: a name that matches
// nobody, and a name that matches two people, are both LEFT NULL and reported — never
// guessed at, because a backfill has nobody watching and a wrong owner is worse than
// no owner while `ownerName` is still the read path.
describe('backfillProjectOwnerPerson', () => {
  let google: number;
  let bosch: number;
  const person: Record<string, number> = {};
  const project: Record<string, number> = {};

  const newProject = async (key: string, ownerName: string | null) => {
    const row = await prisma.project.create({ data: { name: key, partnerId: google, ownerName } });
    project[key] = row.id;
  };

  beforeAll(async () => {
    ({ backfillProjectOwnerPerson } = await import('../src/lib/ownerBackfill'));
    await wipeAll();

    const partner = async (name: string) =>
      (await prisma.partner.create({
        data: {
          name,
          type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
          region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
        },
      })).id;
    google = await partner('Google LLC');
    bosch = await partner('Bosch');

    const people = [
      { key: 'jane', name: 'Jane Smith', email: 'jsmith@google.com', at: () => google },
      // Both at PARTNER domains: a bare handle derives to the org domain
      // (`deriveEmail`), so an alice@google.com would win the exact-email tier
      // outright. A shared local part is only ambiguous away from that domain.
      { key: 'aliceB', name: 'Alice Waters', email: 'alice@bosch.com', at: () => bosch },
      { key: 'aliceQ', name: 'Alice Brown', email: 'alice@qualcomm.com', at: () => bosch },
      { key: 'chrisA', name: 'Chris Lee', email: 'clee@google.com', at: () => google },
      { key: 'chrisB', name: 'Chris Lee', email: 'chrisl@google.com', at: () => google },
    ];
    for (const p of people) {
      const row = await prisma.person.create({
        data: { name: p.name, email: p.email, currentPartnerId: p.at() },
      });
      person[p.key] = row.id;
    }

    await newProject('byEmail', 'jsmith@google.com');
    await newProject('byHandle', '@jsmith');
    await newProject('byName', 'Jane Smith');
    await newProject('unmatched', 'someone.who.left@google.com');
    await newProject('ambiguousLocalPart', 'alice');
    await newProject('ambiguousName', 'Chris Lee');
    await newProject('noOwner', null);
    // Linked to someone the TEXT does not resolve to, on purpose: if the run rewrote
    // rows that already have an id, pointing this at Jane would hide it (the text
    // resolves to Jane too) and the test could not fail for the reason it names.
    await newProject('alreadyLinked', 'jsmith@google.com');
    await prisma.project.update({
      where: { id: project.alreadyLinked },
      data: { ownerPersonId: person.chrisA },
    });
  });

  afterAll(async () => {
    await wipeAll();
    await disconnectTestDb();
  });

  const ownerPersonIdOf = async (key: string) =>
    (await prisma.project.findUniqueOrThrow({
      where: { id: project[key] },
      select: { ownerPersonId: true },
    })).ownerPersonId;

  // MUST be the first backfill in this file — `linked` and `scanned` below are
  // first-run numbers, and every later `it` runs the backfill again.
  it('links every shape the write paths accept: email, handle, and full name', async () => {
    const report = await backfillProjectOwnerPerson();

    expect(await ownerPersonIdOf('byEmail')).toBe(person.jane);
    expect(await ownerPersonIdOf('byHandle')).toBe(person.jane);
    expect(await ownerPersonIdOf('byName')).toBe(person.jane);
    expect(report.linked).toBe(3);
    // The already-linked row and the ownerless one are not even candidates.
    expect(report.scanned).toBe(6);
  });

  it('leaves an ownerName matching NOBODY null, and names it in the report', async () => {
    const report = await backfillProjectOwnerPerson();

    expect(await ownerPersonIdOf('unmatched')).toBeNull();
    expect(report.unmatched.map((r) => r.id)).toContain(project.unmatched);
    expect(report.unmatched.find((r) => r.id === project.unmatched)?.ownerName)
      .toBe('someone.who.left@google.com');
  });

  it('leaves an AMBIGUOUS ownerName null rather than picking one, and names both', async () => {
    const report = await backfillProjectOwnerPerson();

    // 'alice' is the local part of two addresses at different domains…
    expect(await ownerPersonIdOf('ambiguousLocalPart')).toBeNull();
    const localPart = report.ambiguous.find((r) => r.id === project.ambiguousLocalPart);
    expect(localPart?.candidates.map((c) => c.id).sort()).toEqual(
      [person.aliceB, person.aliceQ].sort(),
    );

    // …and 'Chris Lee' is two different humans with the same name.
    expect(await ownerPersonIdOf('ambiguousName')).toBeNull();
    const namesake = report.ambiguous.find((r) => r.id === project.ambiguousName);
    expect(namesake?.candidates.map((c) => c.id).sort()).toEqual(
      [person.chrisA, person.chrisB].sort(),
    );
  });

  it('never touches a row that already has an owner id', async () => {
    await backfillProjectOwnerPerson();
    // Still Chris, not the Jane its ownerName says — the FK, once set, is the answer.
    expect(await ownerPersonIdOf('alreadyLinked')).toBe(person.chrisA);
  });

  it('is idempotent — a second run links nothing new and changes no row', async () => {
    await backfillProjectOwnerPerson();
    const before = await prisma.project.findMany({
      select: { id: true, ownerName: true, ownerPersonId: true },
      orderBy: { id: 'asc' },
    });

    const second = await backfillProjectOwnerPerson();

    expect(second.linked).toBe(0);
    expect(second.scanned).toBe(3); // only the unmatched + two ambiguous remain
    expect(
      await prisma.project.findMany({
        select: { id: true, ownerName: true, ownerPersonId: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it('picks up a row once its ownerName becomes resolvable — which is why it re-runs', async () => {
    await backfillProjectOwnerPerson();
    // The unmatched program's owner is corrected to a real person (what an operator
    // does with the report), and the next run links it. No migration edit involved.
    await prisma.project.update({
      where: { id: project.unmatched },
      data: { ownerName: 'jsmith@google.com' },
    });

    const report = await backfillProjectOwnerPerson();

    expect(report.linked).toBe(1);
    expect(await ownerPersonIdOf('unmatched')).toBe(person.jane);

    await prisma.project.update({
      where: { id: project.unmatched },
      data: { ownerName: 'someone.who.left@google.com', ownerPersonId: null },
    });
  });
});
