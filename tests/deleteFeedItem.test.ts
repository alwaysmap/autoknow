/** @jest-environment node */
// autoknow-805 — removing an ingested-context feed card. `deleteFeedItem`'s 'ctx-' branch
// was a bare `contextUrl.delete`, so it threw P2003 and 500'd the server action for
// exactly the rows the card is offered on; the childless case it did work for is the one
// that barely exists. Why ContextUrl's three children each behave differently under that
// delete — and why only one of the three is loud — is in
// docs/knowledge/an-unstated-prisma-ondelete-crashes-or-orphans-depending-only-on-optionality.md
//
// The other three prefixes are deliberately absent: ProjectState / PhaseState /
// PartnerState have no children at all, which is why the fix is one branch and not four.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

// Dynamic import AFTER the env assignment above — a static import is hoisted and would
// evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
let deleteFeedItem: typeof import('../src/app/actions/status').deleteFeedItem;

const form = (id: string) => {
  const fd = new FormData();
  fd.set('id', id);
  return fd;
};

beforeAll(async () => {
  ({ deleteFeedItem } = await import('../src/app/actions/status'));
  await wipeAll();
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

describe("deleteFeedItem 'ctx-'", () => {
  it('removes an ingested row that carries revisions, instead of dying on the FK', async () => {
    const ctx = await prisma.contextUrl.create({
      data: {
        url: 'https://example.com/doc-805',
        type: 'Doc',
        title: 'A doc with the history every ingested row has',
        ingestedText: 'digest',
      },
    });
    // Two revisions: the one ingest always writes, plus a refresh — the shape a watched
    // source reaches, so the fix is proven against more than a single child row.
    await prisma.contextRevision.createMany({
      data: [
        { contextUrlId: ctx.id, contentHash: 'hash-1', digest: 'first ingest' },
        { contextUrlId: ctx.id, contentHash: 'hash-2', digest: 'refresh' },
      ],
    });

    await expect(deleteFeedItem(form(`ctx-${ctx.id}`))).resolves.toBeUndefined();

    expect(await prisma.contextUrl.findUnique({ where: { id: ctx.id } })).toBeNull();
    expect(await prisma.contextRevision.count({ where: { contextUrlId: ctx.id } })).toBe(0);
  });

  it('leaves an escalation that cites the row alive, with its citation nulled', async () => {
    // Escalation.contextUrlId is SET NULL, so it never blocked this delete — pinned so a
    // future "delete the children" sweep does not quietly start deleting escalations too.
    const ctx = await prisma.contextUrl.create({
      data: { url: 'https://example.com/doc-805-esc', type: 'Chat', ingestedText: 'digest' },
    });
    await prisma.contextRevision.create({
      data: { contextUrlId: ctx.id, contentHash: 'hash-1', digest: 'first ingest' },
    });
    const partner = await prisma.partner.create({
      data: {
        name: 'Escalating Partner 805',
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    const esc = await prisma.escalation.create({
      data: { title: 'Needs a decision', partnerId: partner.id, contextUrlId: ctx.id },
    });

    await deleteFeedItem(form(`ctx-${ctx.id}`));

    const escalationAfter = await prisma.escalation.findUnique({ where: { id: esc.id } });
    expect(escalationAfter).not.toBeNull();
    expect(escalationAfter?.contextUrlId).toBeNull();
  });

  it('returns early on an id with no prefix separator', async () => {
    await expect(deleteFeedItem(form('nope'))).resolves.toBeUndefined();
  });

  it('returns early on a non-numeric suffix, rather than handing NaN to Prisma', async () => {
    await expect(deleteFeedItem(form('ctx-not-a-number'))).resolves.toBeUndefined();
  });
});
