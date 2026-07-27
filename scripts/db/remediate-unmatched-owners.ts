// Repoint the programs whose `Project.ownerName` names nobody —
// `npm run db:remediate:unmatched-owners`.
//
// WHY it exists, WHICH rows it may touch, HOW the replacement owner is chosen and WHY it
// refuses above two rows are argued once, in src/lib/ownerRemediation.ts, which this file
// is a runner for. Same division as the backfill and check runners beside it, and the
// `--compilerOptions` override on the npm script is there for the same reason (knowledge
// note a-ts-node-script-cannot-import-src-lib-without-a-compileroptions-override).
//
// EXIT CODE, which is the whole of the operator contract: 0 means it wrote what the
// report says and nothing else; non-zero means it REFUSED and wrote nothing at all.
// Unlike the backfills next door, leftovers are not a report to act on later — this arm
// has exactly one job, so either it did it or it declined to.

import 'dotenv/config';
import { formatOwnerRemediationReport, repointUnresolvableOwners } from '../../src/lib/ownerRemediation';
import { prisma } from '../../src/lib/db';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const db = new URL(process.env.DATABASE_URL).pathname.slice(1);
  console.log(`Repointing programs whose ownerName matches no person, in ${db}\n`);
  const report = await repointUnresolvableOwners();
  console.log(formatOwnerRemediationReport(report));
  if (report.refused) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
