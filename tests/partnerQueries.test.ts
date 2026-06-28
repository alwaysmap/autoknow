/** @jest-environment node */
import { prisma } from '../src/lib/db';
import { PartnerQueries } from '../src/lib/partnerQueries';

describe('PartnerQueries Class Service Unit Tests', () => {
  let partnerQueries: PartnerQueries;
  let testPartnerId: number;

  beforeAll(async () => {
    partnerQueries = new PartnerQueries(prisma);

    // Clean up any left-over test data
    await prisma.actionItem.deleteMany();
    await prisma.contextUrl.deleteMany();
    await prisma.phaseState.deleteMany();
    await prisma.phaseDependency.deleteMany();
    await prisma.phase.deleteMany();
    await prisma.projectState.deleteMany();
    await prisma.partnerState.deleteMany();
    await prisma.project.deleteMany();
    await prisma.personAffiliation.deleteMany();
    await prisma.person.deleteMany();
    await prisma.partner.deleteMany();

    // Seed a test partner
    const partner = await prisma.partner.create({
      data: {
        name: 'Tesla Inc',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }
      }
    });
    testPartnerId = partner.id;

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
  });

  afterAll(async () => {
    // Teardown the test records
    await prisma.project.deleteMany();
    await prisma.partner.deleteMany();
    await prisma.$disconnect();
  });

  it('should retrieve seeded partners and their projects successfully via getAllPartners()', async () => {
    const results = await partnerQueries.getAllPartners();
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Tesla Inc');
    expect(results[0].projects.length).toBe(2);
  });

  it('should correctly count active (non-archived) projects using getActivePrograms()', async () => {
    const results = await partnerQueries.getAllPartners();
    const activeCount = partnerQueries.getActivePrograms(results[0]);
    expect(activeCount).toBe(1); // 1 active, 1 archived
  });

  it('should correctly count all lifetime projects using getLifetimePrograms()', async () => {
    const results = await partnerQueries.getAllPartners();
    const lifetimeCount = partnerQueries.getLifetimePrograms(results[0]);
    expect(lifetimeCount).toBe(2); // Both projects
  });
});
