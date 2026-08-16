import { phaseHref } from './phase';
import { compareInsights } from './insight';
import type { Insight, InsightSeverity, InsightSymptom } from './insight';
import type { ChainLedgerResult, Situation } from './chainLedger';

// WHY a phase is the constraint, as an `Insight` (#148, the shape's first real caller).
//
// `chainLedger` has always computed the answer — a Situation union carrying overPct,
// elapsed vs planned, idle days, and who is contended — and it reached exactly one
// screen: `ChainLedger.tsx`, one program at a time. So the app could already say
// "Integration is 40% over its plan and contended with two other programs", just never on
// the page where somebody is choosing which program to look at.
//
// This module is the one place a Situation becomes a DIAGNOSIS. The portfolio panel does
// not look at phases, progress or dates and does not re-derive "is this phase over, and
// by how much" — it renders what the ledger already decided, through here.
//
// The PROSE is not shared with ChainLedger, and that is a decision rather than an
// oversight. The two sentences have different subjects: the ledger's bullet is about a
// PHASE on a page where the program is a given, and it fuses symptom with recommendation
// ("…root-cause the overrun, or re-estimate it"). The panel's cell is about a PROGRAM on
// a row whose header is already the phase name, and it states the symptom only. Forcing
// one string to serve both would either repeat the row header in every cell — the exact
// defect #167 removed from the program page one change earlier — or drop the program the
// diagnosis belongs to. What IS shared is everything upstream of the words: the packets,
// the classification, the severity, the basis and the `since`.

/** What a diagnosis needs to know about the program it was computed for. */
export interface ChainInsightContext {
  programId: number;
  programName: string;
}

/**
 * Which situations can attach to the LIVE CONSTRAINT — the next unfinished phase on the
 * planned chain — ranked worst-first. `sunkOverrun` is absent on purpose: a finished
 * phase cannot be the live constraint, so a row claiming it would be describing a
 * different phase than the one it names.
 */
const SEVERITY_OF: Partial<Record<Situation['type'], InsightSeverity>> = {
  forecastOverrun: 'act',
  idleHandoff: 'act',
  oversubscribed: 'watch',
  upcomingHandoff: 'watch',
};

const isoOf = (ms: number | undefined): string | null =>
  ms == null ? null : new Date(ms).toISOString();

/**
 * The diagnosis for one program's live constraint: WHY it is the constraint, SINCE when,
 * and how far to trust the number — or an explicit "on the chain, nothing wrong", which
 * is a real answer and not an empty row. Dropping the clean case would overstate the
 * portfolio, which is the failure the whole panel is being fixed for.
 *
 * Returns null only when the program has no live constraint at all.
 */
export function constraintDiagnosis(ledger: ChainLedgerResult, ctx: ChainInsightContext): Insight | null {
  const phaseId = ledger.liveConstraintId;
  if (phaseId == null) return null;
  const row = ledger.schedule.find((r) => r.id === phaseId);
  if (!row) return null;

  const href = phaseHref(ctx.programId, phaseId);
  const scope: Insight['scope'] = { kind: 'phase', id: phaseId, name: row.name, programId: ctx.programId };
  const program = ctx.programName;
  // A phase that has begun has a real start; one that has not is honestly undated. A
  // first-seen timestamp would be a fabricated `since`, which is the field's own warning.
  const startedIso = row.kind === 'notStarted' ? null : isoOf(row.startMs);

  /** Everything a diagnosis SHARES — the envelope — so each case below reads as the four
   *  things that actually differ: its id fragment, its symptom, its advice, and whether
   *  it can name a date. */
  const diagnosis = (
    idPart: string, severity: InsightSeverity, symptom: InsightSymptom,
    action: Insight['action'], since: string | null,
  ): Insight => ({
    id: `chain:${idPart}:${ctx.programId}:${phaseId}`,
    source: 'critical-chain', scope, severity, href, symptom, action, since,
  });

  const candidates: Insight[] = [];
  for (const s of ledger.situations) {
    const severity = SEVERITY_OF[s.type];
    if (!severity) continue;
    // A switch rather than four sequential `if`s: it buys exhaustiveness against a future
    // `Situation` member, and it puts each case's four differences where a reader can see
    // them instead of behind a repeated seven-field literal.
    switch (s.type) {
      case 'forecastOverrun':
        if (s.phaseId !== phaseId || s.plannedDays <= 0) break;
        candidates.push(diagnosis('overrun', severity, {
          key: 'cdOverrun', values: { program, pct: s.overPct, p: s.plannedDays, r: s.remainingDays },
          // `overPct` is a share of a typed-in `forecastedDuration`, so the number is over
          // a GUESS however precisely it prints. That is what `basis` is for.
          measure: s.overPct, basis: 'estimated',
        }, { key: 'cdOverrunAction' }, startedIso));
        break;

      case 'idleHandoff': {
        if (s.toId !== phaseId) break;
        const from = ledger.schedule.find((r) => r.id === s.fromId);
        candidates.push(diagnosis('idle', severity, {
          key: s.days === 1 ? 'cdIdleOne' : 'cdIdle', values: { program, d: s.days },
          // Idle days are the difference between two real dates — measured, unlike
          // everything computed against an estimate.
          measure: s.days, basis: 'measured',
        }, { key: 'cdIdleAction' }, isoOf(from?.endMs)));
        break;
      }

      case 'oversubscribed': {
        if (s.phaseId !== phaseId) break;
        const n = s.moves.length + s.tight.length;
        candidates.push(diagnosis(`contended:${s.kind}:${s.resourceId}`, severity, {
          key: 'cdContended', values: { program, name: s.name, n }, measure: n, basis: 'measured',
        }, { key: 'cdContendedAction' }, startedIso));
        break;
      }

      case 'upcomingHandoff':
        if (s.toId !== phaseId || s.contended.length === 0) break;
        candidates.push(diagnosis('handoff', severity, {
          key: 'cdHandoff', values: { program, n: s.contended.length },
          measure: s.contended.length, basis: 'measured',
        }, { key: 'cdHandoffAction' }, null)); // not started: there is no date to state
        break;

      default:
        break;
    }
  }

  if (candidates.length === 0) {
    // Structural-and-fine is a legitimate answer and has to be SAYABLE, or the panel
    // reports only trouble and every row it prints reads as trouble.
    return diagnosis('clear', 'clear', {
      key: 'cdClear', values: { program }, measure: null, basis: 'measured',
    }, null, startedIso);
  }

  // `compareInsights`, never a local comparator. `lib/insight` argues at length that every
  // branch of that ordering has to be TOTAL, and a second spelling here would be free to
  // disagree with it — exactly the drift `INSIGHT_SEVERITY_RANK` was exported to prevent.
  // Every candidate shares one source, so this reduces to severity then measure, and it
  // keeps handling a measureless producer correctly if one is ever added.
  return [...candidates].sort(compareInsights)[0];
}
