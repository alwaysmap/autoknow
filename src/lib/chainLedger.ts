// The buffer ledger over the planned critical chain — pure and client-safe, like
// lib/criticalChain (docs/CRITICAL_CHAIN_VIEW_PLAN.md is the spec). Two jobs, kept
// separate per the spec's Goldratt mapping:
//   IDENTIFICATION — the PLANNED chain: longest path by FULL forecastedDuration
//     (progress ignored), so it is stable across progress updates and moves only
//     when someone edits structure or durations (a replan).
//   CONSTRAINT-FINDING — lib/criticalChain's longest-REMAINING path, used here only
//     as a detector: when it leaves the planned chain, suggest a re-baseline.
// Everything returned is a STRUCTURED FACT (situation packets, schedule rows,
// waterfall rows) — sentences are rendered from these via lib/i18n in the
// component. No prose is produced here, so nothing here needs translation and
// nothing can hallucinate.

import { computeCriticalChain } from './criticalChain';
import { DAY_MS, guidelineFor } from './sop';

export interface LedgerPhaseInput {
  id: number;
  name: string;
  forecastedDuration: number; // days
  progress: number; // 0..100, latest
  parentIds: number[];
  startedAt: string | null; // explicit toggle or derived first-progress (page resolves)
  completedAt: string | null; // first state ≥ 100
}

export interface ResourceProgramRef {
  programId: number;
  programName: string;
  bufferDays: number | null; // that program's current buffer (null = no SOP)
}

export interface LedgerResourceInput {
  kind: 'partner' | 'person';
  id: number;
  name: string;
  phaseId: number; // the phase (in THIS program) they are involved in
  otherPrograms: ResourceProgramRef[]; // programs where they are active right now
}

export interface StateTuple {
  phaseId: number;
  at: string; // ISO
  progress: number;
}

export interface ChainLedgerInput {
  phases: LedgerPhaseInput[];
  sopDate: string | null;
  now: number; // ms
  volumeFirstYear?: number;
  states?: StateTuple[]; // append-only history, for the trend replay
  resources?: LedgerResourceInput[];
}

export interface ScheduleRow {
  id: number;
  name: string;
  kind: 'done' | 'active' | 'notStarted';
  startMs: number; // actual, or projected (ASAP cascade) for notStarted
  endMs: number; // actual end, or projected end
  plannedEndMs: number; // start + forecastedDuration — the plan tick
  projected: boolean; // endMs is a forecast, not history
  varianceDays: number; // done: actual − planned; active: (elapsed + remaining) − planned; notStarted: 0
  remainingDays: number; // 0 for done
  gapBeforeDays: number; // realized idle days after the previous chain phase finished
}

export interface WaterfallRow {
  kind: 'overrun' | 'underrun' | 'gap' | 'forecast' | 'unattributed';
  days: number; // magnitude
  gain: boolean; // true = gave buffer back
  phaseId?: number;
  fromId?: number;
  toId?: number;
}

/** A person/partner reference with enough identity to render as a link. */
export interface ResourceRef {
  kind: 'partner' | 'person';
  id: number;
  name: string;
}

export type Situation =
  | { type: 'sunkOverrun'; phaseId: number; days: number; plannedDays: number; overPct: number; startedAt: string | null; completedAt: string | null; contended: ResourceRef[] }
  | { type: 'underrun'; phaseId: number; days: number; plannedDays: number }
  | { type: 'idleHandoff'; fromId: number; toId: number; days: number }
  | { type: 'forecastOverrun'; phaseId: number; days: number; remainingDays: number; elapsedDays: number; plannedDays: number; overPct: number }
  | { type: 'upcomingHandoff'; fromId: number; toId: number; resourceNames: string[]; contended: (ResourceRef & { n: number })[] }
  | { type: 'oversubscribed'; kind: 'partner' | 'person'; resourceId: number; name: string; phaseId: number; moves: ResourceProgramRef[]; tight: ResourceProgramRef[] }
  | { type: 'sopOvershoot'; days: number; proposedSopMonth: string; unitsDelayed: number | null }
  // The three FLOOR packets (#174). Emitted only when the register asks for a step and
  // none of the five situations above supplies one — see the floor block in
  // `computeChainLedger`, and `yieldsStep` just below for which those five are.
  | { type: 'floorComplete'; phaseIds: number[] }
  | { type: 'floorStart'; phaseId: number; idleDays: number }
  | { type: 'floorAllFinished' }
  | { type: 'allClear' };

