/** @jest-environment node */
// The escalation actions' post-back (#245 part c) — and above all the guarantee that it
// CANNOT COST A MUTATION.
//
// The headline case is the fourth test: Chat is down, the user closes an escalation, and
// the close must still be committed with the failure recorded beside it. The tempting
// implementation — await the post inside the same try, or inside the transaction — passes
// every happy-path test and loses a user's close the first time Google returns a 500.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl();

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
// A server action reads the request host to build an absolute link; there is no request
// here, so the action's own degrade path (no link) is what runs.
jest.mock('next/headers', () => ({ headers: jest.fn(async () => new Headers()) }));

const postToThread = jest.fn(
  async () => ({ ok: true }) as { ok: boolean; error?: string; skipped?: boolean },
);
jest.mock('../src/lib/chatPost', () => ({ postToThread }));

type Actions = typeof import('../src/app/actions/escalations');
let setEscalationStatus: Actions['setEscalationStatus'];
let updateEscalation: Actions['updateEscalation'];

let partnerId: number;
let ownerId: number;
let deciderId: number;
let contextUrlId: number;

const form = (fields: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  return fd;
};

/** A chat-sourced escalation with a real source thread — the only shape that posts. */
async function chatEscalation() {
  return prisma.escalation.create({
    data: {
      title: 'Certification slip was communicated late',
      partnerId,
      contextUrlId,
      sourceKind: 'chat',
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  ({ setEscalationStatus, updateEscalation } = await import('../src/app/actions/escalations'));
  await wipeAll();

  const partner = await prisma.partner.create({
    data: {
      name: 'Volvo Cars',
      type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
      region: { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } },
    },
  });
  partnerId = partner.id;
  ownerId = (await prisma.person.create({
    data: { name: 'Marcus Webb', email: 'marcusw@google.com', currentPartnerId: partner.id },
  })).id;
  deciderId = (await prisma.person.create({
    data: { name: 'Priya Sharma', email: 'priya@google.com', currentPartnerId: partner.id },
  })).id;
  contextUrlId = (await prisma.contextUrl.create({
    data: {
      url: 'https://chat.google.com/room/volvo/cert',
      type: 'Chat',
      sourceRef: 'chat:spaces/AAA/threads/cert',
    },
  })).id;
});

afterEach(() => {
  postToThread.mockClear();
  postToThread.mockImplementation(async () => ({ ok: true }));
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('a status change is posted back to the source thread', () => {
  it('posts the change, names it, and records the delivery', async () => {
    const e = await chatEscalation();
    const result = await setEscalationStatus(form({ escalationId: e.id, status: 'resolved' }));
    expect(result).toEqual({});

    expect(postToThread).toHaveBeenCalledTimes(1);
    const [sourceRef, text] = postToThread.mock.calls[0] as unknown as [string, string];
    expect(sourceRef).toBe('chat:spaces/AAA/threads/cert');
    expect(text).toContain(`#${e.id}`);
    // The post names the CHANGE (#245 decision 2) …
    expect(text).toContain('Closed — Resolved');
    expect(text).toContain('Certification slip was communicated late');

    const row = await prisma.escalation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.lastChatPostAt).not.toBeNull();
    expect(row.lastChatPostError).toBeNull();
  });

  it('never names the person who made the change', async () => {
    // Posts are visible to everyone in the space. "Dylan closed this" is a different
    // disclosure from "this is closed", and only the second one was agreed to.
    const e = await chatEscalation();
    await setEscalationStatus(form({ escalationId: e.id, status: 'obsolete' }));
    const [, text] = postToThread.mock.calls[0] as unknown as [string, string];
    for (const actor of ['dylan', 'Dylan', 'dev', 'by ']) expect(text).not.toContain(actor);
  });

  it('posts a re-open too — the thread has to hear that it came back', async () => {
    const e = await chatEscalation();
    await setEscalationStatus(form({ escalationId: e.id, status: 'resolved' }));
    postToThread.mockClear();
    await setEscalationStatus(form({ escalationId: e.id, status: 'open' }));
    const [, text] = postToThread.mock.calls[0] as unknown as [string, string];
    expect(text).toContain('Open');
  });

  it('COMMITS THE CHANGE when the post fails, and records the error on the row', async () => {
    // The whole reason the post is awaited AFTER the write and never inside it.
    postToThread.mockImplementation(async () => ({ ok: false, error: 'Chat API 503' }));
    const e = await chatEscalation();

    const result = await setEscalationStatus(form({ escalationId: e.id, status: 'resolved' }));
    // The user sees no error: their change worked.
    expect(result).toEqual({});

    const row = await prisma.escalation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe('resolved');
    expect(row.closedAt).not.toBeNull();
    // …and the failure is recorded rather than swallowed, which is what the detail page's
    // badge reads (AGENTS lesson 5).
    expect(row.lastChatPostError).toBe('Chat API 503');
    // A failure leaves the last SUCCESSFUL post time alone — the row still records the
    // last time the thread genuinely heard from us.
    expect(row.lastChatPostAt).toBeNull();
  });

  it('clears a stale error once a later post succeeds', async () => {
    postToThread.mockImplementation(async () => ({ ok: false, error: 'Chat API 503' }));
    const e = await chatEscalation();
    await setEscalationStatus(form({ escalationId: e.id, status: 'resolved' }));

    postToThread.mockImplementation(async () => ({ ok: true }));
    await setEscalationStatus(form({ escalationId: e.id, status: 'open' }));

    const row = await prisma.escalation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.lastChatPostError).toBeNull();
    expect(row.lastChatPostAt).not.toBeNull();
  });
});

describe('assignments are posted back', () => {
  const fields = (over: Record<string, string | number> = {}) => ({
    title: 'Certification slip was communicated late',
    summary: '',
    partnerId,
    projectId: '',
    severity: '',
    orgLevel: '',
    ownerPersonId: '',
    decisionMakerPersonId: '',
    requestedOfPersonId: '',
    ...over,
  });

  it('names every role that actually changed, and the person now in it', async () => {
    const e = await chatEscalation();
    await updateEscalation(form({ ...fields({ ownerPersonId: ownerId, decisionMakerPersonId: deciderId }), escalationId: e.id }));

    expect(postToThread).toHaveBeenCalledTimes(1);
    const [, text] = postToThread.mock.calls[0] as unknown as [string, string];
    expect(text).toContain('Owner is now Marcus Webb');
    expect(text).toContain('Decision maker is now Priya Sharma');
    // Not a role that did not change.
    expect(text).not.toContain('Requested of');
  });

  it('says so when a role is cleared', async () => {
    const e = await chatEscalation();
    await updateEscalation(form({ ...fields({ ownerPersonId: ownerId }), escalationId: e.id }));
    postToThread.mockClear();
    await updateEscalation(form({ ...fields(), escalationId: e.id }));

    const [, text] = postToThread.mock.calls[0] as unknown as [string, string];
    expect(text).toContain('Owner is now unassigned');
  });

  it('stays SILENT when an edit changes no assignment', async () => {
    // An assignment is a CHANGE. Re-announcing the same owner would make every title edit
    // read as a reassignment, and the thread would learn to ignore these posts.
    const e = await chatEscalation();
    await updateEscalation(form({ ...fields({ ownerPersonId: ownerId }), escalationId: e.id }));
    postToThread.mockClear();

    await updateEscalation(form({
      ...fields({ ownerPersonId: ownerId, title: 'Certification slip — reworded' }),
      escalationId: e.id,
    }));
    expect(postToThread).not.toHaveBeenCalled();
  });

  it('commits the assignment when the post fails', async () => {
    postToThread.mockImplementation(async () => ({ ok: false, error: 'Chat API 500' }));
    const e = await chatEscalation();

    expect(await updateEscalation(form({ ...fields({ ownerPersonId: ownerId }), escalationId: e.id }))).toEqual({});
    const row = await prisma.escalation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.ownerPersonId).toBe(ownerId);
    expect(row.lastChatPostError).toBe('Chat API 500');
  });
});

