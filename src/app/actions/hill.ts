'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { getCurrentUser } from '../../lib/session';
import { hillStatus } from '../../lib/phase';

// A single-phase hill-chart update: move the dot (progress) + a REQUIRED note — a
// position change without words is unreadable later, and the AI brief digests the
// words. Records a new PhaseState row — 0..100 progress, timestamp, notes, phaseId,
// and the person who made it. The previous update is recovered by ordering on
// timestamp. Status is inferred from progress, never picked.
export async function updatePhaseHill(formData: FormData) {
  const phaseId = parseInt(formData.get('phaseId') as string, 10);
  const projectIdStr = formData.get('projectId') as string;
  const progressStr = formData.get('hillChartProgress') as string;
  const notes = ((formData.get('notes') as string) || '').trim() || null;

  if (isNaN(phaseId)) throw new Error('Invalid phase ID');
  if (!notes) throw new Error('A note is required with a hill update');

  const latest = await prisma.phaseState.findFirst({
    where: { phaseId },
    orderBy: { timestamp: 'desc' },
  });

  const progress = progressStr ? parseInt(progressStr, 10) : latest?.hillChartProgress ?? 0;
  // The status column is kept populated for continuity, but it is derived from progress —
  // not a user choice — so display never depends on the stored value.
  const status = hillStatus(progress);
  const source = (await getCurrentUser()).handle;

  await prisma.phaseState.create({
    data: {
      phaseId,
      status,
      // Health lives on the program needle; carry the phase's last value for continuity.
      theNeedle: latest?.theNeedle ?? 'On Track',
      hillChartProgress: progress,
      notes,
      source,
    },
  });

  const projectId = parseInt(projectIdStr, 10);
  if (!isNaN(projectId)) revalidatePath(`/programs/${projectId}`);
  revalidatePath('/ecosystem'); // the dashboard
  revalidatePath('/'); // the landing page's latest-updates teasers
  revalidatePath('/ecosystem-summary');
}

// One phase's COMPLETE update log, newest first. The program page fetches only the
// 6 newest states per phase (it renders a dozen phases at once and the log is
// append-only and unbounded), so the DETAILS popover — now the only place a phase's
// full history is readable — pulls the rest on demand, for the one phase you opened.
export interface PhaseLogEntry {
  at: string;
  progress: number;
  note: string | null;
  by: string | null;
}

export async function getPhaseLog(phaseId: number): Promise<PhaseLogEntry[]> {
  if (!Number.isInteger(phaseId)) throw new Error('Invalid phase ID');
  const states = await prisma.phaseState.findMany({
    where: { phaseId },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true, hillChartProgress: true, notes: true, source: true },
  });
  return states.map((s) => ({
    at: s.timestamp.toISOString(),
    progress: s.hillChartProgress ?? 0,
    note: s.notes,
    by: s.source,
  }));
}

// Explicit "work has begun" toggle (cycle time: wait vs active). Independent of hill
// updates — work frequently starts at a partner long before the first update is
// filed, and the Basecamp convention (first update IS the start) undercounts active
// time. Setting keeps an existing timestamp (the earliest claim wins); clearing
// removes only the explicit marker — a derived start from real progress still applies.
export async function setPhaseStarted(formData: FormData) {
  const phaseId = parseInt(formData.get('phaseId') as string, 10);
  const projectId = parseInt(formData.get('projectId') as string, 10);
  if (isNaN(phaseId) || isNaN(projectId)) throw new Error('Invalid phase');

  const phase = await prisma.phase.findUnique({ where: { id: phaseId }, select: { startedAt: true, projectId: true } });
  if (!phase || phase.projectId !== projectId) throw new Error('Unknown phase');

  // Preferred shape: an explicit start DATE from the dossier's date picker
  // (yyyy-mm-dd; empty string clears the claim). Legacy shape: the boolean
  // `started` flag from the old checkbox — kept so nothing else breaks.
  let startedAt: Date | null;
  const startedOn = formData.get('startedOn');
  if (startedOn != null) {
    const s = String(startedOn);
    if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid start date');
    startedAt = s ? new Date(`${s}T00:00:00`) : null;
  } else {
    startedAt = formData.get('started') === '1' ? (phase.startedAt ?? new Date()) : null;
  }

  await prisma.phase.update({ where: { id: phaseId }, data: { startedAt } });
  revalidatePath(`/programs/${projectId}`);
}