/**
 * Which situations the Next-steps list turns into a bullet — the predicate the floor is
 * the complement of (#174).
 *
 * It restates ChainLedger.tsx's assembly conditions rather than sharing code with them,
 * because that component branches per situation TYPE and cannot be iterated generically.
 * That is a drift risk (AGENTS lesson 7), so it is pinned: `tests/chainLedger.test.ts`
 * asserts the invariant this exists to hold up — `register !== 'none'` implies a
 * non-empty list — over both floor branches.
 *
 * `upcomingHandoff` counts unconditionally here because the floor only runs when
 * `register !== 'none'`, and that is exactly the condition under which the component
 * emits `clLeverHandoff` for a handoff with no contended resource.
 */
export const yieldsStep = (s: Situation): boolean =>
  (s.type === 'forecastOverrun' && s.plannedDays > 0)
  || (s.type === 'sunkOverrun' && s.plannedDays > 0)
  || s.type === 'oversubscribed'
  || s.type === 'upcomingHandoff'
  || s.type === 'sopOvershoot';

export type Register = 'none' | 'plan' | 'act';

/**
 * The one phase a program should drop everything for: still running, and past its
 * OWN estimate by SEVERE_OVERRUN_PCT or more. Deliberately only what the header
 * line renders — anything more is a hand copy of the forecastOverrun packet, free
 * to drift from it field by field, and `situations` already carries the original.
 * `count` is how many phases qualify, so the flag can say "and 1 other" rather
 * than naming only the worst and implying it is alone.
 */
export interface ImmediateFocus {
  phaseId: number;
  phaseName: string;
  overPct: number; // days past the estimate, as a share of the estimate
  remainingDays: number;
  count: number; // phases at or over SEVERE_OVERRUN_PCT, this one included
}

export interface ChainLedgerResult {
  plannedChain: { path: number[]; totalDays: number };
  liveConstraintId: number | null;
  rebaselineSuggested: boolean;
  schedule: ScheduleRow[];
  projectedFinishMs: number | null;
  bufferDays: number | null;
  startBufferDays: number | null; // B₀: buffer implied at the program's first start
  usedDays: number | null; // B₀ − buffer
  guidelineDays: number; // 50%-rule reserve for the remaining chain work (sop.guidelineFor)
  fourWeekDeltaDays: number | null;
  trend: { atMs: number; bufferDays: number }[];
  waterfall: WaterfallRow[];
  situations: Situation[];
  /** The worst live overrun at or over SEVERE_OVERRUN_PCT; null below that. */
  immediateFocus: ImmediateFocus | null;
  register: Register;
}

const round = Math.round;
const days = (ms: number) => ms / DAY_MS;

/**
 * A FORECAST variance smaller than this is rounding noise, not signal — the
 * remaining half of it is a hill-position guess, so ±1 day means nothing.
 * Realized (done) variances are measured from real dates and count from 1 day.
 * Exported because the chart renders from the same rule: when this and the
 * waterfall disagreed, a +1-day phase drew a red band and an "over plan" label
 * while producing no waterfall row and no overrun situation.
 */
export const FORECAST_NOISE_DAYS = 2;

