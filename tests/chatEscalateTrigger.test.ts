/** @jest-environment node */
// The @AutoKnow escalate trigger (#245 part b): the pure parser, then the four paths the
// handler has to get right — raise, refuse a duplicate, re-raise once everything on the
// thread is closed, and still raise when the thread could not be read.
//
// Set up exactly like tests/chatAckHonesty.test.ts, which drives the same handler: Gemini
// reports configured (the handler refuses to save otherwise) while the process holds no
// key, so the real summarize/embed take their deterministic no-key paths.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.AUTH_ALLOWED_DOMAIN = '';

jest.mock('server-only', () => ({}));
jest.mock('../src/lib/gemini', () => ({
  ...jest.requireActual('../src/lib/gemini'),
  geminiConfigured: true,
}));
jest.mock('../src/lib/googleAuth', () => ({
  getServiceAccountToken: jest.fn(async () => 'service-token'),
  driveConfigured: true,
  CHAT_BOT_SCOPE: 'https://www.googleapis.com/auth/chat.bot',
}));

let chatEvents: typeof import('../src/lib/chatEvents');
let prisma: typeof import('./helpers/db').prisma;

const realFetch = global.fetch;

function threadOf(count: number, opts?: { failing?: boolean }) {
  global.fetch = jest.fn(async () => {
    if (opts?.failing) return new Response('no history', { status: 403 });
    return Response.json({
      messages: Array.from({ length: count }, (_, i) => ({
        text: `message number ${i} about the certification slip`,
        sender: { displayName: `Person ${i}` },
      })),
    });
  }) as typeof fetch;
}

/** A mention carrying `argumentText` — Chat's "the message minus the @mention". */
const mention = (thread: string, argumentText: string) => ({
  type: 'MESSAGE',
  message: {
    name: `${thread}/messages/1`,
    text: `@AutoKnow ${argumentText}`,
    argumentText,
    thread: { name: thread },
    sender: { displayName: 'Dylan', email: 'dylan@alwaysmap.com' },
  },
  space: { name: 'spaces/AAA', displayName: 'EX90 cert' },
});

const textOf = (reply: { text?: string }) => reply.text ?? '';

beforeAll(async () => {
  chatEvents = await import('../src/lib/chatEvents');
  ({ prisma } = await import('./helpers/db'));
  await wipeAll();
});

afterAll(async () => {
  global.fetch = realFetch;
  await disconnectTestDb();
});

describe('parseEscalateTrigger', () => {
  const parse = (s: string | null | undefined) => chatEvents.parseEscalateTrigger(s);

  it('fires on the plain verb and keeps the topic', () => {
    expect(parse('escalate the cert slip on EX90')).toEqual({
      raw: 'escalate the cert slip on EX90',
      topic: 'the cert slip on EX90',
    });
  });

  it('treats a leading slash as the same trigger', () => {
    // What a client that does not resolve the real slash command sends as plain text.
    expect(parse('/escalate the cert slip')?.topic).toBe('the cert slip');
  });

  it('is case-insensitive and tolerates a colon', () => {
    expect(parse('Escalate: the cert slip')?.topic).toBe('the cert slip');
    expect(parse('ESCALATE the cert slip')?.topic).toBe('the cert slip');
  });

  it('strips ONE leading @handle, so a payload with only `text` behaves the same', () => {
    expect(parse('@AutoKnow escalate the cert slip')).toEqual({
      raw: 'escalate the cert slip',
      topic: 'the cert slip',
    });
  });

  it('fires with no topic at all — answering "escalate this" with a syntax complaint is worse', () => {
    expect(parse('escalate')).toEqual({ raw: 'escalate', topic: '' });
    expect(parse('escalate this')?.topic).toBe('this');
  });

  it('does NOT fire mid-sentence, which is the whole point of the word boundary', () => {
    expect(parse('we escalated this yesterday')).toBeNull();
    expect(parse('please escalate the cert slip')).toBeNull();
    expect(parse('escalation status?')).toBeNull();
    expect(parse('escalates the issue')).toBeNull();
  });

  it('handles nothing at all', () => {
    expect(parse('')).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse(undefined)).toBeNull();
  });
});

