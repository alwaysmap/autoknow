// Find (and optionally repair) rows whose stored embedding is the deterministic FALLBACK
// rather than a real one — `npm run db:embeddings:audit [-- --fix]`.
//
// Why these exist, and why they cannot heal on their own:
// docs/adr/2026-07-26-a-stored-vector-fails-loud-a-query-vector-fails-soft.md.
//
// HOW WE TELL THEM APART — by L2 norm, not by guessing. The fallback fills 768 components
// with the fractional part of a sine, i.e. uniform in [0,1), so its norm is
// sqrt(768 · E[x²]) = sqrt(768/3) ≈ 16. A real embedding is unit-scale, ~1. There is no
// overlap worth arguing about, so the threshold sits far from both.
//
// The norm alone is the test. An exact recompute-and-compare was dropped: ts-node cannot
// import src/lib/embedding-fallback here (the ESM extension constraint demo.ts documents),
// and a second copy of the generator is drift risk to settle what the norm settles 16-to-1.

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const FALLBACK_NORM_MIN = 5; // ≈16 for the fallback, ≈1 for a real vector
const TABLES = ['ContextUrl', 'Partner', 'Project', 'Person'] as const;

const FIX = process.argv.includes('--fix');
const ZEROS = `[${new Array(768).fill(0).join(',')}]`;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** L2 norm via distance from the origin — pgvector has no norm function exposed. */
async function suspects(table: string): Promise<{ id: number; norm: number }[]> {
  return prisma.$queryRawUnsafe(
    `SELECT id, (embedding <-> $1::vector) AS norm
       FROM "${table}"
      WHERE embedding IS NOT NULL AND (embedding <-> $1::vector) > $2
      ORDER BY id`,
    ZEROS,
    FALLBACK_NORM_MIN,
  );
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  console.log(`Auditing embeddings in ${new URL(process.env.DATABASE_URL).pathname.slice(1)}\n`);

  let total = 0;
  for (const table of TABLES) {
    const rows = await suspects(table);
    total += rows.length;
    if (rows.length === 0) {
      console.log(`  ${table.padEnd(11)} clean`);
      continue;
    }
    console.log(`  ${table.padEnd(11)} ${rows.length} row(s) hold a fallback vector (norm ≈ ${rows[0].norm.toFixed(1)})`);

    if (table === 'ContextUrl') {
      // Name them — these are the sources to re-ingest once quota is back.
      const detail = await prisma.contextUrl.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
        select: { id: true, title: true, url: true },
      });
      for (const d of detail) console.log(`      #${d.id}  ${d.title ?? d.url}`);
    }
  }

  console.log(
    total === 0
      ? '\nNo poisoned embeddings. Nothing to do.'
      : `\n${total} row(s) affected. These cannot self-heal: refresh sees contentHash unchanged and skips them.`,
  );

  if (total > 0 && !FIX) {
    console.log('Re-run with `-- --fix` to clear the affected vectors so the next cycle re-embeds them.');
  } else if (total > 0 && FIX) {
    // Clearing the vector — rather than embedding here — is deliberate: it needs no Gemini
    // quota (which is likely still the thing that is exhausted), it is idempotent, and the
    // normal ingest path is the one place that knows how to build each row's index text.
    for (const table of TABLES) {
      const rows = await suspects(table);
      if (!rows.length) continue;
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET embedding = NULL WHERE id = ANY($1::int[])`,
        rows.map((r) => r.id),
      );
      console.log(`  cleared ${rows.length} vector(s) in ${table}`);
    }
    console.log('\nCleared. Re-embed by re-ingesting those sources once Gemini has quota again.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