// ---- the five waterfall predicates: did this row move the buffer, and how? ----
//
// The whole taxonomy, and the one place each of those five questions is asked — with
// ONE known exception, filed as autoknow-4dr.3: `chainDay.phaseDaySpans`'s `done`
// branch still decides the realized-overrun question by millisecond geometry, which
// is also why the lint family below cannot see it. The waterfall and the situation
// packets are built from exactly these five tests, and so is every other surface that
// reads a `ScheduleRow`: the buffer flow (lib/bufferSeries), the day summary
// (lib/chainDay), the schedule chart and the row card. They had been hand-copied
// outward as 20 comparisons across five files — seven of them here in the ledger,
// whose waterfall and situations loops each carried a set — which is AGENTS lesson 7
// in its literal form, and only ONE pair of those sites (the flow and the waterfall)
// had a test that would notice a disagreement. Exported for the reason
// `isForecastOver` already carried alone: every caller chooses from ONE predicate, so
// they can never disagree about which rows count.
//
// Each takes a `Pick` of only the fields it tests, so a body cannot quietly start
// depending on another one, and a test can pin a predicate with a literal of just
// those fields rather than a whole fixture (tests/chainLedger.test.ts does that).
// eslint's `chainPredicates` family blocks ORDERING comparisons against
// `varianceDays`/`gapBeforeDays` anywhere but here, so the next copy fails
// `npm run lint` rather than review (AGENTS lesson 2). Reading either value to
// DISPLAY it, or to pick singular/plural copy, stays legal.
//
// REALIZED variances count from 1 day and FORECAST variances from
// FORECAST_NOISE_DAYS, and that asymmetry is the whole reason there are five
// predicates rather than a sign test: a done phase is measured between two real
// dates, while a live phase's remaining half is a hill-position guess. The naming
// carries no second distinction — `…Over`/`…Under` and `…Overrun`/`…Underrun` mean
// the same thing, and `isForecastOver` keeps its older spelling because it is
// already exported, already called from four files and already named in
// docs/CRITICAL_CHAIN_VIEW_PLAN.md.

/**
 * Idle days between the previous chain phase finishing and this one starting —
 * buffer nobody was working through. A row with NO predecessor never has one
 * (`scheduleAt` only accrues a gap after a row that is already `done`), so call
 * sites that also test `i > 0` or `prev` are being defensive about an array index,
 * not asking a narrower question than this.
 */
export const hasIdleGapBefore = (r: Pick<ScheduleRow, 'gapBeforeDays'>): boolean =>
  r.gapBeforeDays >= 1;

/** A FINISHED phase that ran past its plan tick: buffer already spent, measured
 *  between two real dates. */
export const isRealizedOverrun = (r: Pick<ScheduleRow, 'kind' | 'varianceDays'>): boolean =>
  r.kind === 'done' && r.varianceDays >= 1;

/** A FINISHED phase that beat its plan tick: buffer handed back, and the successor
 *  could start early. */
export const isRealizedUnderrun = (r: Pick<ScheduleRow, 'kind' | 'varianceDays'>): boolean =>
  r.kind === 'done' && r.varianceDays <= -1;

/** A RUNNING phase forecast to finish meaningfully past its plan — a CLAIM about
 *  days not yet spent, which is why it clears FORECAST_NOISE_DAYS rather than the
 *  realized 1-day floor. (Spelled `…Over`, not `…Overrun` — the same word as
 *  `isRealizedOverrun`'s, one tense earlier; see the header.) */
export const isForecastOver = (r: Pick<ScheduleRow, 'kind' | 'varianceDays'>): boolean =>
  r.kind === 'active' && r.varianceDays >= FORECAST_NOISE_DAYS;

/** A RUNNING phase forecast to finish meaningfully early — the mirror of
 *  `isForecastOver`: a CLAIM about buffer it will hand back, not days it has handed
 *  back, so it clears the same noise floor rather than the realized 1-day one. */
export const isForecastUnder = (r: Pick<ScheduleRow, 'kind' | 'varianceDays'>): boolean =>
  r.kind === 'active' && r.varianceDays <= -FORECAST_NOISE_DAYS;

/**
 * At or past this share of its own estimate, a running phase stops being a line
 * item and becomes the program's constraint: below it the estimate is still
 * roughly describing the work, and at it, it isn't. Days alone can't carry this
 * call — 5 days over a 10-day phase is a different program than 5 days over a
 * 200-day one, and the ledger reported both as "5 days".
 */
export const SEVERE_OVERRUN_PCT = 10;

