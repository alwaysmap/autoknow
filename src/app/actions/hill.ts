'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { getCurrentUser } from '../../lib/session';
import { hillStatus } from '../../lib/phase';
import { parseForm, phaseHillSchema } from '../../lib/schemas';
import { requirePhaseInProject } from '../../lib/phaseInvolvement';

// A single-phase hill-chart update: move the dot (progress) + a REQUIRED note — a
// position change without words is unreadable later, and the AI brief digests the
// words. Records a new PhaseState row — 0..100 progress, timestamp, notes, phaseId,
// and the person who made it. The previous update is recovered by ordering on
// timestamp. Status is inferred from progress, never picked.
//
// One zod gate (lib/schemas), as its program twin `updateNeedleStatus` already had; the
// hand-parsing this replaced carried no range at all, and `zHillProgress` holds that
// history (autoknow-9l4).
export async function updatePhaseHill(formData: FormData) {
  const { phaseId, projectId, hillChartProgress, notes } = parseForm(phaseHillSchema, formData);

  // Parentage, which the schema cannot answer: the phase must sit in the program the form
  // names. The JSON twin asks (a mismatched pair is its 404, added in 1add972); this
  // action did not, so a crafted post could append an update to ANY phase in the database
  // and then revalidate an unrelated program's page. That is the hole d3773c1 (#219)
  // closed for phase involvement, which is why the resolver IT added is the one reused
  // here rather than a second spelling of the same query.
  await requirePhaseInProject(phaseId, projectId);

  const latest = await prisma.phaseState.findFirst({
    where: { phaseId },
    orderBy: { timestamp: 'desc' },
  });

  // A blank dot means "no movement" — carry the last position rather than resetting it.
  const progress = hillChartProgress ?? latest?.hillChartProgress ?? 0;
  // The status column is kept populated for continuity, but it is derived from progress —
  // not a user choice — so display never depends on the stored value.
  const status = hillStatus(progress);
  const source = (await getCurrentUser()).handle;

  await prisma.phaseState.create({
    data: {
      phaseId,
      status,
      // Health lives on the program needle; carry the phase's last value for continuity.
      // No prior value stays NULL — the column is nullable, and defaulting to 'On Track'
      // PERSISTED a health judgement nobody made (#129). A continuity carry has nothing
      // to carry on the first update, and that is not the same as "healthy".
      theNeedle: latest?.theNeedle ?? null,
      hillChartProgress: progress,
      notes,
      source,
    },
  });

  revalidatePath(`/programs/${projectId}`);
  revalidatePath('/ecosystem'); // the dashboard
  revalidatePath('/'); // the landing page's latest-updates teasers
  revalidatePath('/ecosystem-summary');
}

// One phase's COMPLETE update log, newest first. The program page fetches only the
// 6 newest states per phase (it renders a dozen phases at once and the log is
// append-only and unbounded), so the phase's PROGRESS view — the update-and-history
// affordance on its card, and the only place the full log is readable — pulls the
// rest on demand, for the one phase you opened.
export interface PhaseLogEntry {
  /** The `PhaseState`'s own id — what `#phase-:id-progress-:stateId` ADDRESSES. Carried
   *  for the same reason `NeedleChange.id` is: without it a link to one hill update can
   *  only open the whole log (autoknow-51j). */
  id: number;
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
    select: { id: true, timestamp: true, hillChartProgress: true, notes: true, source: true },
  });
  return states.map((s) => ({
    id: s.id,
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
