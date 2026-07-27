// Read-only preflight for #127 E9's unique-at-an-instant constraint —
// `npm run db:check:email-conflicts`. WHY a constraint needs a preflight at all is
// argued once, in src/lib/emailConflictCheck.ts, which this file is a runner for — same
// division as the two backfill runners beside it, and the reason for the
// `--compilerOptions` override on the npm script is the same too (knowledge note
// a-ts-node-script-cannot-import-src-lib-without-a-compileroptions-override).
//
// SELECT and nothing else. Exit code is 1 when conflicts exist, unlike the backfills next
// door: their leftovers are a report to act on later, whereas this answers a yes/no
// question that gates a merge, and a green tick on a run that found conflicts is exactly
// how one gets missed.

import 'dotenv/config';
import { findEmailConflicts, formatEmailConflictReport } from '../../src/lib/emailConflictCheck';
import { prisma } from '../../src/lib/db';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const db = new URL(process.env.DATABASE_URL).pathname.slice(1);
  console.log(`Checking ${db} for addresses held by two people at once\n`);
  const conflicts = await findEmailConflicts();
  console.log(formatEmailConflictReport(conflicts));
  if (conflicts.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
