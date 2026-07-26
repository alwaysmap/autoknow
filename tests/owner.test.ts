/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Dynamic import AFTER the env assignment above — a static import is hoisted and
// would evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type OwnerLib = typeof import('../src/lib/owner');
let requireOwner: OwnerLib['requireOwner'];

// Project's owner must always reference an EXISTING Person: the form pickers only
// offer existing people, and requireOwner is the server-side seam guarding the
// mutation paths. It accepts email/handle/name shapes and returns BOTH columns —
// the canonical email and the person id — so a caller cannot write one without the
// other (#127 E6 dual-write).
describe('requireOwner', () => {
  let personId: number;

  beforeAll(async () => {
    ({ requireOwner } = await import('../src/lib/owner'));
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Google LLC',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } }
      }
    });
    const person = await prisma.person.create({
      data: { name: 'Jane Smith', email: 'jsmith@google.com', currentPartnerId: partner.id }
    });
    personId = person.id;
  });

  afterAll(async () => {
    await wipeAll();
    await disconnectTestDb();
  });

  it('canonicalizes an existing person to their email AND id from any accepted shape', async () => {
    const expected = { ownerName: 'jsmith@google.com', ownerPersonId: personId };
    for (const shape of ['jsmith@google.com', '@jsmith', 'jsmith', 'Jane Smith']) {
      await expect(requireOwner(shape)).resolves.toEqual(expected);
    }
  });

  it('rejects freeform text that matches no existing person', async () => {
    await expect(requireOwner('totally made up')).rejects.toThrow(/existing person/);
    await expect(requireOwner('ghost@google.com')).rejects.toThrow(/existing person/);
  });

  it('returns a value that IS the Prisma data fragment — both columns, spreadable', async () => {
    const owner = await requireOwner('jsmith');
    const partnerId = (await prisma.partner.findFirstOrThrow()).id;
    const project = await prisma.project.create({ data: { name: 'Dual-write', partnerId, ...owner } });
    expect(project.ownerName).toBe('jsmith@google.com');
    expect(project.ownerPersonId).toBe(personId);
    await prisma.project.delete({ where: { id: project.id } });
  });
});
