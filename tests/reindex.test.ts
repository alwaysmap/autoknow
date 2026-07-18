/** @jest-environment node */
// reindexAll must sweep every searchable table (batched reads + a bounded embed
// pool) and actually land vectors — a record without an embedding is invisible to
// the semantic channel.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.GEMINI_API_KEY = ''; // deterministic fallback embeddings

jest.mock('server-only', () => ({}));

let search: typeof import('../src/lib/search');

beforeAll(async () => {
  search = await import('../src/lib/search');
  await seedProgram();
});

afterAll(async () => {
  await disconnectTestDb();
});

it('reindexAll embeds every entity', async () => {
  const counts = await search.reindexAll();
  expect(counts.partners).toBe(2); // Rivian + Denso
  expect(counts.programs).toBe(1);

  const [partners, projects] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Partner" WHERE embedding IS NOT NULL`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Project" WHERE embedding IS NOT NULL`,
  ]);
  expect(Number(partners[0].n)).toBe(2);
  expect(Number(projects[0].n)).toBe(1);
});