/** Is this overrun past the point of being a line item? Exported for the same
 *  reason as isForecastOver: the bullet copy and the program-level flag choose
 *  from ONE predicate, so they can never disagree about which phases are severe. */
export const isSevereOverrun = (s: Pick<Extract<Situation, { type: 'forecastOverrun' }>, 'overPct'>): boolean =>
  s.overPct >= SEVERE_OVERRUN_PCT;

/** Days past the estimate as a share of it. A phase with NO estimate has no
 *  percentage — there is nothing for the overrun to be a share OF — and this
 *  returns 0 for it, which is indistinguishable from "exactly on estimate". So
 *  callers that render a percentage must exclude those phases themselves; see the
 *  `plannedDays > 0` filters in ChainLedger.tsx. (The mutation boundary demands a
 *  positive duration, so a zero here is legacy data.) */
const overPctOf = (overDays: number, plannedDays: number): number =>
  plannedDays > 0 ? round((overDays * 100) / plannedDays) : 0;

/** The planned chain: same solver, progress zeroed — identification, not tracking. */
function plannedChainOf(phases: LedgerPhaseInput[]): { path: number[]; totalDays: number } {
  const solved = computeCriticalChain(
    phases.map((p) => ({ id: p.id, name: p.name, forecastedDuration: p.forecastedDuration, progress: 0, parentIds: p.parentIds })),
  );
  return { path: solved.path, totalDays: solved.remainingDays };
}

/** Schedule rows for the chain path at time `now` — the shared core the replay reuses. */
function scheduleAt(phases: Map<number, LedgerPhaseInput>, path: number[], now: number): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let prevEnd: number | null = null;
  let prevActual = false;
  for (const id of path) {
    const p = phases.get(id)!;
    const D = p.forecastedDuration;
    const started = p.startedAt ? +new Date(p.startedAt) : null;
    const completed = p.completedAt ? +new Date(p.completedAt) : null;
    let row: ScheduleRow;
    if (p.progress >= 100) {
      const startMs = started ?? prevEnd ?? now;
      const endMs = completed ?? startMs + D * DAY_MS;
      row = {
        id, name: p.name, kind: 'done', startMs, endMs,
        plannedEndMs: startMs + D * DAY_MS, projected: false,
        varianceDays: round(days(endMs - startMs)) - D, remainingDays: 0,
        gapBeforeDays: prevActual && started ? Math.max(0, round(days(startMs - prevEnd!))) : 0,
      };
    } else if (started != null) {
      const elapsed = days(now - started);
      const rem = (D * (100 - Math.max(0, Math.min(100, p.progress)))) / 100;
      row = {
        id, name: p.name, kind: 'active', startMs: started, endMs: now + rem * DAY_MS,
        plannedEndMs: started + D * DAY_MS, projected: true,
        varianceDays: round(elapsed + rem - D), remainingDays: round(rem),
        gapBeforeDays: prevActual ? Math.max(0, round(days(started - prevEnd!))) : 0,
      };
    } else {
      const startMs = Math.max(prevEnd ?? now, now);
      row = {
        id, name: p.name, kind: 'notStarted', startMs, endMs: startMs + D * DAY_MS,
        plannedEndMs: startMs + D * DAY_MS, projected: true,
        varianceDays: 0, remainingDays: D,
        // the previous phase is finished but this one hasn't begun: idle days accrue
        gapBeforeDays: prevActual ? Math.max(0, round(days(startMs - prevEnd!))) : 0,
      };
    }
    rows.push(row);
    prevEnd = row.endMs;
    prevActual = row.kind === 'done';
  }
  return rows;
}

function bufferAt(phases: Map<number, LedgerPhaseInput>, path: number[], sopMs: number | null, now: number): number | null {
  if (sopMs == null || path.length === 0) return null;
  const rows = scheduleAt(phases, path, now);
  return round(days(sopMs - rows[rows.length - 1].endMs));
}

