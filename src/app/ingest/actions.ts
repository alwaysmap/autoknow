'use server';

import { revalidatePath } from 'next/cache';
import { getAccessToken } from '../../lib/session';
import { authConfigured } from '../../auth';
import { ingestGoogleDoc, type IngestResult } from '../../lib/ingest';

export interface IngestState {
  result?: IngestResult;
}

export async function ingestAction(_prev: IngestState, formData: FormData): Promise<IngestState> {
  const url = ((formData.get('url') as string) || '').trim();
  if (!url) return { result: { ok: false, error: 'Paste a Google Doc URL.' } };

  const token = await getAccessToken();
  if (!token) {
    return {
      result: {
        ok: false,
        error: authConfigured
          ? 'No Google access token on your session — sign in with Google first.'
          : 'Google auth is not configured. Set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET and sign in to fetch Docs.',
      },
    };
  }

  const result = await ingestGoogleDoc(url, token);

  if (result.ok) {
    revalidatePath('/');
    if (result.attachedTo?.kind === 'project' && result.attachedTo.id) {
      revalidatePath(`/projects/${result.attachedTo.id}`);
    }
    if (result.attachedTo?.kind === 'partner' && result.attachedTo.id) {
      revalidatePath(`/partners/${result.attachedTo.id}`);
    }
  }

  return { result };
}
