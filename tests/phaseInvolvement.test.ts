/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Dynamic import AFTER the env assignment above — a static import is hoisted and
// would evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type Lib = typeof import('../src/lib/phaseInvolvement');
let requirePhaseInProject: Lib['requirePhaseInProject'];
let requirePartner: Lib['requirePartner'];
let requirePerson: Lib['requirePerson'];

// Involvement names three entities at once and every one arrives as a form field, so
// the picker is the affordance and THIS is the guarantee (AGENTS lesson 3). A refusal
// must also be a readable sentence: `guarded` only forwards a message containing ' — ',
// so a raw failure would reach the user as "Something went wrong".
describe('phase involvement resolvers', () => {
  let projectId: number;
  let otherProjectId: number;
  let phaseId: number;
  let partnerId: number;
  let personId: number;

  beforeAll(async () => {
    ({ requirePhaseInProject, requirePartner, requirePerson } = await import('../src/lib/phaseInvolvement'));
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Denso',
        type: { connectOrCreate: { where: { name: 'Supplier' }, create: { name: 'Supplier' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    partnerId = partner.id;
    const person = await prisma.person.create({
      data: { name: 'Kenji Sato', email: 'kenji@denso.example', currentPartnerId: partner.id },
    });
    personId = person.id;

    const project = await prisma.project.create({ data: { name: 'R2 Bring-up', partnerId: partner.id } });
    projectId = project.id;
    const other = await prisma.project.create({ data: { name: 'Unrelated', partnerId: partner.id } });
    otherProjectId = other.id;

    const phase = await prisma.phase.create({ data: { projectId, name: 'Integration' } });
    phaseId = phase.id;
  });

  afterAll(async () => {
    await wipeAll();
    await disconnectTestDb();
  });

  it('accepts a phase that really belongs to the program the form claims', async () => {
    await expect(requirePhaseInProject(phaseId, projectId)).resolves.toBeUndefined();
  });

  it('refuses a real phase hung off the WRONG program, readably', async () => {
    await expect(requirePhaseInProject(phaseId, otherProjectId)).rejects.toThrow(/ — /);
  });

  it('refuses a phase id that names no row', async () => {
    await expect(requirePhaseInProject(phaseId + 9999, projectId)).rejects.toThrow(/ — /);
  });

  it('refuses a non-integer phase reference before it reaches the database', async () => {
    await expect(requirePhaseInProject(NaN, projectId)).rejects.toThrow(/Invalid input — /);
  });

  it('accepts an existing partner and person; refuses ids that name no row', async () => {
    await expect(requirePartner(partnerId)).resolves.toBeUndefined();
    await expect(requirePerson(personId)).resolves.toBeUndefined();
    await expect(requirePartner(partnerId + 9999)).rejects.toThrow(/ — /);
    await expect(requirePerson(personId + 9999)).rejects.toThrow(/ — /);
    await expect(requirePartner(NaN)).rejects.toThrow(/Invalid input — /);
    await expect(requirePerson(NaN)).rejects.toThrow(/Invalid input — /);
  });
});
