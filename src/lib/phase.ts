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