/** The phase set as it stood at time t, reconstructed from the append-only states. */
function phasesAsOf(phases: LedgerPhaseInput[], states: StateTuple[], t: number): Map<number, LedgerPhaseInput> {
  const byPhase = new Map<number, StateTuple[]>();
  for (const s of states) {
    if (+new Date(s.at) > t) continue;
    byPhase.set(s.phaseId, [...(byPhase.get(s.phaseId) ?? []), s]);
  }
  const out = new Map<number, LedgerPhaseInput>();
  for (const p of phases) {
    const hist = (byPhase.get(p.id) ?? []).sort((a, b) => +new Date(a.at) - +new Date(b.at));
    const progress = hist.length ? hist[hist.length - 1].progress : 0;
    const started =
      p.startedAt && +new Date(p.startedAt) <= t
        ? p.startedAt
        : hist.find((s) => s.progress > 0)?.at ?? null;
    const completed = hist.find((s) => s.progress >= 100)?.at ?? null;
    out.set(p.id, { ...p, progress, startedAt: started, completedAt: completed });
  }
  return out;
}

export function computeChainLedger(input: ChainLedgerInput): ChainLedgerResult {
  const { phases, now } = input;
  const byId = new Map(phases.map((p) => [p.id, p]));
  const sopMs = input.sopDate ? +new Date(input.sopDate) : null;

  const plannedChain = plannedChainOf(phases);
  const live = computeCriticalChain(
    phases.map((p) => ({ id: p.id, name: p.name, forecastedDuration: p.forecastedDuration, progress: p.progress, parentIds: p.parentIds })),
  );

  // Re-baseline detector: the live longest-remaining path (unfinished part) has left
  // the planned chain's unfinished part — reality disagrees with the plan.
  const unfinished = (ids: number[]) => ids.filter((id) => (byId.get(id)?.progress ?? 0) < 100);
  const liveU = unfinished(live.path);
  const plannedU = unfinished(plannedChain.path);
  const rebaselineSuggested =
    liveU.length > 0 && (liveU.length !== plannedU.length || liveU.some((id, i) => id !== plannedU[i]));

  const schedule = scheduleAt(byId, plannedChain.path, now);
  const last = schedule[schedule.length - 1] ?? null;
  const projectedFinishMs = last ? last.endMs : null;
  const bufferDays = sopMs != null && projectedFinishMs != null ? round(days(sopMs - projectedFinishMs)) : null;

  // B₀: the buffer the SOP implied when work first started (earliest start anywhere).
  const startTimes = phases.map((p) => (p.startedAt ? +new Date(p.startedAt) : null)).filter((x): x is number => x != null);
  const t0 = startTimes.length ? Math.min(...startTimes) : now;
  const startBufferDays = sopMs != null ? round(days(sopMs - (t0 + plannedChain.totalDays * DAY_MS))) : null;
  const usedDays = bufferDays != null && startBufferDays != null ? startBufferDays - bufferDays : null;

  const remainingTotal = schedule.reduce((sum, r) => sum + r.remainingDays, 0);
  const guidelineDays = guidelineFor(remainingTotal);

  // ---- waterfall: where the buffer went (books balance or say so) ----
  const waterfall: WaterfallRow[] = [];
  for (const r of schedule) {
    if (hasIdleGapBefore(r)) {
      const idx = schedule.indexOf(r);
      waterfall.push({ kind: 'gap', days: r.gapBeforeDays, gain: false, fromId: schedule[idx - 1]?.id, toId: r.id });
    }
    if (isRealizedOverrun(r)) waterfall.push({ kind: 'overrun', days: r.varianceDays, gain: false, phaseId: r.id });
    if (isRealizedUnderrun(r)) waterfall.push({ kind: 'underrun', days: -r.varianceDays, gain: true, phaseId: r.id });
    if (isForecastOver(r)) waterfall.push({ kind: 'forecast', days: r.varianceDays, gain: false, phaseId: r.id });
    if (isForecastUnder(r)) {
      waterfall.push({ kind: 'forecast', days: -r.varianceDays, gain: true, phaseId: r.id });
    }
  }
  if (usedDays != null) {
    const attributed = waterfall.reduce((sum, w) => sum + (w.gain ? -w.days : w.days), 0);
    const unattributed = usedDays - attributed;
    // ±1 day of imbalance is rounding drift, not a fact worth a row.
    if (Math.abs(unattributed) >= 2) {
      waterfall.push({ kind: 'unattributed', days: Math.abs(unattributed), gain: unattributed < 0 });
    }
  }

  // ---- situation packets (the finite taxonomy; sentences render in the component) ----
  const resources = input.resources ?? [];
  const resourcesOn = (phaseId: number) => resources.filter((r) => r.phaseId === phaseId);
  const situations: Situation[] = [];

  for (let i = 0; i < schedule.length; i++) {
    const r = schedule[i];
    const p = byId.get(r.id)!;
    if (hasIdleGapBefore(r)) situations.push({ type: 'idleHandoff', fromId: schedule[i - 1].id, toId: r.id, days: r.gapBeforeDays });
    if (isRealizedOverrun(r)) {
      situations.push({
        type: 'sunkOverrun', phaseId: r.id, days: r.varianceDays, plannedDays: p.forecastedDuration,
        overPct: overPctOf(r.varianceDays, p.forecastedDuration),
        startedAt: p.startedAt, completedAt: p.completedAt,
        contended: resourcesOn(r.id)
          .filter((x) => x.otherPrograms.length > 0)
          .map((x) => ({ kind: x.kind, id: x.id, name: x.name })),
      });
    }
    if (isRealizedUnderrun(r)) {
      situations.push({ type: 'underrun', phaseId: r.id, days: -r.varianceDays, plannedDays: p.forecastedDuration });
    }
    if (isForecastOver(r)) {
      situations.push({
        type: 'forecastOverrun', phaseId: r.id, days: r.varianceDays, remainingDays: r.remainingDays,
        elapsedDays: round(days(now - r.startMs)), plannedDays: p.forecastedDuration,
        overPct: overPctOf(r.varianceDays, p.forecastedDuration),
      });
    }
    if (r.kind === 'active' && schedule[i + 1]?.kind === 'notStarted') {
      const nextResources = resourcesOn(schedule[i + 1].id);
      situations.push({
        type: 'upcomingHandoff', fromId: r.id, toId: schedule[i + 1].id,
        resourceNames: nextResources.map((x) => x.name),
        contended: nextResources
          .filter((x) => x.otherPrograms.length > 0)
          .map((x) => ({ kind: x.kind, id: x.id, name: x.name, n: x.otherPrograms.length })),
      });
    }
  }
  for (const res of resources) {
    const row = schedule.find((r) => r.id === res.phaseId);
    if (!row || row.kind === 'done' || res.otherPrograms.length === 0) continue;
    const moves = res.otherPrograms.filter((o) => (o.bufferDays ?? 0) > 0).sort((a, b) => (b.bufferDays ?? 0) - (a.bufferDays ?? 0));
    const tight = res.otherPrograms.filter((o) => (o.bufferDays ?? 0) <= 0).sort((a, b) => (a.bufferDays ?? 0) - (b.bufferDays ?? 0));
    situations.push({ type: 'oversubscribed', kind: res.kind, resourceId: res.id, name: res.name, phaseId: res.phaseId, moves, tight });
  }
  if (bufferDays != null && bufferDays < 0 && projectedFinishMs != null) {
    const d = new Date(projectedFinishMs);
    const proposedSopMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    situations.push({
      type: 'sopOvershoot', days: -bufferDays, proposedSopMonth,
      unitsDelayed: input.volumeFirstYear ? round((input.volumeFirstYear * -bufferDays) / 365) : null,
    });
  }
  // ---- the immediate focus: a RUNNING phase whose estimate no longer describes it ----
  // Only active phases qualify. A finished overrun is history — it earns a re-plan of
  // what is still ahead (a next step), not an all-hands — whereas a phase already
  // SEVERE_OVERRUN_PCT past what we said, and still going, is the constraint today,
  // however much buffer the program happens to be sitting on. Sorted worst-first so
  // the flag names the phase to walk into, and carries the count so it never implies
  // the named one is alone.
  const severe = situations
    .filter((s): s is Extract<Situation, { type: 'forecastOverrun' }> =>
      s.type === 'forecastOverrun' && isSevereOverrun(s))
    .sort((a, b) => b.overPct - a.overPct || b.days - a.days);
  const immediateFocus: ImmediateFocus | null = severe.length === 0 ? null : {
    phaseId: severe[0].phaseId,
    phaseName: byId.get(severe[0].phaseId)!.name,
    overPct: severe[0].overPct,
    remainingDays: severe[0].remainingDays,
    count: severe.length,
  };

  // ---- trend replay (weekly) + four-week delta ----
  const trend: { atMs: number; bufferDays: number }[] = [];
  let fourWeekDeltaDays: number | null = null;
  if (input.states && input.states.length > 0 && sopMs != null && plannedChain.path.length > 0) {
    const stateTimes = input.states.map((s) => +new Date(s.at));
    const replayStart = Math.min(t0, ...stateTimes);
    for (let t = replayStart; t < now; t += 7 * DAY_MS) {
      const b = bufferAt(phasesAsOf(phases, input.states, t), plannedChain.path, sopMs, t);
      if (b != null) trend.push({ atMs: t, bufferDays: b });
    }
    const bNow = bufferAt(phasesAsOf(phases, input.states, now), plannedChain.path, sopMs, now);
    if (bNow != null) trend.push({ atMs: now, bufferDays: bNow });
    const b4 = bufferAt(phasesAsOf(phases, input.states, now - 28 * DAY_MS), plannedChain.path, sopMs, now - 28 * DAY_MS);
    if (bNow != null && b4 != null) fourWeekDeltaDays = bNow - b4;
  }

  // Judgment register: intervene when the SOP is overshot or a running phase has left
  // its estimate behind; keep a plan ready when the reserve is thinner than the 50%
  // guideline or a week+ of buffer went in four weeks. The overrun test does not need
  // a SOP — "this phase is already 10%+ past what we said" is judgeable against
  // the phase's own estimate — and it outranks a healthy buffer, because a buffer only
  // says the damage hasn't reached the SOP YET.
  const register: Register =
    immediateFocus != null ? 'act'
    : bufferDays == null ? 'none'
    : bufferDays < 0 ? 'act'
    : bufferDays < guidelineDays || (fourWeekDeltaDays != null && fourWeekDeltaDays <= -7) ? 'plan'
    : 'none';

  // ---- the FLOOR under the Next-steps list (#174) ----
  //
  // The heading and the list had two different sources of truth and nothing made them
  // agree: the heading comes from `register` (buffer arithmetic alone), the list is
  // assembled in ChainLedger.tsx from five unrelated situation kinds. Both can be true at
  // once, and on a program holding 65 days against a 168-day guideline they were — the
  // reader was promised a next step under a heading and handed an empty box, beside a
  // column busy explaining that idle time is already costing the program a day.
  //
  // So `register !== 'none'` now IMPLIES at least one step, as an invariant rather than a
  // patch (AGENTS lesson 2). It also closes the 'act' case, which only looks safe today
  // because `immediateFocus` happens to feed `overrunSteps` as well — a coincidence of
  // two code paths, not a guarantee.
  //
  // The floor is a STEP computed HERE, not a string the component invents when the array
  // is empty: this file is the deterministic layer, and ChainLedger's own header says it
  // "ONLY renders structured facts". A sentence invented in the component would also be
  // untestable where the rest of the ledger is unit-tested.
  if (register !== 'none' && !situations.some(yieldsStep)) {
    const running = schedule.filter((r) => r.kind === 'active');
    if (running.length > 0) {
      situations.push({ type: 'floorComplete', phaseIds: running.map((r) => r.id) });
    } else {
      // WHICH phase could start is already answered by the idle rows in the waterfall —
      // they name the phase they are idle BEFORE, which is exactly what the column on the
      // right is already printing. Reading it from there rather than deriving a second,
      // subtly different notion of "next startable phase" is the point.
      const gap = waterfall.find((w) => w.kind === 'gap' && w.toId != null
        && schedule.find((r) => r.id === w.toId)?.kind === 'notStarted');
      const startId = gap?.toId ?? schedule.find((r) => r.kind === 'notStarted')?.id;
      if (startId != null) {
        situations.push({ type: 'floorStart', phaseId: startId, idleDays: gap?.days ?? 0 });
      } else {
        // Nothing running and nothing left to start: every phase is finished, and the
        // register is 'plan' because the reserve moved while the work was wrapping up.
        // Rare, but it is the one shape that would otherwise leave the invariant false.
        situations.push({ type: 'floorAllFinished' });
      }
    }
  }

  if (situations.length === 0) situations.push({ type: 'allClear' });

  return {
    plannedChain,
    liveConstraintId: live.constraintId,
    rebaselineSuggested,
    schedule,
    projectedFinishMs,
    bufferDays,
    startBufferDays,
    usedDays,
    guidelineDays,
    fourWeekDeltaDays,
    trend,
    waterfall,
    situations,
    immediateFocus,
    register,
  };
}

