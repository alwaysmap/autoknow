/** @jest-environment node */
// The outbound Chat sender (#245 part c) — the app's first unsolicited Chat message.
//
// The property under test is mostly a NEGATIVE one, which is why it needs its own file:
// this function may never throw and may never be the reason a mutation fails. A test that
// only checked the happy path would pass against an implementation that rethrows on a 500,
// and the damage from that shows up as an escalation close being rolled back by a Chat
// outage — in production, not here.

jest.mock('server-only', () => ({}));

const getServiceAccountToken = jest.fn(async () => 'service-token');

// Configured/unconfigured is a MODULE-LEVEL const in lib/googleAuth (it reads env at
// import), so the gate is exercised by re-mocking and re-importing rather than by mutating
// process.env — which would have no effect after the first import.
const loadChatPost = async (configured: boolean) => {
  jest.resetModules();
  jest.doMock('../src/lib/googleAuth', () => ({
    getServiceAccountToken,
    chatConfigured: configured,
    driveConfigured: true,
    CHAT_BOT_SCOPE: 'https://www.googleapis.com/auth/chat.bot',
  }));
  return await import('../src/lib/chatPost');
};

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  getServiceAccountToken.mockClear();
});

describe('parseChatSourceRef', () => {
  let parseChatSourceRef: typeof import('../src/lib/chatPost').parseChatSourceRef;

  beforeAll(async () => {
    ({ parseChatSourceRef } = await loadChatPost(true));
  });

  it('reads the space and thread out of the ref lib/chatEvents writes', () => {
    expect(parseChatSourceRef('chat:spaces/AAA/threads/BBB')).toEqual({
      space: 'spaces/AAA',
      thread: 'spaces/AAA/threads/BBB',
    });
  });

  it('handles the MESSAGE-name shape, which the ingest side can also produce', () => {
    // `threadName` in lib/chatEvents falls back to the message name when a message carries
    // no thread — so this shape is real, and assuming `/threads/` would silently drop it.
    expect(parseChatSourceRef('chat:spaces/AAA/messages/CCC')).toEqual({
      space: 'spaces/AAA',
      thread: null,
    });
  });

  it('tolerates a ref with no `chat:` prefix', () => {
    expect(parseChatSourceRef('spaces/AAA/threads/BBB')?.space).toBe('spaces/AAA');
  });

  it('refuses anything that is not a chat ref', () => {
    expect(parseChatSourceRef('drive:1a2b3c')).toBeNull();
    expect(parseChatSourceRef('https://example.com/doc')).toBeNull();
    expect(parseChatSourceRef('')).toBeNull();
    expect(parseChatSourceRef(null)).toBeNull();
    expect(parseChatSourceRef(undefined)).toBeNull();
  });
});

describe('postToThread', () => {
  it('posts into the thread, replying rather than starting a new one', async () => {
    const { postToThread } = await loadChatPost(true);
    const fetchMock = jest.fn(async () => Response.json({ name: 'spaces/AAA/messages/1' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await postToThread('chat:spaces/AAA/threads/BBB', 'Escalation #7 is now closed.');
    expect(result).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('https://chat.googleapis.com/v1/spaces/AAA/messages');
    // The fallback matters: REPLY_MESSAGE alone fails outright on a deleted thread, which
    // would make every future change to that escalation a permanent delivery error.
    expect(url).toContain('messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
    expect(JSON.parse(String(init.body))).toEqual({
      text: 'Escalation #7 is now closed.',
      thread: { name: 'spaces/AAA/threads/BBB' },
    });
    expect(getServiceAccountToken).toHaveBeenCalledWith(['https://www.googleapis.com/auth/chat.bot']);
  });

  it('omits the thread when the ref names only a space', async () => {
    const { postToThread } = await loadChatPost(true);
    const fetchMock = jest.fn(async () => Response.json({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await postToThread('chat:spaces/AAA/messages/CCC', 'hello');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: 'hello' });
  });

  it('reports a non-2xx as an error instead of throwing', async () => {
    const { postToThread } = await loadChatPost(true);
    global.fetch = jest.fn(async () => new Response('thread not found', { status: 404 })) as unknown as typeof fetch;

    const result = await postToThread('chat:spaces/AAA/threads/BBB', 'x');
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('404');
    expect((result as { error: string }).error).toContain('thread not found');
  });

  it('swallows a thrown network error', async () => {
    const { postToThread } = await loadChatPost(true);
    global.fetch = jest.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;

    await expect(postToThread('chat:spaces/AAA/threads/BBB', 'x')).resolves.toEqual({
      ok: false,
      error: 'ECONNRESET',
    });
  });

  it('swallows a token failure — the credential path is not the caller’s problem either', async () => {
    const { postToThread } = await loadChatPost(true);
    getServiceAccountToken.mockRejectedValueOnce(new Error('no key'));
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(postToThread('chat:spaces/AAA/threads/BBB', 'x')).resolves.toEqual({
      ok: false,
      error: 'no key',
    });
  });

  it('reports a non-chat source as an error rather than posting somewhere', async () => {
    const { postToThread } = await loadChatPost(true);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await postToThread('drive:1a2b3c', 'x');
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a skip as a SKIP when chat is not configured — not as a delivery', async () => {
    // Local dev and CI have no Chat app. The skip is neither an error nor a success:
    // flagged `ok` so nothing treats it as a failure (that would put a red badge on every
    // escalation on every developer machine), and `skipped` so nothing treats it as a
    // delivery (that would stamp "Posted to the chat thread" onto a message nobody sent).
    const { postToThread } = await loadChatPost(false);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(postToThread('chat:spaces/AAA/threads/BBB', 'x')).resolves.toEqual({
      ok: true,
      skipped: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does NOT mark a real delivery as skipped', async () => {
    const { postToThread } = await loadChatPost(true);
    global.fetch = jest.fn(async () => Response.json({})) as unknown as typeof fetch;
    const result = await postToThread('chat:spaces/AAA/threads/BBB', 'x');
    expect(result).toEqual({ ok: true });
    expect((result as { skipped?: boolean }).skipped).toBeUndefined();
  });
});