describe('a triggered mention raises an escalation', () => {
  it('saves the thread AND creates an escalation linked to it', async () => {
    threadOf(3);
    const reply = textOf(
      await chatEvents.handleChatEvent(
        mention('spaces/AAA/threads/raise', 'escalate the cert slip on EX90'),
        { appOrigin: 'https://autoknow.example.com' },
      ),
    );

    const context = await prisma.contextUrl.findUniqueOrThrow({
      where: { sourceRef: 'chat:spaces/AAA/threads/raise' },
    });
    const escalation = await prisma.escalation.findFirstOrThrow({
      where: { contextUrlId: context.id },
    });

    expect(escalation.status).toBe('open');
    expect(escalation.sourceKind).toBe('chat');
    expect(escalation.raisedBy).toBe('dylan@alwaysmap.com');
    // Provenance is the trigger text VERBATIM, including the verb.
    expect(escalation.originalRequest).toBe('escalate the cert slip on EX90');
    // The title seeds from the topic, not from the whole trigger.
    expect(escalation.title).toBe('the cert slip on EX90');
    // UNASSIGNED and UNTRIAGED, deliberately: guessing a Person from display names in a
    // digest puts a real human's name on somebody else's escalation.
    expect(escalation.ownerPersonId).toBeNull();
    expect(escalation.decisionMakerPersonId).toBeNull();
    expect(escalation.requestedOfPersonId).toBeNull();
    expect(escalation.severity).toBeNull();
    expect(escalation.orgLevel).toBeNull();

    // The reply names the escalation and links to it absolutely — a Chat message is read
    // outside the app, so a relative path would resolve against chat.google.com.
    expect(reply).toContain(`#${escalation.id}`);
    expect(reply).toContain(`https://autoknow.example.com/escalations/${escalation.id}`);
  });

  it('names the escalation without a link when no origin is known', async () => {
    threadOf(2);
    const reply = textOf(
      await chatEvents.handleChatEvent(mention('spaces/AAA/threads/nolink', 'escalate the audio codec choice')),
    );
    const escalation = await prisma.escalation.findFirstOrThrow({
      where: { title: 'the audio codec choice' },
    });
    expect(reply).toContain(`#${escalation.id}`);
    // A broken link is worse than no link.
    expect(reply).not.toMatch(/https?:\/\//);
  });

  it('still raises one when the thread history could not be read', async () => {
    // Extraction failure degrades to the mentioning message (AGENTS lesson 5) — creation
    // fails only if the DATABASE write fails, never because the thread was unreadable.
    threadOf(0, { failing: true });
    const reply = textOf(
      await chatEvents.handleChatEvent(mention('spaces/AAA/threads/nohistory', 'escalate the missing sign-off')),
    );
    await expect(
      prisma.escalation.findFirstOrThrow({ where: { title: 'the missing sign-off' } }),
    ).resolves.toBeTruthy();
    expect(reply).toMatch(/only your message/i);
  });

  it('falls back to the digest when the trigger carries no topic', async () => {
    threadOf(2);
    await chatEvents.handleChatEvent(mention('spaces/AAA/threads/notopic', 'escalate'));
    const context = await prisma.contextUrl.findUniqueOrThrow({
      where: { sourceRef: 'chat:spaces/AAA/threads/notopic' },
    });
    const escalation = await prisma.escalation.findFirstOrThrow({ where: { contextUrlId: context.id } });
    expect(escalation.originalRequest).toBe('escalate');
    // Something a human wrote or the model distilled — never an empty title, and never a
    // generated placeholder.
    expect(escalation.title.length).toBeGreaterThan(0);
  });
});

describe('a second trigger on the same thread', () => {
  const thread = 'spaces/AAA/threads/twice';

  it('refuses to create a second OPEN escalation, and says which one already exists', async () => {
    threadOf(2);
    await chatEvents.handleChatEvent(mention(thread, 'escalate the first ask'));
    const first = await prisma.escalation.findFirstOrThrow({ where: { title: 'the first ask' } });

    // The thread GREW — the snapshot must still run, because that revision is worth
    // capturing whether or not a new escalation comes of it.
    threadOf(6);
    const reply = textOf(
      await chatEvents.handleChatEvent(
        mention(thread, 'escalate the same thing again'),
        { appOrigin: 'https://autoknow.example.com' },
      ),
    );

    expect(reply).toMatch(/already tracked/i);
    expect(reply).toContain(`#${first.id}`);
    expect(reply).toContain(`https://autoknow.example.com/escalations/${first.id}`);

    const context = await prisma.contextUrl.findUniqueOrThrow({ where: { sourceRef: `chat:${thread}` } });
    expect(await prisma.escalation.count({ where: { contextUrlId: context.id } })).toBe(1);
    // The revision was captured even though nothing new was created.
    expect(await prisma.contextRevision.count({ where: { contextUrlId: context.id } })).toBeGreaterThan(1);
  });

  it('re-raises once every escalation on the thread is closed', async () => {
    const context = await prisma.contextUrl.findUniqueOrThrow({ where: { sourceRef: `chat:${thread}` } });
    await prisma.escalation.updateMany({
      where: { contextUrlId: context.id },
      data: { status: 'resolved', closedAt: new Date() },
    });

    threadOf(9);
    const reply = textOf(await chatEvents.handleChatEvent(mention(thread, 'escalate this has come back')));

    expect(reply).not.toMatch(/already tracked/i);
    expect(await prisma.escalation.count({ where: { contextUrlId: context.id } })).toBe(2);
    await expect(
      prisma.escalation.findFirstOrThrow({ where: { contextUrlId: context.id, status: 'open' } }),
    ).resolves.toBeTruthy();
  });
});

describe('the plain-mention path is unchanged by the branch', () => {
  it('still saves and acks a mention that is not a trigger', async () => {
    threadOf(3);
    const reply = textOf(
      await chatEvents.handleChatEvent(mention('spaces/AAA/threads/plain', 'save this thread about the audio HAL')),
    );
    expect(reply).toMatch(/^Saved/);
    const context = await prisma.contextUrl.findUniqueOrThrow({
      where: { sourceRef: 'chat:spaces/AAA/threads/plain' },
    });
    // No escalation — the whole point of the word-boundary test above, at the handler.
    expect(await prisma.escalation.count({ where: { contextUrlId: context.id } })).toBe(0);
  });

  it('refuses a sender outside the allowed domain BEFORE the trigger is acted on', async () => {
    // The branch sits after the domain gate on purpose: a sender we will not ingest from
    // is a sender we will not raise an escalation for.
    process.env.AUTH_ALLOWED_DOMAIN = 'alwaysmap.com';
    threadOf(2);
    const before = await prisma.escalation.count();
    const reply = textOf(
      await chatEvents.handleChatEvent({
        type: 'MESSAGE',
        message: {
          name: 'spaces/AAA/threads/outsider/messages/1',
          text: '@AutoKnow escalate let me in',
          argumentText: 'escalate let me in',
          thread: { name: 'spaces/AAA/threads/outsider' },
          sender: { displayName: 'Mallory', email: 'mallory@example.com' },
        },
        space: { name: 'spaces/AAA' },
      }),
    );
    process.env.AUTH_ALLOWED_DOMAIN = '';

    expect(reply).toMatch(/only ingests messages/i);
    expect(await prisma.escalation.count()).toBe(before);
  });
});
