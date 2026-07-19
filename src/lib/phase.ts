// A phase's progress lives entirely on the hill chart: 0..100 percent complete. Status
// is INFERRED from the dot's position — 0 is Not Started, 100 is Done, anything between
// is In Progress. It is never picked by the user, and "Not Started"/"Done" are not a
// stored decision — they are read straight off the progress. 0..100 is internal only.

export function hillStatus(progress: number): string {
  if (progress <= 0) return 'Not Started';
  if (progress >= 100) return 'Done';
  return 'In Progress';
}

export function hillStatusColor(progress: number): string {
  if (progress <= 0) return '#9aa0a6'; // Not Started — gray
  if (progress >= 100) return '#1a7d3c'; // Done — green
  return '#1a4d8f'; // In Progress — blue
}

// Each phase gets its own distinct dot color so the dots on a program's summary hill are
// distinguishable. Phase ids are near-sequential within a program, so indexing the
// palette by id spreads adjacent phases across distinct hues. Stable per phase, so a
// phase keeps the same color in the summary chart, its own card, the feed, and history.
export const PHASE_PALETTE = [
  '#1a73e8', // blue
  '#e8710a', // orange
  '#1e8e3e', // green
  '#9334e6', // purple
  '#d93025', // red
  '#12b5cb', // cyan
  '#f9ab00', // amber
  '#e52592', // pink
  '#7cb342', // lime
  '#5f6368', // slate
];

export function phaseColor(phaseId: number): string {
  const n = PHASE_PALETTE.length;
  return PHASE_PALETTE[((phaseId % n) + n) % n];
}

/** A phase is ACTIVE once work has begun — explicitly marked started (the Active
 *  toggle, set when another team is doing the work and no update exists yet) or
 *  implied by progress. Cycle-time elapsed clocks run while active. */
export function isPhaseActive(progress: number, startedAt: string | null): boolean {
  return (progress > 0 && progress < 100) || (progress < 100 && startedAt != null);
}

/** Progress value to DERIVE display status from: an explicitly-started phase at 0
 *  reads as In Progress, not Not Started (the whole point of the Active toggle). */
export function statusProgress(progress: number, startedAt: string | null): number {
  return progress <= 0 && startedAt != null ? 1 : progress;
}
