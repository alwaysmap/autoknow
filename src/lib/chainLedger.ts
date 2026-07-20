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
import { DAY_MS } from './sop';

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
  | { type: 'sunkOverrun'; phaseId: number; days: number; plannedDays: number; startedAt: string | null; completedAt: string | null; contended: ResourceRef[] }
  | { type: 'underrun'; phaseId: number; days: number; plannedDays: number }
  | { type: 'idleHandoff'; fromId: number; toId: number; days: number }
  | { type: 'forecastOverrun'; phaseId: number; days: number; remainingDays: number; elapsedDays: number; plannedDays: number }
  | { type: 'upcomingHandoff'; fromId: number; toId: number; resourceNames: string[]; contended: (ResourceRef & { n: number })[] }
  | { type: 'oversubscribed'; kind: 'partner' | 'person'; resourceId: number; name: string; phaseId: number; moves: ResourceProgramRef[]; tight: ResourceProgramRef[] }
  | { type: 'sopOvershoot'; days: number; proposedSopMonth: string; unitsDelayed: number | null }
  | { type: 'allClear' };

export type Register = 'none' | 'plan' | 'act';

export interface ChainLedgerResult {
  plannedChain: { path: number[]; totalDays: number };
  liveConstraintId: number | null;
  rebaselineSuggested: boolean;
  schedule: ScheduleRow[];
  projectedFinishMs: number | null;
  bufferDays: number | null;
  startBufferDays: number | null; // B₀: buffer implied at the program's first start
  usedDays: number | null; // B₀ − buffer
  guidelineDays: number; // 50%-rule reserve for the remaining chain work
  fourWeekDeltaDays: number | null;
  trend: { atMs: number; bufferDays: number }[];
  waterfall: WaterfallRow[];
  situations: Situation[];
  register: Register;
}

const round = Math.round;
const days = (ms: number) => ms / DAY_MS;

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
  const guidelineDays = round(remainingTotal / 2);

  // ---- waterfall: where the buffer went (books balance or say so) ----
  const waterfall: WaterfallRow[] = [];
  for (const r of schedule) {
    if (r.gapBeforeDays >= 1) {
      const idx = schedule.indexOf(r);
      waterfall.push({ kind: 'gap', days: r.gapBeforeDays, gain: false, fromId: schedule[idx - 1]?.id, toId: r.id });
    }
    if (r.kind === 'done' && r.varianceDays >= 1) waterfall.push({ kind: 'overrun', days: r.varianceDays, gain: false, phaseId: r.id });
    if (r.kind === 'done' && r.varianceDays <= -1) waterfall.push({ kind: 'underrun', days: -r.varianceDays, gain: true, phaseId: r.id });
    // Forecast variance is a projection — ±1 day is rounding noise, not signal
    // (no-fabricated-precision rule); realized variances keep the 1-day threshold.
    if (r.kind === 'active' && r.varianceDays >= 2) waterfall.push({ kind: 'forecast', days: r.varianceDays, gain: false, phaseId: r.id });
    if (r.kind === 'active' && r.varianceDays <= -2) waterfall.push({ kind: 'forecast', days: -r.varianceDays, gain: true, phaseId: r.id });
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
    if (r.gapBeforeDays >= 1) situations.push({ type: 'idleHandoff', fromId: schedule[i - 1].id, toId: r.id, days: r.gapBeforeDays });
    if (r.kind === 'done' && r.varianceDays >= 1) {
      situations.push({
        type: 'sunkOverrun', phaseId: r.id, days: r.varianceDays, plannedDays: p.forecastedDuration,
        startedAt: p.startedAt, completedAt: p.completedAt,
        contended: resourcesOn(r.id)
          .filter((x) => x.otherPrograms.length > 0)
          .map((x) => ({ kind: x.kind, id: x.id, name: x.name })),
      });
    }
    if (r.kind === 'done' && r.varianceDays <= -1) {
      situations.push({ type: 'underrun', phaseId: r.id, days: -r.varianceDays, plannedDays: p.forecastedDuration });
    }
    if (r.kind === 'active' && r.varianceDays >= 2) {
      situations.push({
        type: 'forecastOverrun', phaseId: r.id, days: r.varianceDays, remainingDays: r.remainingDays,
        elapsedDays: round(days(now - r.startMs)), plannedDays: p.forecastedDuration,
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
  if (situations.length === 0) situations.push({ type: 'allClear' });

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

  // Judgment register: intervene when the SOP is overshot; keep a plan ready when the
  // reserve is thinner than the 50% guideline or a week+ of buffer went in four weeks.
  const register: Register =
    bufferDays == null ? 'none'
    : bufferDays < 0 ? 'act'
    : bufferDays < guidelineDays || (fourWeekDeltaDays != null && fourWeekDeltaDays <= -7) ? 'plan'
    : 'none';

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