describe('when chat is not configured at all', () => {
  it('leaves BOTH delivery columns untouched rather than stamping a delivery', async () => {
    // The local-dev and CI posture. A skip is not a send: writing `lastChatPostAt` here
    // would make every escalation on every developer machine claim the thread had been
    // told, which is the faked result AGENTS lesson 5 forbids.
    postToThread.mockImplementation(async () => ({ ok: true, skipped: true }));
    const e = await chatEscalation();

    await setEscalationStatus(form({ escalationId: e.id, status: 'resolved' }));

    const row = await prisma.escalation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe('resolved');
    expect(row.lastChatPostAt).toBeNull();
    expect(row.lastChatPostError).toBeNull();
  });

  it('does not erase a real earlier delivery when a later change is skipped', async () => {
    const e = await chatEscalation();
    await setEscalationStatus(form({ escalationId: e.id, status: 'resolved' }));
    const delivered = await prisma.escalation.findUniqueOrThrow({ where: { id: e.id } });
    expect(delivered.lastChatPostAt).not.toBeNull();

    postToThread.mockImplementation(async () => ({ ok: true, skipped: true }));
    await setEscalationStatus(form({ escalationId: e.id, status: 'open' }));

    const after = await prisma.escalation.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.lastChatPostAt).toEqual(delivered.lastChatPostAt);
  });
});

describe('an escalation with nowhere to post', () => {
  it('does not post, and does not record an error, for a manually raised one', async () => {
    // A manual escalation has no source thread. That is not a delivery failure, and
    // marking it as one would put a red badge on every escalation raised in the app.
    const e = await prisma.escalation.create({
      data: { title: 'Raised in the app', partnerId, sourceKind: 'manual' },
      select: { id: true },
    });
    await setEscalationStatus(form({ escalationId: e.id, status: 'resolved' }));

    expect(postToThread).not.toHaveBeenCalled();
    const row = await prisma.escalation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe('resolved');
    expect(row.lastChatPostError).toBeNull();
    expect(row.lastChatPostAt).toBeNull();
  });

  it('does not post for a chat escalation whose thread was never linked', async () => {
    const e = await prisma.escalation.create({
      data: { title: 'Chat-sourced but unlinked', partnerId, sourceKind: 'chat' },
      select: { id: true },
    });
    await setEscalationStatus(form({ escalationId: e.id, status: 'addressed' }));

    expect(postToThread).not.toHaveBeenCalled();
    const row = await prisma.escalation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe('addressed');
    expect(row.lastChatPostError).toBeNull();
  });
});
