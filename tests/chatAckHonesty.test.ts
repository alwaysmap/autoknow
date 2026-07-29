/** @jest-environment node */
// What the Google Chat app SAYS it did (#56, the scaling ADR's decision 3, SCALING_LIMITS
// §3). The connector reads ONE THREAD's first 100 messages, ONCE — it does not watch the
// space, and a re-read only happens when a human @mentions it again. Every ack must
// therefore carry the snapshot caveat, must say so when the 100-message cap actually bit,
// and must admit when it fell back to the single mentioning message because the thread
// history was unreadable (that degrade used to be silent: the ack said "Saved" either way).
//
// The vocabulary assertions are deliberate: "room" and "watched" are the two words that
// would make this reply a lie, so they are asserted absent rather than left to review.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { t } from '../src/lib/i18n';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.AUTH_ALLOWED_DOMAIN = '';

jest.mock('server-only', () => ({}));
// Gemini is "configured" (the handler refuses to save otherwise) while the process holds
// no key at all (tests/no-live-gemini.ts). requireActual keeps the REAL
// summarizeDocument/embedForStorage, so they take their deterministic no-key path.
jest.mock('../src/lib/gemini', () => ({
  ...jest.requireActual('../src/lib/gemini'),
  geminiConfigured: true,
}));
jest.mock('../src/lib/googleAuth', () => ({
  getServiceAccountToken: jest.fn(async () => 'service-token'),
  driveConfigured: true,
  CHAT_BOT_SCOPE: 'https://www.googleapis.com/auth/chat.bot',
}));

let handleChatEvent: typeof import('../src/lib/chatEvents').handleChatEvent;
let THREAD_MESSAGE_LIMIT: number;

const realFetch = global.fetch;

/** Answer the Chat messages.list call with `count` messages, optionally reporting more. */
function threadOf(count: number, opts?: { more?: boolean; failing?: boolean }) {
  global.fetch = jest.fn(async () => {
    if (opts?.failing) return new Response('no history', { status: 403 });
    return Response.json({
      messages: Array.from({ length: count }, (_, i) => ({
        text: `message number ${i} about the audio HAL`,
        sender: { displayName: `Person ${i}` },
      })),
      ...(opts?.more ? { nextPageToken: 'more-please' } : {}),
    });
  }) as typeof fetch;
}

const mention = (thread: string) => ({
  type: 'MESSAGE',
  message: {
    name: `${thread}/messages/1`,
    text: '@autoknow save this',
    argumentText: 'save this thread about the audio HAL bring-up',
    thread: { name: thread },
    sender: { displayName: 'Dylan', email: 'dylan@alwaysmap.com' },
  },
  space: { name: 'spaces/AAA', displayName: 'Audio bring-up' },
});

const textOf = (reply: { text?: string }) => reply.text ?? '';

beforeAll(async () => {
  ({ handleChatEvent, THREAD_MESSAGE_LIMIT } = await import('../src/lib/chatEvents'));
  await wipeAll();
});

afterAll(async () => {
  global.fetch = realFetch;
  await disconnectTestDb();
});

describe('the Chat ack tells the truth about what it captured', () => {
  it('introduces itself as a per-thread snapshot, never as a room watch', async () => {
    const text = textOf(await handleChatEvent({ type: 'ADDED_TO_SPACE', space: { name: 'spaces/AAA' } }));
    expect(text).toMatch(/thread/i);
    expect(text).toMatch(/snapshot/i);
    expect(text).toContain(String(THREAD_MESSAGE_LIMIT));
    expect(text).not.toMatch(/\broom\b/i);
    expect(text).not.toMatch(/\bwatch(ed|ing)?\b(?!\s+this space)/i);
  });

  it('carries the snapshot caveat on a normal save', async () => {
    threadOf(3);
    const text = textOf(await handleChatEvent(mention('spaces/AAA/threads/short')));
    expect(text).toMatch(/^Saved/);
    expect(text).toMatch(/snapshot of this one thread/i);
    expect(text).not.toMatch(/\broom\b/i);
    // Nothing was cut off and the history read fine, so neither caveat appears.
    expect(text).not.toContain(String(THREAD_MESSAGE_LIMIT));
    expect(text).not.toMatch(/only your message/i);
  });

  it('says so when the thread is longer than one snapshot reads', async () => {
    threadOf(THREAD_MESSAGE_LIMIT, { more: true });
    const text = textOf(await handleChatEvent(mention('spaces/AAA/threads/long')));
    expect(text).toMatch(/^Saved/);
    expect(text).toMatch(new RegExp(`longer than ${THREAD_MESSAGE_LIMIT} messages`, 'i'));
    expect(text).toMatch(new RegExp(`first ${THREAD_MESSAGE_LIMIT}`, 'i'));
  });

  it('admits when it saved only the mentioning message', async () => {
    threadOf(0, { failing: true });
    const text = textOf(await handleChatEvent(mention('spaces/AAA/threads/nohistory')));
    expect(text).toMatch(/^Saved/);
    expect(text).toMatch(/only your message was saved/i);
  });

  it('says nothing is read until it is mentioned, and repeats the caveat on an update', async () => {
    threadOf(2);
    await handleChatEvent(mention('spaces/AAA/threads/again'));
    threadOf(4); // the thread grew — a re-mention is the ONLY way that is ever noticed
    const text = textOf(await handleChatEvent(mention('spaces/AAA/threads/again')));
    expect(text).toMatch(/^Updated/);
    expect(text).toMatch(/snapshot of this one thread/i);
  });

  it('reports an unchanged thread as already saved', async () => {
    threadOf(2);
    await handleChatEvent(mention('spaces/AAA/threads/same'));
    threadOf(2);
    expect(textOf(await handleChatEvent(mention('spaces/AAA/threads/same')))).toMatch(/already saved/i);
  });
});

