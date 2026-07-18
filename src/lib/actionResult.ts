// Server-action error contract for dialog forms. Thrown server-action messages are
// masked in production, so a recoverable failure must RETURN { error } for the
// dialog to render inline — otherwise the route error boundary swallows the user's
// modal input. redirect() works by throwing and must always propagate.

export interface ActionResult {
  error?: string;
}

function isNextRedirect(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

/** Run an action body; deliberate, user-readable failures come back as { error }. */
export async function guarded(work: () => Promise<void>): Promise<ActionResult> {
  try {
    await work();
    return {};
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    console.error('server action failed:', e);
    const msg = e instanceof Error ? e.message : '';
    // parseForm ("Invalid input — …") and the guard messages in the actions
    // ("… — reassign first") are written for users; raw internals are not.
    const readable = msg.startsWith('Invalid input') || msg.includes(' — ');
    return { error: readable ? msg : 'Something went wrong — the change was not saved.' };
  }
}
