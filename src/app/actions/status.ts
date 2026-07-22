'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';

// Remove a single status/activity entry (a weekly update, phase tag, relationship
// change, or ingested context). The id is the FeedItem id, e.g. "ps-12" / "phs-3" /
// "pas-4" / "ctx-9".
export async function deleteFeedItem(formData: FormData) {
  const id = String(formData.get('id') || '');
  const revalidate = String(formData.get('revalidate') || '');
  const dash = id.indexOf('-');
  if (dash < 0) return;
  const prefix = id.slice(0, dash);
  const n = parseInt(id.slice(dash + 1), 10);
  if (Number.isNaN(n)) return;

  switch (prefix) {
    case 'ps':
      await prisma.projectState.delete({ where: { id: n } });
      break;
    case 'phs':
      await prisma.phaseState.delete({ where: { id: n } });
      break;
    case 'pas':
      await prisma.partnerState.delete({ where: { id: n } });
      break;
    case 'ctx':
      await prisma.contextUrl.delete({ where: { id: n } });
      break;
    default:
      return;
  }

  revalidatePath('/ecosystem'); // the dashboard
  revalidatePath('/'); // the landing page's latest-updates teasers
  if (revalidate) revalidatePath(revalidate);
}
