/** @jest-environment node */
// The ratchet behind fixtures.wipeAll's "every model, no exceptions" contract. A wipe
// that silently skips a table is not a smaller wipe — it is a suite that passes once and
// fails the second time you run it. The two incidents that bought that contract are named
// in wipeAll's docblock; the point HERE is that prose cannot stop the third one and this
// can (AGENTS lesson 2).
//
// Both halves guard one contract, so they share a file even though only the second needs
// a database — a source scan and a DB round-trip in one file is a deviation from how the
// other ratchets in tests/ are packaged, and a deliberate one.
import { readFileSync } from 'node:fs';
import { stripComments } from './helpers/sourceFiles';
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram, wipeAll } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();
jest.mock('server-only', () => ({}));

/** Every `model X` in the schema, as the property name Prisma Client exposes it under
 *  (first letter lowercased — that is the whole of Prisma's rule). */
function schemaModels(): string[] {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)]
    .map((m) => m[1][0].toLowerCase() + m[1].slice(1));
}

/** The models `wipeAll` actually deletes — read out of its BODY, and with comments
 *  stripped first, so neither a `deleteMany` elsewhere in the file nor a model merely
 *  NAMED in the docblock can pass for coverage. */
function wipedModels(): string[] {
  const src = stripComments(readFileSync('tests/helpers/fixtures.ts', 'utf8'));
  const after = src.split('export async function wipeAll()')[1];
  if (after === undefined) throw new Error('wipeAll is no longer declared as `export async function wipeAll()`');
  // The body ends at the first column-0 `}`. Both assumptions are checked rather than
  // trusted: a scrape that quietly took in the REST of the file would read every
  // `deleteMany` in it and report full coverage forever.
  const body = after.split('\n}')[0];
  if (body === after) throw new Error('Could not find the end of wipeAll — is its closing brace still at column 0?');
  return [...body.matchAll(/prisma\.(\w+)\.deleteMany\(/g)].map((m) => m[1]);
}

/** Row count per model, keyed by the Prisma Client property name. The cast is the only
 *  way to index the client dynamically — its generated type has no index signature. */
async function rowCounts(): Promise<Record<string, number>> {
  const client = prisma as unknown as Record<string, { count: () => Promise<number> }>;
  const entries = await Promise.all(
    schemaModels().map(async (model) => [model, await client[model].count()] as const),
  );
  return Object.fromEntries(entries);
}

describe('fixtures.wipeAll covers the whole schema', () => {
  const models = schemaModels();
  const wiped = wipedModels();

  it('deletes every model in prisma/schema.prisma', () => {
    // If this fails you added a model. Add `await prisma.<model>.deleteMany()` to
    // wipeAll in FK-safe order (children before parents). There is no exception list on
    // purpose: reference rows are all recreated on demand, so nothing needs to survive.
    const missing = models.filter((m) => !wiped.includes(m));
    expect(missing).toEqual([]);
  });

  it('names only models that exist — a renamed model must not leave a dead line behind', () => {
    const stale = wiped.filter((m) => !models.includes(m));
    expect(stale).toEqual([]);
  });
});

describe('fixtures.wipeAll leaves an empty database', () => {
  afterAll(async () => {
    await wipeAll();
    await disconnectTestDb();
  });

  it('empties every table it names, in an order Postgres accepts', async () => {
    // Populate the program graph (partners, regions, types, project, phases, states,
    // people, context) and then the tables it does not reach — including the three the
    // wipe used to skip.
    const seeded = await seedProgram();
    // Dynamic import AFTER the DATABASE_URL assignment above — a static one is hoisted
    // over it and binds src/lib/db to the wrong database (the repo's standard pattern).
    const { ensureBuiltinTemplates } = await import('../src/lib/programTemplates');
    await ensureBuiltinTemplates();
    await prisma.summary.create({
      data: {
        scope: 'program', targetId: seeded.projectId, trigger: 'manual', model: 'test',
        windowStart: new Date(0), windowEnd: new Date(), tldr: 'x',
        body: { sections: [] }, sourceCounts: {},
      },
    });
    await prisma.summaryPrompt.create({ data: { scope: 'program', prompt: 'x' } });
    await prisma.partnerState.create({
      data: { partnerId: seeded.oemId, notes: 'x', source: 'testbot' },
    });
    await prisma.personAffiliation.create({
      data: { personId: seeded.personId, partnerId: seeded.supplierId, role: 'FAE', startDate: new Date(0) },
    });
    const url = await prisma.contextUrl.findFirstOrThrow({ where: { projectId: seeded.projectId } });
    await prisma.contextRevision.create({
      data: { contextUrlId: url.id, contentHash: 'abc', digest: 'x' },
    });
    await prisma.actionItem.create({
      data: { phaseId: seeded.phases.integration, description: 'x', status: 'Pending', source: 'testbot' },
    });
    await prisma.syncCursor.create({ data: { key: 'drive', value: 'token' } });
    await prisma.skippedSource.create({
      data: { fileId: 'f1', name: 'n', mimeType: 'application/pdf', reason: 'unsupported-type' },
    });
    await prisma.ingestionCycleSummary.create({ data: {} });
    await prisma.ingestionSettings.create({ data: {} });
    await prisma.ignoredAddress.create({
      data: { address: 'android-team@google.com', dismissedBy: 'testbot' },
    });

    // Vacuous-pass guard: assert the setup above really did fill EVERY table, so
    // "all zero afterwards" is evidence about the wipe and not about an empty database.
    const unfilled = Object.entries(await rowCounts()).filter(([, n]) => n === 0);
    expect(unfilled).toEqual([]);

    await wipeAll();

    const survivors = Object.entries(await rowCounts()).filter(([, n]) => n !== 0);
    expect(survivors).toEqual([]);
  });
});