// ---- portfolio aggregation: Busiest people and partners ----

export interface BusiestProgramInput {
  programId: number;
  programName: string;
  bufferDays: number | null;
  fourWeekDeltaDays: number | null;
  volumeFirstYear: number;
  products: string[];
  sopDate?: string | null;
  /** Resources involved in this program's UNFINISHED chain phases. */
  resources: { kind: 'partner' | 'person'; id: number; name: string; onConstraint: boolean }[];
}

export interface BusiestProgramRef {
  programId: number;
  programName: string;
  bufferDays: number | null;
  fourWeekDeltaDays: number | null;
  volumeFirstYear: number;
  products: string[];
  sopDate?: string | null;
}

export interface BusiestRow {
  kind: 'partner' | 'person';
  id: number;
  name: string;
  constraintIn: BusiestProgramRef[]; // volume desc — the tie-break fact is the order
  alsoActiveIn: BusiestProgramRef[];
  movable: BusiestProgramRef[]; // non-constraint programs with buffer to give, richest first
  gatesSingleSop: boolean;
  exposure: number; // Σ buffer-loss × volume over constraint programs — the sort key
}

export function buildBusiestResources(programs: BusiestProgramInput[]): BusiestRow[] {
  const byKey = new Map<string, BusiestRow>();
  for (const prog of programs) {
    const ref: BusiestProgramRef = {
      programId: prog.programId, programName: prog.programName, bufferDays: prog.bufferDays,
      fourWeekDeltaDays: prog.fourWeekDeltaDays, volumeFirstYear: prog.volumeFirstYear,
      products: prog.products, sopDate: prog.sopDate ?? null,
    };
    for (const res of prog.resources) {
      const key = `${res.kind}:${res.id}`;
      const row = byKey.get(key) ?? {
        kind: res.kind, id: res.id, name: res.name,
        constraintIn: [], alsoActiveIn: [], movable: [], gatesSingleSop: false, exposure: 0,
      };
      (res.onConstraint ? row.constraintIn : row.alsoActiveIn).push(ref);
      byKey.set(key, row);
    }
  }
  const rows = [...byKey.values()];
  for (const row of rows) {
    row.constraintIn.sort((a, b) => b.volumeFirstYear - a.volumeFirstYear || (a.fourWeekDeltaDays ?? 0) - (b.fourWeekDeltaDays ?? 0));
    row.exposure = row.constraintIn.reduce(
      (sum, p) => sum + Math.max(0, -(p.fourWeekDeltaDays ?? 0)) * Math.max(1, p.volumeFirstYear), 0,
    );
    row.movable =
      row.constraintIn.length === 0
        ? []
        : row.alsoActiveIn.filter((p) => (p.bufferDays ?? 0) > 0).sort((a, b) => (b.bufferDays ?? 0) - (a.bufferDays ?? 0));
    row.gatesSingleSop = row.constraintIn.length === 1;
  }
  rows.sort((a, b) => b.exposure - a.exposure || a.name.localeCompare(b.name));
  return rows;
}
