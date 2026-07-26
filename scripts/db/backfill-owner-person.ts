// Fill `Project.ownerPersonId` from the `ownerName` text that predates it (#127 E6) —
// `npm run db:backfill:owner-person`.
//
// Idempotent and re-runnable: it only touches rows whose `ownerPersonId` is still NULL,
// and it writes nothing it is not certain of. The rule it applies, and why unmatched and
// ambiguous rows are LEFT NULL rather than guessed at, is written once — in
// src/lib/ownerBackfill.ts, which this file is a runner for.
//
// Exit code is 0 even with leftovers: they are a report to act on, not a failure. The
// count that has to reach zero before #127 E7 moves the readers onto the FK is printed
// on the last line.

import 'dotenv/config';
// This file IMPORTS the logic rather than restating it, which is the whole point — the
// resolution rule has one implementation and the tests exercise that one. That costs a
// `--compilerOptions` override on the npm script: the repo's tsconfig is `esnext` /
// `bundler` for Next, and under it ts-node runs a script as an ES module, where every
// relative import needs a file extension and `src/lib`'s do not have them (the
// constraint scripts/dev/demo.ts documents and scripts/db/audit-embeddings.ts gave up
// on). Compiling this one file as CommonJS resolves them the way the tests do.
import { backfillProjectOwnerPerson, formatOwnerBackfillReport } from '../../src/lib/ownerBackfill';
import { prisma } from '../../src/lib/db';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  console.log(`Backfilling Project.ownerPersonId in ${new URL(process.env.DATABASE_URL).pathname.slice(1)}\n`);
  console.log(formatOwnerBackfillReport(await backfillProjectOwnerPerson()));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
