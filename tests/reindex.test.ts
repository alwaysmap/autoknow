/** @jest-environment node */
// reindexAll must sweep every searchable table (batched reads + a bounded embed
// pool) and actually land vectors — a record without an embedding is invisible to
// the semantic channel.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

let search: typeof import('../src/lib/search');
let initiativeId: number;

beforeAll(async () => {
  search = await import('../src/lib/search');
  const seeded = await seedProgram();

  // An initiative spanning one ACTIVE member (Rivian) and one REMOVED (Denso), so the
  // index-text assertion below can pin that membership follows the join's status.
  const template = await prisma.programTemplate.create({ data: { name: 'EV workflow snapshot' } });
  const initiative = await prisma.initiative.create({
    data: { name: 'EV Routing', description: 'Battery state APIs', templateId: template.id },
  });
  initiativeId = initiative.id;
  await prisma.initiativePartner.createMany({
    data: [
      { initiativeId: initiative.id, partnerId: seeded.oemId },
      { initiativeId: initiative.id, partnerId: seeded.supplierId, status: 'removed', removedAt: new Date() },
    ],
  });
});

afterAll(async () => {
  await disconnectTestDb();
});

it('composes an initiative as name + description + ACTIVE member partner names', async () => {
  const target = await search.entityIndexText('initiative', initiativeId);
  // Rivian (active) is in; Denso (removed) is not — a removed partner is history, and
  // its name matching would surface the initiative for a partner it no longer spans.
  expect(target).toEqual({ table: 'Initiative', text: 'EV Routing. Battery state APIs. Rivian' });
});

it('reindexAll embeds every entity', async () => {
  const counts = await search.reindexAll();
  expect(counts.partners).toBe(2); // Rivian + Denso
  expect(counts.programs).toBe(1);
  expect(counts.initiatives).toBe(1);

  const [partners, projects, initiatives] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Partner" WHERE embedding IS NOT NULL`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Project" WHERE embedding IS NOT NULL`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Initiative" WHERE embedding IS NOT NULL`,
  ]);
  expect(Number(partners[0].n)).toBe(2);
  expect(Number(projects[0].n)).toBe(1);
  expect(Number(initiatives[0].n)).toBe(1);
});
