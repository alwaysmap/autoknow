import 'server-only';
import { getServiceAccountToken, chatConfigured, CHAT_BOT_SCOPE } from './googleAuth';

// THE outbound Google Chat sender (#245 part c) — the app's FIRST unsolicited Chat message.
// Everything the connector sent before this was a reply to a message that had just
// @mentioned it; this speaks into a thread because something changed in the app.
//
// That asymmetry is why the whole module is built around never throwing. An inbound reply
// that fails fails the request that asked for it, and the user sees it. An outbound post
// that fails is a side effect of a mutation somebody already committed — so if it threw, a
// Chat outage would roll back an escalation close that had nothing wrong with it. The
// result is RETURNED, the caller records it on the row, and the page says so honestly
// (AGENTS lesson 5). Nothing here is allowed to be the reason a mutation fails.
//
// Any future outbound Chat message goes through this function, not a second hand-rolled
// fetch — the sweep AGENTS lesson 7 asks for, named here so it is not left to memory.

/** Three outcomes, not two. SKIPPED is its own answer because "we did not post" and "we
 *  posted" must not be recorded the same way: a caller that treats a skip as a success
 *  stamps a delivery time for a message nobody sent, and the page then claims the thread
 *  was told (AGENTS lesson 5 — degrade honestly, never fake a result). */
export type ChatPostResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true }
  | { ok: false; error: string };

/**
 * The space and thread a `ContextUrl.sourceRef` names.
 *
 * Chat sourceRefs are written by `lib/chatEvents` as `chat:spaces/X/threads/Y` — but the
 * thread half is not guaranteed: `threadName` there falls back to the MESSAGE name when a
 * message carries no thread, which yields `chat:spaces/X/messages/Z`. So the parse returns
 * a space with an OPTIONAL thread rather than assuming the shape, and a post with no
 * thread simply starts one (see `messageReplyOption` below).
 *
 * Exported for its own tests: a silent parse failure here means a post that never happens,
 * which is the failure mode least likely to be noticed.
 */
export function parseChatSourceRef(
  sourceRef: string | null | undefined,
): { space: string; thread: string | null } | null {
  if (!sourceRef) return null;
  const ref = sourceRef.startsWith('chat:') ? sourceRef.slice('chat:'.length) : sourceRef;
  const m = /^(spaces\/[^/]+)(?:\/threads\/([^/]+))?/.exec(ref.trim());
  if (!m) return null;
  return { space: m[1], thread: m[2] ? `${m[1]}/threads/${m[2]}` : null };
}

/**
 * Post `text` into the thread `sourceRef` names. Never throws.
 *
 * `REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD` is the deliberate choice over `REPLY_MESSAGE`:
 * the latter fails outright when the thread no longer exists, which would turn an ordinary
 * "this thread was deleted" into a permanent delivery error on every future change to that
 * escalation. Falling back to a new message keeps the update visible in the space it
 * belongs to, which is the point of posting at all.
 *
 * Config-gated on the same `chatConfigured` the inbound route uses, so local development
 * and CI — where there is no Chat app and no credential — skip with a log line instead of
 * failing (AGENTS lesson 5: degrade honestly, never crash and never fake a result). A skip
 * is neither an error nor a delivery: `{ ok: true, skipped: true }`. Reporting it as a
 * failure would put a red badge on every escalation on every developer machine; reporting
 * it as a success would stamp "Posted to the chat thread" onto a message nobody sent.
 */
export async function postToThread(
  sourceRef: string | null | undefined,
  text: string,
): Promise<ChatPostResult> {
  if (!chatConfigured) {
    console.log('[chatPost] chat is not configured — skipping outbound post');
    return { ok: true, skipped: true };
  }

  const target = parseChatSourceRef(sourceRef);
  if (!target) return { ok: false, error: `Not a chat source: ${sourceRef ?? 'none'}` };

  try {
    const token = await getServiceAccountToken([CHAT_BOT_SCOPE]);
    const res = await fetch(
      `https://chat.googleapis.com/v1/${target.space}/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(target.thread ? { text, thread: { name: target.thread } } : { text }),
      },
    );
    if (!res.ok) {
      // The status and Google's own message, truncated: this string is rendered in the UI
      // as the delivery-failure badge's detail, and an unbounded API body is not copy.
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      return { ok: false, error: `Chat API ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}
