/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Dynamic import AFTER the env assignment above — a static import is hoisted and
// would evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type PQ = typeof import('../src/lib/partnerQueries');
let getAllPartners: PQ['getAllPartners'];
let getActivePrograms: PQ['getActivePrograms'];
let getLifetimePrograms: PQ['getLifetimePrograms'];

describe('partnerQueries module', () => {
  beforeAll(async () => {
    ({ getAllPartners, getActivePrograms, getLifetimePrograms } = await import('../src/lib/partnerQueries'));
    // Clean up any left-over test data
    await wipeAll();

    // Seed a test partner
    const partner = await prisma.partner.create({
      data: {
        name: 'Tesla Inc',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } }
      }
    });

    // Seed a mix of active and archived projects
    await prisma.project.create({
      data: {
        name: 'Model 3 AAOS Integration',
        partnerId: partner.id,
        isArchived: false,
        ownerName: 'dylan',
        sopDate: new Date('2026-12-01'),
        volumeFirstYear: 200000
      }
    });

    await prisma.project.create({
      data: {
        name: 'Model S Legacy cluster',
        partnerId: partner.id,
        isArchived: true, // Archived program
        ownerName: 'dylan',
        sopDate: new Date('2022-01-01'),
        volumeFirstYear: 20000
      }
    });

    // Two people, so the team cell has something to be right AND wrong about. Until
    // #127 E5 `getAllPartners` unioned the `currentPartnerId` back-relation with every
    // affiliation row, which listed the leaver here permanently — and the "My partners"
    // toggle matched a company you left years ago.
    const stayer = await prisma.person.create({
      data: { name: 'Ada Current', email: 'ada@tesla.com', currentPartnerId: partner.id },
    });
    const leaver = await prisma.person.create({
      data: { name: 'Bo Departed', email: 'bo@tesla.com', currentPartnerId: partner.id },
    });
    await prisma.personAffiliation.create({
      data: { personId: stayer.id, partnerId: partner.id, role: 'Engineer', startDate: new Date('2020-01-01') },
    });
    await prisma.personAffiliation.create({
      data: {
        personId: leaver.id, partnerId: partner.id, role: 'Engineer',
        startDate: new Date('2019-01-01'), endDate: new Date('2021-06-01'),
      },
    });
  });

  afterAll(async () => {
    // Teardown the test records
    await wipeAll();
    await disconnectTestDb();
  });

  it('retrieves seeded partners and their projects via getAllPartners()', async () => {
    const results = await getAllPartners();
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Tesla Inc');
    expect(results[0].projects.length).toBe(2);
    // type/region are flattened to strings (the UI contract), not relation objects
    expect(typeof results[0].type).toBe('string');
    expect(results[0].type).toBe('OEM');
  });

  it('counts active (non-archived) projects with getActivePrograms()', async () => {
    const results = await getAllPartners();
    expect(getActivePrograms(results[0])).toBe(1); // 1 active, 1 archived
  });

  it('counts all lifetime projects with getLifetimePrograms()', async () => {
    const results = await getAllPartners();
    expect(getLifetimePrograms(results[0])).toBe(2);
  });

  it('lists only who is at the partner TODAY, not everyone who ever was (#127 E5)', async () => {
    // Bo's `currentPartnerId` still points at Tesla — the cache is not maintained on the
    // way out — so a roster that believed either the cache or the affiliation HISTORY
    // would include him. Only the as-of predicate excludes him.
    const [tesla] = await getAllPartners();
    expect(tesla.team.map((p) => p.name)).toEqual(['Ada Current']);
  });
});
