import { NextRequest, NextResponse } from 'next/server';
import { chatConfigured, verifyChatToken, handleChatEvent, type ChatEvent } from '../../../../lib/chatEvents';

export const dynamic = 'force-dynamic';

// Google Chat interaction events (plan §5.1 / slice 4). Auth is the JWT Chat sends
// (issuer chat@system.gserviceaccount.com, audience = our project number) — verified
// in lib/chatEvents. The JSON we return is posted as the app's in-thread reply.

export async function POST(req: NextRequest) {
  if (!chatConfigured) {
    return NextResponse.json(
      { error: 'Chat ingestion is off — set GOOGLE_PROJECT_NUMBER and the service-account key (docs/OPERATIONS.md §6).' },
      { status: 503 },
    );
  }

  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;
  // Behind the Cloud Run relay the original public host rides in a header, so the
  // URL-audience check still matches what's configured in the Chat console.
  const publicHost = req.headers.get('x-autoknow-original-host') ?? req.headers.get('host');
  const expectedUrl = `https://${publicHost}/api/chat/events`;
  const verified = await verifyChatToken(bearer, expectedUrl);
  console.log(`[chat] event received — jwt ${verified ? 'verified' : 'REJECTED'}`);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const event = (await req.json().catch(() => null)) as ChatEvent | null;
  if (!event) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  console.log(`[chat] type=${event.type} sender=${event.message?.sender?.email ?? '-'}`);

  const reply = await handleChatEvent(event);
  console.log(`[chat] reply: ${JSON.stringify(reply).slice(0, 140)}`);
  return NextResponse.json(reply);
}
