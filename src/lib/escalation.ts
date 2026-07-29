import type { StringKey } from './i18n';

// THE escalation domain module (#245): what a status MEANS, which change of status is
// legal, and how severity and org level order. Mirrors `lib/lifecycle` (derivation beside
// the enum it derives from) and `lib/health` (display keys separate from stored values).
// Client-safe: pure functions and constant tables, no imports beyond the string-key type.
//
// The one rule that shapes the whole file: the DATABASE stores plain terminal names
// (`resolved`), and "Closed — Resolved" is DERIVED here. Storing the sentence would put
// display copy in a column, and a fifth terminal state would then be a migration instead
// of a line in a table.

export type EscalationStatus = 'open' | 'resolved' | 'duplicate' | 'addressed' | 'obsolete';
export type EscalationSeverity = 's1' | 's2' | 's3';
export type EscalationOrgLevel = 'team' | 'region' | 'director' | 'exec';

/** Every status, in the order a picker offers them: the open state, then the four ways
 *  an escalation ends. */
export const ESCALATION_STATUSES: EscalationStatus[] = [
  'open',
  'resolved',
  'duplicate',
  'addressed',
  'obsolete',
];

/** The four terminal states. `open` is the only non-terminal one, so the set is defined
 *  by exclusion rather than restated — a sixth status added above cannot silently miss
 *  this list. */
export const TERMINAL_STATUSES: EscalationStatus[] = ESCALATION_STATUSES.filter(
  (s) => s !== 'open',
);

/** Closed = any terminal state. The four differ in WHY it ended, never in whether it did,
 *  so every "is this still live" reader goes through this one predicate rather than
 *  spelling out a four-way comparison it would have to keep in step. */
export function isClosed(status: EscalationStatus): boolean {
  return status !== 'open';
}

export function isOpen(status: EscalationStatus): boolean {
  return status === 'open';
}

/**
 * Is this change of status allowed?
 *
 * Three rules, and they are deliberately permissive — closing is open to any signed-in
 * domain user (#245 decision 3), so this guards SHAPE, not permission:
 *   • open → any terminal state (that is what closing is);
 *   • terminal → open (re-opening is legitimate: the decision did not stick);
 *   • terminal → a DIFFERENT terminal state is refused. Re-classifying a closed
 *     escalation in place would silently rewrite the record of how it ended; re-open it
 *     and close it again, which leaves both facts true in order.
 * A no-op (`from === to`) is refused too, so a double-submitted form cannot append a
 * second identical close with a fresh `closedAt`.
 */
export function canTransition(from: EscalationStatus, to: EscalationStatus): boolean {
  if (from === to) return false;
  if (isOpen(from)) return true;
  return isOpen(to);
}

/** Severity rank, WORST FIRST — s1 is the most severe. Used as the default sort among
 *  open escalations, so the number that sorts first is the one that needs attention
 *  first. Untriaged (null) sorts after every real severity: see `severityRank`. */
export const SEVERITY_ORDER: Record<EscalationSeverity, number> = {
  s1: 0,
  s2: 1,
  s3: 2,
};

/** Org-level rank, HIGHEST FIRST — the level that has to act, not how bad it is. */
export const ORG_LEVEL_ORDER: Record<EscalationOrgLevel, number> = {
  exec: 0,
  director: 1,
  region: 2,
  team: 3,
};

/**
 * Is this escalation past the date somebody committed to?
 *
 * DERIVED, never stored: overdue is a function of the target, the clock and the status,
 * so a column holding it would need a cron to keep it true — the O(time) shape the
 * ingestion-health ADR rejects. A CLOSED escalation is never overdue however late it
 * ran: the question "is anybody still waiting" has already been answered.
 *
 * Day-granular deliberately. A target is a DATE somebody typed, not an instant, so an
 * escalation due today is not overdue at 09:00 and overdue at 17:00 — it is overdue
 * tomorrow.
 */
export function isOverdue(
  target: Date | string | null | undefined,
  status: EscalationStatus,
  now: Date = new Date(),
): boolean {
  if (target == null || isClosed(status)) return false;
  const due = localDay(target);
  if (!due) return false;
  // Overdue starts at the first instant of the day AFTER the target.
  const endOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
  return now >= endOfDue;
}

