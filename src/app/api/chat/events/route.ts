import { NextRequest, NextResponse } from 'next/server';
import { chatConfigured, verifyChatToken, handleChatEvent, normalizeChatEvent } from '../../../../lib/chatEvents';
import { formatChatReply } from '../../../../lib/chatEvents';
import { originFromHeaders } from '../../../../lib/appOrigin';

export const dynamic = 'force-dynamic';

// Google Chat interaction events (plan §5.1 / slice 4). Two auth+framing shapes:
// legacy HTTP Chat apps (chat@system JWT, top-level `type`) and add-on-framework
// apps (Google ID token for the gsuiteaddons SA, `chat.*Payload` envelope) — both
// verified/normalized in lib/chatEvents. The JSON we return is the app's reply.

export async function POST(req: NextRequest) {
  if (!chatConfigured) {
    return NextResponse.json(
      { error: 'Chat ingestion is off — set GOOGLE_PROJECT_NUMBER and the service-account key (docs/OPERATIONS.md §6).' },
      { status: 503 },
    );
  }

  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;
  const expectedUrl = `https://${req.headers.get('host')}/api/chat/events`;
  const verified = await verifyChatToken(bearer, expectedUrl);
  console.log(`[chat] event received — jwt ${verified ? 'verified' : 'REJECTED'}`);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const normalized = body ? normalizeChatEvent(body) : null;
  if (!normalized) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const { event, addon } = normalized;
  // Log opaque thread ids, not sender emails or message/reply text — PII in logs
  // has retention implications, and the thread id is enough to correlate.
  console.log(`[chat] type=${event.type} addon=${addon} thread=${event.message?.thread?.name ?? '-'}`);

  // So an escalate reply can carry an ABSOLUTE link (#245 part b) — through the ONE origin
  // derivation (lib/appOrigin), which the outbound post-back shares. The handler omits the
  // link entirely rather than emit a broken one when the host cannot be read.
  const reply = await handleChatEvent(event, { appOrigin: originFromHeaders(req.headers) });
  console.log(`[chat] replied (${reply && 'text' in reply ? 'text' : 'empty'})`);
  return NextResponse.json(formatChatReply(reply, addon));
}
