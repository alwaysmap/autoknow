'use server';

import { revalidatePath } from 'next/cache';
import { getAccessToken } from '../../lib/session';
import { authConfigured } from '../../auth';
import { ingestLink, type IngestResult } from '../../lib/ingest';
import { inferSource } from '../../lib/sources';

export interface IngestState {
  result?: IngestResult;
}

export async function ingestAction(_prev: IngestState, formData: FormData): Promise<IngestState> {
  const url = ((formData.get('url') as string) || '').trim();
  if (!url) return { result: { ok: false, error: 'Paste a link.' } };

  // Unscoped ingest: no anchor — the global classifier places it. Drive fetches
  // ride on the signed-in user's token until the service account lands.
  const token = await getAccessToken();
  if (!token && inferSource(url).kind === 'drive') {
    return {
      result: {
        ok: false,
        error: authConfigured
          ? 'No Google access token on your session — sign in with Google first.'
          : 'Google auth is not configured. Set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET and sign in to fetch Docs.',
      },
    };
  }

  const result = await ingestLink({ url, userAccessToken: token });

  if (result.ok) {
    revalidatePath('/');
    if (result.attachedTo?.kind === 'project' && result.attachedTo.id) {
      revalidatePath(`/programs/${result.attachedTo.id}`);
    }
    if (result.attachedTo?.kind === 'partner' && result.attachedTo.id) {
      revalidatePath(`/partners/${result.attachedTo.id}`);
    }
  }

  return { result };
}