// #245 part b. The escalate replies join the same contract rather than getting their own,
// weaker one: they are the same app speaking into the same thread, and the claim they could
// most easily imply falsely is the STRONGER version of the one above — not just "this
// snapshot is a snapshot", but "the escalation you now have does not follow this thread".
// A reader who believes otherwise stops @mentioning and the escalation silently goes stale.
describe('the escalate replies tell the same truth', () => {
  /** The trigger form of `mention` — same message, an escalate topic in `argumentText`. */
  const escalate = (thread: string) => ({
    ...mention(thread),
    message: { ...mention(thread).message, argumentText: 'escalate the certification slip' },
  });

  it('says the escalation does not follow the thread, and never says room or watched', async () => {
    threadOf(3);
    const text = textOf(await handleChatEvent(escalate('spaces/AAA/threads/esc-new')));
    expect(text).toMatch(/does not follow this thread/i);
    expect(text).toMatch(/snapshot/i);
    expect(text).toMatch(/@mention me again/i);
    expect(text).not.toMatch(/\broom\b/i);
    expect(text).not.toMatch(/\bwatch(ed|ing)?\b(?!\s+this space)/i);
  });

  it('states that nothing is assigned or triaged, rather than implying it is handled', async () => {
    // The reply is the only thing most raisers will read. "Raised as Escalation #7" alone
    // reads as "somebody has it now", which is exactly what has NOT happened.
    threadOf(3);
    const text = textOf(await handleChatEvent(escalate('spaces/AAA/threads/esc-untriaged')));
    expect(text).toMatch(/nobody is assigned/i);
    expect(text).toMatch(/not triaged/i);
  });

  it('carries the same cap and unreadable caveats the plain ack does', async () => {
    threadOf(THREAD_MESSAGE_LIMIT, { more: true });
    const capped = textOf(await handleChatEvent(escalate('spaces/AAA/threads/esc-long')));
    expect(capped).toMatch(new RegExp(`longer than ${THREAD_MESSAGE_LIMIT} messages`, 'i'));

    threadOf(0, { failing: true });
    const unreadable = textOf(await handleChatEvent(escalate('spaces/AAA/threads/esc-nohistory')));
    expect(unreadable).toMatch(/only your message was saved/i);
  });

  it('admits the escalation was not raised even though the thread was saved', async () => {
    // The two facts come apart — the snapshot commits before the escalation is created —
    // so the failure copy must not be reachable only as a generic "could not save".
    for (const locale of ['en', 'de', 'ja', 'ko'] as const) {
      const failed = t(locale, 'chatEscalationSaveFailed', { reason: 'db down' });
      expect(failed).toContain('db down');
      expect(failed.length).toBeGreaterThan('db down'.length);
    }
  });

  it('has every escalate reply translated, in the honest vocabulary, in all four locales', async () => {
    const keys = [
      'chatEscalationNotWatching',
      'chatEscalationCreated',
      'chatEscalationCreatedNoLink',
      'chatEscalationExists',
      'chatEscalationExistsNoLink',
      'chatEscalationSaveFailed',
    ] as const;
    for (const locale of ['en', 'de', 'ja', 'ko'] as const) {
      for (const key of keys) {
        const s = t(locale, key, { n: 7, url: 'https://x.example/escalations/7', reason: 'x' });
        expect(s.length).toBeGreaterThan(0);
        // No unfilled slots — a reply reading "Escalation #{n}" is worse than no reply.
        expect(s).not.toMatch(/\{[a-z]+\}/i);
        expect(s).not.toMatch(/\broom\b/i);
      }
    }
  });
});
