// Clear the losing period's address on a conflict the app cannot edit —
// `npm run db:remediate:conflicting-addresses`.
//
// WHY it exists, WHICH periods it may touch, HOW the winner is chosen and WHY it refuses
// above five rows are argued once, in src/lib/addressConflictRemediation.ts, which this
// file is a runner for. Same division as the check and backfill runners beside it, and
// the `--compilerOptions` override on the npm script is there for the same reason
// (knowledge note a-ts-node-script-cannot-import-src-lib-without-a-compileroptions-override).
//
// EXIT CODE, which is the whole of the operator contract: 0 means it wrote what the
// report says and nothing else; non-zero means it REFUSED and wrote nothing at all.
// DEFERRED and UNDECIDABLE rows are neither — they are conflicts it deliberately declined
// to erase, reported so `db:check:email-conflicts` reporting them again is expected
// rather than alarming.

import 'dotenv/config';
import {
  clearConflictingAddresses,
  formatAddressConflictRemediationReport,
} from '../../src/lib/addressConflictRemediation';
import { prisma } from '../../src/lib/db';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const db = new URL(process.env.DATABASE_URL).pathname.slice(1);
  console.log(`Clearing the losing period's address on every decidable conflict in ${db}\n`);
  const report = await clearConflictingAddresses();
  console.log(formatAddressConflictRemediationReport(report));
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
