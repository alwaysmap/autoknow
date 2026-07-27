// Fill `PersonAffiliation.email` for the careers that predate the column (#127 E8) —
// `npm run db:backfill:affiliation-email`.
//
// Idempotent and re-runnable: it only touches periods whose `email` is still NULL, and
// it writes nothing it is not certain of. The rule it applies — the address on the
// Person row belongs to the period covering the run instant, and to no other — is
// written once, in src/lib/affiliationEmailBackfill.ts, which this file is a runner for.
//
// Exit code is 0 even with leftovers: they are a report to act on, not a failure. The
// counts a human reads before deciding anything are printed at the end.

import 'dotenv/config';
// This file IMPORTS the logic rather than restating it, which is the whole point — the
// rule has one implementation and the tests exercise that one. That costs a
// `--compilerOptions` override on the npm script, for the reason spelled out in
// scripts/db/backfill-owner-person.ts and in the knowledge note
// a-ts-node-script-cannot-import-src-lib-without-a-compileroptions-override.
import {
  backfillAffiliationEmail,
  formatAffiliationEmailReport,
} from '../../src/lib/affiliationEmailBackfill';
import { prisma } from '../../src/lib/db';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const db = new URL(process.env.DATABASE_URL).pathname.slice(1);
  console.log(`Backfilling PersonAffiliation.email in ${db}\n`);
  console.log(formatAffiliationEmailReport(await backfillAffiliationEmail()));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
