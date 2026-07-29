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

/**
 * The date a phase's work began. An explicit "started on" claim (the Active toggle)
 * ALWAYS wins — work often begins before the first update is filed. Otherwise it is
 * DERIVED from the first progress — but only while the phase is still in flight:
 * dragging the dot back to 0% with no explicit claim RETRACTS a premature start, so
 * the phase reads Not Started again. Without this gate a single historical progress
 * row pinned the phase "started" forever, and a user could never undo a mistaken
 * start (they'd have deleted append-only history to do it).
 *
 * @param explicit        the Phase.startedAt column (the Active toggle), or null
 * @param currentProgress the LATEST state's progress (0..100)
 * @param firstProgressAt earliest timestamp with progress > 0, or null
 */
export function effectiveStartedAt<T>(
  explicit: T | null,
  currentProgress: number,
  firstProgressAt: T | null,
): T | null {
  if (explicit != null) return explicit;
  return currentProgress > 0 ? firstProgressAt : null;
}

/**
 * THE PHASE'S OWN FRAGMENT — and, since autoknow-crw.4, the phase's whole address.
 *
 * A phase's home is its CARD on the program rail. It was the focused DETAILS popover
 * until that retired, and a standalone `/history/phase/:id` page before that
 * (2026-07-21); the card states the goal, the latest update and who is involved
 * without opening anything, so there is nothing left for a second URL to name.
 *
 * One fragment, whichever page is reading it: on the program page it names the rail's
 * row (and arriving there opens that card), and on the phase editor it names the node
 * whose panel opens.
 */
export const phaseHash = (phaseId: number): string => `phase-${phaseId}`;

/** The full deep link to a phase: `/programs/12#phase-218`. */
export const phaseHref = (projectId: number, phaseId: number): string =>
  `/programs/${projectId}#${phaseHash(phaseId)}`;

/**
 * The phase's PROGRESS view — recording an update and the full hill log, which is one
 * affordance because an update IS an entry in that log. The only thing the card still
 * opens over itself, and addressable for the same reason the popover was: a history
 * someone can link to is worth more than a modal that only opens by clicking.
 *
 * It extends `phaseHash` rather than standing alone, so a reader who knows one
 * fragment can guess the other and neither can collide with the other's target.
 */
export const phaseProgressHash = (phaseId: number): string => `phase-${phaseId}-progress`;

/** The full deep link to a phase's update log: `/programs/12#phase-218-progress`. */
export const phaseProgressHref = (projectId: number, phaseId: number): string =>
  `/programs/${projectId}#${phaseProgressHash(phaseId)}`;

/** Where a phase's plan is EDITED — name, forecast, dependencies, Goal & DoD, and who
 *  is involved: since #crw.1 this is the ONE editor of a phase, so an Edit affordance
 *  anywhere has exactly one target. Distinct from phaseHref, which opens one phase's
 *  record to READ. Pass a phaseId to land with that phase's panel already open — a
 *  phase editor is a place, not a mode. Owned here for the same reason as the rest of
 *  this family: it was hand-built at four call sites, and a URL in this app is data as
 *  well as code (AGENTS lesson 15). */
export const phasesEditHref = (projectId: number, phaseId?: number): string =>
  `/programs/${projectId}/phases${phaseId != null ? `#${phaseHash(phaseId)}` : ''}`;

/** Phase id out of a `#phase-:id-progress` fragment (with or without the `#`), or null. */
export const parsePhaseProgressHash = (hash: string): number | null => {
  const m = /^#?phase-(\d+)-progress$/.exec(hash);
  return m ? parseInt(m[1], 10) : null;
};

/** Phase id out of a bare `#phase-:id` fragment, or null. Deliberately does NOT match
 *  the `-progress` or the retired `-detail` extension: the fragments open different
 *  things, and a prefix match would make the row anchor swallow both. */
export const parsePhaseHash = (hash: string): number | null => {
  const m = /^#?phase-(\d+)$/.exec(hash);
  return m ? parseInt(m[1], 10) : null;
};

/**
 * RETIRED (autoknow-crw.4): `#phase-:id-detail` opened the focused popover, which no
 * longer exists. Kept only to RECOGNISE the fragment, never to build one — the two
 * places that still have to are the read-boundary shim that rewrites stored AI-brief
 * citations (lib/summaries) and the rail's arrival handler, which canonicalises an old
 * bookmark onto the card rather than leaving the reader at the top of the page.
 *
 * A URL here is DATA as well as code (AGENTS lesson 15, and the ADR
 * "Retiring a URL deletes the route and migrates the data that cites it"), so this
 * goes away only once no stored `Summary.body` still cites the old form.
 */
export const parseLegacyPhaseDetailHash = (hash: string): number | null => {
  const m = /^#?phase-(\d+)-detail$/.exec(hash);
  return m ? parseInt(m[1], 10) : null;
};
