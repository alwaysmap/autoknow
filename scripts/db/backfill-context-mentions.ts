// Persist people mentions for ContextUrl rows that predate #177 (or were ingested
// keyless) — `npm run db:backfill:context-mentions [-- --limit 200]`.
//
// Idempotent and re-runnable: pass 1 only touches mentions still unresolved, pass 2
// only rows never extracted by a real model. The floor it applies — a person link is
// written only when the winning tier holds exactly one candidate — is written once, in
// src/lib/mentions.ts, which src/lib/mentionBackfill.ts (this file's logic) consumes.
//
// Exit code is 0 even with leftovers: unresolved mentions and unscanned rows are a
// report to act on (re-run, or fix the directory), not a failure.
//
// Needs GEMINI_API_KEY for pass 2; without it the run performs pass 1 and reports the
// skip honestly. Same CommonJS `--compilerOptions` override as its siblings, plus the
// allow-server-only preload (the import chain crosses src/lib/gemini.ts).

import 'dotenv/config';
import { backfillContextMentions, formatMentionBackfillReport } from '../../src/lib/mentionBackfill';
import { prisma } from '../../src/lib/db';

function parseLimit(argv: string[]): number | undefined {
  const at = argv.indexOf('--limit');
  if (at === -1) return undefined;
  const n = Number(argv[at + 1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--limit needs a non-negative integer, got '${argv[at + 1]}'.`);
  return n;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  console.log(`Backfilling ContextMention in ${new URL(process.env.DATABASE_URL).pathname.slice(1)}\n`);
  console.log(formatMentionBackfillReport(await backfillContextMentions({ limit: parseLimit(process.argv) })));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
