'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { ingestLink, type IngestResult, type IngestAnchor } from '../../lib/ingest';
import { refreshSource } from '../../lib/refresh';
import { getAccessToken, getCurrentUser } from '../../lib/session';
import { geminiConfigured } from '../../lib/gemini';

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

export async function refreshSourceAction(formData: FormData) {
  const id = parseInt((formData.get('id') as string) || '', 10);
  if (Number.isNaN(id)) throw new Error('Invalid source id');
  await refreshSource(id, { userAccessToken: await getAccessToken() });
  revalidatePath('/manage/sources');
  const path = (formData.get('path') as string) || null;
  if (path) revalidatePath(path);
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