/**
 * A target as a LOCAL calendar day.
 *
 * `new Date('2026-07-29')` is parsed by the spec as UTC midnight, while
 * `new Date('2026-07-29T00:00:00')` is LOCAL — so west of Greenwich a bare `YYYY-MM-DD`
 * lands on the previous local day and an escalation reads as overdue a day early. A
 * target is a date somebody typed into a `<input type="date">`, so the local calendar
 * day is what they meant; the date-only form is therefore split and rebuilt locally
 * rather than handed to the Date parser.
 */
function localDay(target: Date | string): Date | null {
  if (typeof target === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(target.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(target);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Sort key for the target column: NULLs LAST, same argument as `severityRank` — a
 *  missing target is "nobody said", not "infinitely soon". */
export function targetRank(target: Date | string | null | undefined): number {
  if (target == null) return Number.MAX_SAFE_INTEGER;
  const t = new Date(target).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

export const SEVERITIES: EscalationSeverity[] = ['s1', 's2', 's3'];
export const ORG_LEVELS: EscalationOrgLevel[] = ['exec', 'director', 'region', 'team'];

/** A sortable rank where NULL — not yet triaged — lands after every triaged row rather
 *  than before it. `null` is not "lowest severity", it is "nobody has said yet", and a
 *  list that floats unanswered questions to the bottom is the honest reading: the top of
 *  the table is for what somebody has judged urgent. Same argument for org level. */
export function severityRank(v: EscalationSeverity | null | undefined): number {
  return v == null ? SEVERITIES.length : SEVERITY_ORDER[v];
}

export function orgLevelRank(v: EscalationOrgLevel | null | undefined): number {
  return v == null ? ORG_LEVELS.length : ORG_LEVEL_ORDER[v];
}

// ---- display ---------------------------------------------------------------------
//
// Localization keys, never stored values (the `lib/health` split). Nothing submitted or
// written to a column goes through these maps.

/** The BARE name, which is what a picker already scoped to closing offers: under a
 *  "Close as" label, "Closed — Resolved" says "closed" twice. `STATUS_DISPLAY_KEY` below
 *  is for reading a status cold, where the qualifier is the whole point. */
export const STATUS_KEY: Record<EscalationStatus, StringKey> = {
  open: 'escStatusOpen',
  resolved: 'escStatusResolved',
  duplicate: 'escStatusDuplicate',
  addressed: 'escStatusAddressed',
  obsolete: 'escStatusObsolete',
};

export const SEVERITY_KEY: Record<EscalationSeverity, StringKey> = {
  s1: 'escSeverityS1',
  s2: 'escSeverityS2',
  s3: 'escSeverityS3',
};

export const ORG_LEVEL_KEY: Record<EscalationOrgLevel, StringKey> = {
  team: 'escOrgTeam',
  region: 'escOrgRegion',
  director: 'escOrgDirector',
  exec: 'escOrgExec',
};

/**
 * The key for a status as it READS on the page: "Open", or "Closed — Resolved".
 *
 * A terminal state is shown with its "Closed — " prefix because the four terminal names
 * do not say on their own that the escalation is over — "Addressed" and "Obsolete" both
 * read like states something could still be in. The prefix lives in the catalog entry
 * for each terminal key rather than being concatenated here, so a translator can put the
 * two halves in whatever order their language wants (German and Japanese do not both
 * want an em dash in the middle).
 */
export const STATUS_DISPLAY_KEY: Record<EscalationStatus, StringKey> = {
  open: 'escStatusOpen',
  resolved: 'escStatusClosedResolved',
  duplicate: 'escStatusClosedDuplicate',
  addressed: 'escStatusClosedAddressed',
  obsolete: 'escStatusClosedObsolete',
};

/**
 * The filter token for the TRIAGE columns, where the absence of a value is itself an
 * option a reader wants to select. 'untriaged' rather than '' because an empty string is
 * indistinguishable from "no filter" once it round-trips through a URL.
 */
export const UNTRIAGED = 'untriaged';

export function severityToken(v: EscalationSeverity | null | undefined): string {
  return v ?? UNTRIAGED;
}

export function orgLevelToken(v: EscalationOrgLevel | null | undefined): string {
  return v ?? UNTRIAGED;
}
