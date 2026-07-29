'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { ingestLink, type IngestResult, type IngestAnchor } from '../../lib/ingest';
import { refreshSource } from '../../lib/refresh';
import { getAccessToken, getCurrentUser } from '../../lib/session';
import { geminiConfigured } from '../../lib/gemini';
import { declineIfQuotaBlocked } from '../../lib/geminiQuota';

// Actions for the scoped QuickIngest component and the Manage → Sources operator
// page (docs/INGEST_FRESHNESS_PLAN.md §5.2, §2.2).

export interface QuickIngestState {
  result?: IngestResult;
}

export async function quickIngestAction(_prev: QuickIngestState, formData: FormData): Promise<QuickIngestState> {
  const url = ((formData.get('url') as string) || '').trim();
  if (!url) return { result: { ok: false, error: 'Paste a link first.' } };
  if (!geminiConfigured) {
    return { result: { ok: false, error: 'AI ingestion is off — no GEMINI_API_KEY is configured.' } };
  }
  // Ask BEFORE starting. An ingest is a digest call, sometimes a classify call, then an
  // embed — discovering the cap partway through means work done, money spent and a
  // half-finished request to explain. Declining up front costs nothing and changes
  // nothing (lib/geminiQuota).
  const declined = declineIfQuotaBlocked('quick-ingest', 'the link was not saved');
  if (declined) return { result: { ok: false, error: declined } };

  const mode = formData.get('mode') === 'snapshot' ? 'snapshot' as const : formData.get('mode') === 'watched' ? 'watched' as const : undefined;
  const anchorKind = (formData.get('anchorKind') as string) || '';
  const anchorId = parseInt((formData.get('anchorId') as string) || '', 10);
  const phaseId = parseInt((formData.get('phaseId') as string) || '', 10);

  let anchor: IngestAnchor | null = null;
  if (!Number.isNaN(anchorId)) {
    if (anchorKind === 'program') anchor = { projectId: anchorId, phaseId: Number.isNaN(phaseId) ? null : phaseId };
    else if (anchorKind === 'partner') anchor = { partnerId: anchorId };
  }

  const result = await ingestLink({
    url,
    mode,
    anchor,
    userAccessToken: await getAccessToken(),
    addedBy: (await getCurrentUser()).handle,
  });

  const path = (formData.get('path') as string) || null;
  if (result.ok && path) revalidatePath(path);
  return { result };
}

/** What one "Refresh now" concluded, in the shape the row renders it. Exactly one of
 *  `error` / `result` is ever set: the check either did not happen (a quota decline, a
 *  fetch failure) or it reached a verdict. */
export interface RefreshSourceState {
  error?: string;
  result?: 'unchanged' | 'changed' | 'frozen';
}

/** One re-check attempt, with the provider's failure kept INSIDE it. Split out so the
 *  action below stays the flat guard → attempt → revalidate its siblings are, and so
 *  the every-path revalidate is visible rather than promised by a comment. */
async function attemptSourceRefresh(id: number): Promise<RefreshSourceState> {
  const declined = declineIfQuotaBlocked('source refresh', 'the source was not re-checked');
  if (declined) return { error: declined };
  try {
    const outcome = await refreshSource(id, { userAccessToken: await getAccessToken() });
    return outcome.ok ? { result: outcome.result } : { error: outcome.error };
  } catch (e) {
    // refreshSource returns its own refusals now, so anything still thrown is
    // unexpected — logged in full, and named to the operator rather than swallowed.
    console.error(`source refresh failed (${id}):`, e);
    return { error: `Could not re-check this source: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * "Refresh now" on one watched source. Re-distilling costs a Gemini call, so this is
 * the same shape as quickIngestAction above and as regenerateSummary: ask the quota
 * latch BEFORE spending, and never let a provider failure out of the action.
 *
 * A PROVIDER rejection here is not a failed button — on a bare `<form action={…}>` it
 * cost the whole page
 * (docs/knowledge/a-server-action-a-component-auto-fires-is-on-the-pages-critical-path.md).
 * A bad id still throws: that is our own form malformed, not the world refusing.
 *
 * It now RETURNS the verdict (`useActionState`, the shape quickIngestAction already
 * uses) so the row can render it. Not returning one was the second half of the same
 * defect: the operator saw a row that simply did not advance, and the reason lived only
 * in the server log (autoknow-dv3).
 *
 * The revalidate runs whatever happened, because refreshSource writes `lastCheckedAt`
 * and can freeze the row before it gives up.
 */
export async function refreshSourceAction(
  _prev: RefreshSourceState,
  formData: FormData,
): Promise<RefreshSourceState> {
  const id = parseInt((formData.get('id') as string) || '', 10);
  if (Number.isNaN(id)) throw new Error('Invalid source id');

  const state = await attemptSourceRefresh(id);

  revalidatePath('/manage/sources');
  const path = (formData.get('path') as string) || null;
  if (path) revalidatePath(path);
  return state;
}

/** Pause (freeze as user-paused) or resume a watched source. */
export async function toggleSourcePause(formData: FormData) {
  const id = parseInt((formData.get('id') as string) || '', 10);
  if (Number.isNaN(id)) throw new Error('Invalid source id');
  const row = await prisma.contextUrl.findUnique({ where: { id }, select: { frozenReason: true } });
  if (!row) throw new Error('Unknown source');
  await prisma.contextUrl.update({
    where: { id },
    data:
      row.frozenReason === 'user-paused'
        ? { frozenAt: null, frozenReason: null }
        : { frozenAt: new Date(), frozenReason: 'user-paused' },
  });
  revalidatePath('/manage/sources');
}

/** Flip snapshot ↔ watched; a user decision, recorded so it's never re-inferred away. */
export async function toggleSourceMode(formData: FormData) {
  const id = parseInt((formData.get('id') as string) || '', 10);
  if (Number.isNaN(id)) throw new Error('Invalid source id');
  const row = await prisma.contextUrl.findUnique({ where: { id }, select: { mode: true } });
  if (!row) throw new Error('Unknown source');
  await prisma.contextUrl.update({
    where: { id },
    data: {
      mode: row.mode === 'watched' ? 'snapshot' : 'watched',
      modeSource: 'user',
      // Switching to watched clears a pause; switching to snapshot needs no freeze.
      frozenAt: null,
      frozenReason: null,
    },
  });
  revalidatePath('/manage/sources');
}
