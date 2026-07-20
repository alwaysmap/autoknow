/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Dynamic import AFTER the env assignment above — a static import is hoisted and
// would evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type OwnerLib = typeof import('../src/lib/owner');
let requireOwnerEmail: OwnerLib['requireOwnerEmail'];

// Project.ownerName must always reference an EXISTING Person: the form pickers only
// offer existing people, and requireOwnerEmail is the server-side seam guarding the
// mutation paths. It accepts email/handle/name shapes and canonicalizes to email.
describe('requireOwnerEmail', () => {
  beforeAll(async () => {
    ({ requireOwnerEmail } = await import('../src/lib/owner'));
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Google LLC',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } }
      }
    });
    await prisma.person.create({
      data: { name: 'Jane Smith', email: 'jsmith@google.com', currentPartnerId: partner.id }
    });
  });

  afterAll(async () => {
    await wipeAll();
    await disconnectTestDb();
  });

  it('canonicalizes an existing person to their email from any accepted shape', async () => {
    await expect(requireOwnerEmail('jsmith@google.com')).resolves.toBe('jsmith@google.com');
    await expect(requireOwnerEmail('@jsmith')).resolves.toBe('jsmith@google.com');
    await expect(requireOwnerEmail('jsmith')).resolves.toBe('jsmith@google.com');
    await expect(requireOwnerEmail('Jane Smith')).resolves.toBe('jsmith@google.com');
  });

  it('rejects freeform text that matches no existing person', async () => {
    await expect(requireOwnerEmail('totally made up')).rejects.toThrow(/existing person/);
    await expect(requireOwnerEmail('ghost@google.com')).rejects.toThrow(/existing person/);
  });
});
