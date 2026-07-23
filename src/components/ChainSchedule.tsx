'use client';

import ChartLabel from './ChartLabel';
import { t, Locale } from '../lib/i18n';
import { localDate } from '../lib/dates';
import { DAY_MS } from '../lib/sop';
import ConstraintRing from './ConstraintRing';
import { isForecastOver } from '../lib/chainLedger';
import type { ChainLedgerResult, ScheduleRow } from '../lib/chainLedger';
import styles from './ChainLedger.module.css';

// The Critical Chain "Schedule" instrument (docs/CRITICAL_CHAIN_VIEW_PLAN.md §4a,
// issue #75). Replaces the time-scaled Gantt + full-height texture bands with:
//   • a phase × WEEK state grid — one row per chain phase, one cell per ISO week,
//     each cell coloured by that phase's state that week (on-plan / over / early /
//     idle / forecast). A column is a moment in time, so reading DOWN a column
//     compares every phase at once — the question "did this over-run overlap an
//     early finish elsewhere?" answered by position + hue, no textures.
//   • DAY-ACCURATE transitions: cells clip to the phase's true start/end day at
//     their ends, and idle handoffs draw to the day — the chart drives "start the
//     next phase the day the baton lands", never "wait until Friday" (the whole
//     point of critical chain / the relay runner).
//   • a buffer-on-hand LANE below, on the same week axis: the buffer draining and
//     refilling, each step pinned under the phase that moved it and labelled with
//     the buffer actually in hand there. The grid answers who was where when; the
//     lane carries the exact day magnitudes the weekly cells round off.
// All colour is theme tokens (globals.css); nothing is a literal (design.md §8b).

const WEEK_MS = 7 * DAY_MS;

// ---- SVG user-space geometry (px here is viewBox coordinate space, design.md §9) ----
const W = 900, PAD_R = 14, ROW_H = 30, TOP = 30;
const CELL_H = 18, CELL_GAP = 1.5; // the coloured cell inside each row band
const LANE_H = 90, LANE_GAP = 26; // buffer-on-hand lane below the grid
const AXIS_H = 22; // week/month ticks under the grid
const RING_PAD = 22, TEXT_PAD = 10, CHAR_W = 5.9, WIDE_CHAR_W = 11;
const CARD_W = 272;
// A run of this many empty weeks (no phase, no handoff) collapses to a marked break
// of BREAK_W instead of donating that many full columns to nothing (issue #75 / #42).
// 6 weeks so a modest buffer tail stays inline; only a clearly long run collapses.
const COLLAPSE_MIN_WEEKS = 6, BREAK_W = 26;

const textWidth = (s: string) =>
  [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? WIDE_CHAR_W : CHAR_W), 0);

const dayShort = (ms: number, locale: Locale) => localDate(new Date(ms), locale, { month: 'short', day: 'numeric' });
const monthLong = (ms: number, locale: Locale) => localDate(new Date(ms), locale, { month: 'long', year: 'numeric' });

/** Monday 00:00 UTC on or before `ms` (ISO week start, matching the old graticule). */
function weekFloor(ms: number): number {
  const d = new Date(ms);
  const dow = d.getUTCDay() || 7; // Sun→7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - (dow - 1) * DAY_MS;
}
const weekCeil = (ms: number): number => weekFloor(ms + WEEK_MS - 1);

/** A hovered/focused row plus where its card should sit, in px relative to the section. */
export interface RowCard { row: ScheduleRow; left: number; top: number }

/** A dated change to the buffer, for the buffer-on-hand lane. */
interface LaneEvent { atMs: number; deltaDays: number; kind: 'loss' | 'gain' | 'forecast'; projected: boolean }

type CellKind = 'plan' | 'over' | 'under' | 'forecast' | 'fover' | 'sched';
const CELL_FILL: Record<CellKind, string> = {
  plan: 'var(--fg)', over: 'var(--bad)', under: 'var(--ok)',
  forecast: 'none', fover: 'none', sched: 'none',
};
// forecast/scheduled cells are OUTLINED (nothing has happened yet); fover outlines in --bad.
const CELL_STROKE: Record<CellKind, string | null> = {
  plan: null, over: null, under: null,
  forecast: 'var(--muted)', fover: 'var(--bad)', sched: 'var(--muted)',
};

/** State sub-spans of a phase, in ms, so a week can be classified by the span it most overlaps. */
function phaseSpans(r: ScheduleRow, now: number): { kind: CellKind; a: number; b: number }[] {
  if (r.kind === 'done') {
    const planEnd = Math.min(r.endMs, r.plannedEndMs);
    const spans: { kind: CellKind; a: number; b: number }[] = [{ kind: 'plan', a: r.startMs, b: planEnd }];
    if (r.varianceDays >= 1) spans.push({ kind: 'over', a: r.plannedEndMs, b: r.endMs });
    if (r.varianceDays <= -1) spans.push({ kind: 'under', a: r.endMs, b: r.plannedEndMs }); // days handed back
    return spans;
  }
  if (r.kind === 'active') {
    const elapsedEnd = Math.min(now, r.endMs);
    const spans: { kind: CellKind; a: number; b: number }[] = [{ kind: 'plan', a: r.startMs, b: elapsedEnd }];
    if (isForecastOver(r)) {
      spans.push({ kind: 'forecast', a: now, b: r.plannedEndMs });
      spans.push({ kind: 'fover', a: r.plannedEndMs, b: r.endMs });
    } else {
      spans.push({ kind: 'forecast', a: now, b: r.endMs });
    }
    return spans;
  }
  return [{ kind: 'sched', a: r.startMs, b: r.endMs }]; // notStarted
}

export function ChainSchedule({ ledger, sopMs, now, locale, onRowCard, onJump }: {
  ledger: ChainLedgerResult; sopMs: number | null; now: number; locale: Locale;
  onRowCard: (row: ScheduleRow | null, el: SVGRectElement | null, labelW?: number, clientX?: number) => void;
  onJump: (phaseId: number) => void;
}) {
  const rows = ledger.schedule;
  if (rows.length === 0) return null;

  const lastEnd = rows[rows.length - 1].endMs;
  // The axis always reaches the SOP; a long run of EMPTY weeks (the buffer tail, or a
  // stretch nothing lands on) is COLLAPSED to a marked break rather than donating that
  // many columns to nothing (issue #75, superseding #42's "break the linear axis").
  const firstStartMs = Math.min(...rows.map((r) => r.startMs));
  const tMin = weekFloor(firstStartMs);
  const tMax = weekCeil(Math.max(sopMs ?? 0, lastEnd, now));
  const nWeeks = Math.max(1, Math.round((tMax - tMin) / WEEK_MS));
  const weeks: number[] = [];
  for (let k = 0; k < nWeeks; k++) weeks.push(tMin + k * WEEK_MS);

  const labelW = Math.min(200, Math.max(56, Math.ceil(Math.max(
    ...rows.map((r) => textWidth(r.name) + (ledger.liveConstraintId === r.id ? RING_PAD : TEXT_PAD)),
  ))));
  const plotW = W - labelW - PAD_R;
  const rowY = (i: number) => TOP + i * ROW_H + ROW_H / 2;

  const gridBot = TOP + rows.length * ROW_H;
  const axisY = gridBot + 6;
  const laneTop = axisY + AXIS_H + LANE_GAP;
  const laneBot = laneTop + LANE_H;
  const H = (sopMs != null ? laneBot : gridBot + AXIS_H) + 26;

  // ---- piecewise time axis: full weeks share the space; empty runs collapse ----
  // A week is OCCUPIED (never collapses) if any phase span or idle handoff touches it,
  // or it holds the `today`/SOP rule — collapse keys on emptiness, not on band kind
  // (design.md §8c / #42 open-Q4, so the overshoot case collapses the right span too).
  const weekIndex = (ms: number) => Math.floor((weekFloor(ms) - tMin) / WEEK_MS);
  const occupied = weeks.map((w0) => {
    const w1 = w0 + WEEK_MS;
    return rows.some((r, i) =>
      phaseSpans(r, now).some((s) => s.b > w0 && s.a < w1)
      || (r.gapBeforeDays >= 1 && i > 0 && rows[i - 1].endMs < w1 && r.startMs > w0));
  });
  for (const ms of [now, sopMs]) {
    if (ms == null) continue;
    const k = weekIndex(ms);
    if (k >= 0 && k < nWeeks) occupied[k] = true;
  }
  const collapsed = new Array<boolean>(nWeeks).fill(false);
  for (let k = 0; k < nWeeks;) {
    if (occupied[k]) { k++; continue; }
    let j = k; while (j < nWeeks && !occupied[j]) j++;
    if (j - k >= COLLAPSE_MIN_WEEKS) for (let m = k; m < j; m++) collapsed[m] = true;
    k = j;
  }
  // full weeks share the space left after each collapsed run takes one BREAK_W
  let nFull = 0, nBreaks = 0;
  for (let k = 0; k < nWeeks;) {
    if (collapsed[k]) { nBreaks++; while (k < nWeeks && collapsed[k]) k++; }
    else { nFull++; k++; }
  }
  const colW = (plotW - nBreaks * BREAK_W) / Math.max(1, nFull);
  const weekX0 = new Array<number>(nWeeks), weekX1 = new Array<number>(nWeeks);
  const breaks: { cx: number; days: number }[] = [];
  {
    let cx = labelW;
    for (let k = 0; k < nWeeks;) {
      if (collapsed[k]) {
        let j = k; while (j < nWeeks && collapsed[j]) j++;
        for (let m = k; m < j; m++) { weekX0[m] = cx; weekX1[m] = cx + BREAK_W; }
        breaks.push({ cx: cx + BREAK_W / 2, days: (j - k) * 7 });
        cx += BREAK_W; k = j;
      } else { weekX0[k] = cx; weekX1[k] = cx + colW; cx += colW; k++; }
    }
  }
  // Real events (phase start/end, today, SOP) live in occupied full-width weeks, so
  // x() stays day-accurate there; inside a break nothing real is drawn.
  const x = (ms: number) => {
    if (ms <= tMin) return labelW;
    if (ms >= tMax) return W - PAD_R;
    const k = weekIndex(ms);
    const frac = collapsed[k] ? 0.5 : (ms - (tMin + k * WEEK_MS)) / WEEK_MS;
    return weekX0[k] + frac * (weekX1[k] - weekX0[k]);
  };

  // month boundaries for the axis labels (one letter per month, centred in its span)
  const monthNarrow = new Intl.DateTimeFormat(locale, { month: 'narrow', timeZone: 'UTC' });
  const months: { ms: number; next: number }[] = [];
  {
    const d0 = new Date(tMin);
    let my = d0.getUTCFullYear(), mm = d0.getUTCMonth();
    for (let g = 0; g < 160; g++) {
      const ms = Date.UTC(my, mm, 1);
      if (ms > tMax) break;
      months.push({ ms, next: Date.UTC(mm === 11 ? my + 1 : my, (mm + 1) % 12, 1) });
      if (++mm > 11) { mm = 0; my += 1; }
    }
  }
  const showMonthLetters = colW >= 5;

  // one dominant cell state per (row, week), clipped to the phase's true day extent
  const cellsFor = (r: ScheduleRow) => {
    const spans = phaseSpans(r, now);
    const cells: { k: CellKind; x1: number; x2: number }[] = [];
    for (const wk of weeks) {
      const w0 = wk, w1 = wk + WEEK_MS;
      let best: { kind: CellKind; ov: number; a: number; b: number } | null = null;
      for (const s of spans) {
        const a = Math.max(w0, s.a), b = Math.min(w1, s.b);
        const ov = b - a;
        if (ov > 0 && (!best || ov > best.ov)) best = { kind: s.kind, ov, a, b };
      }
      if (!best) continue;
      // clip the drawn cell to the WEEK, but keep the phase's true start/end day at
      // the row's extremes (day-accurate transitions), leaving a hairline gutter so
      // the cells read as a row of week blocks.
      const x1 = Math.max(x(w0) + CELL_GAP / 2, x(Math.max(w0, r.startMs)));
      const x2 = Math.min(x(w1) - CELL_GAP / 2, x(Math.min(w1, r.endMs)));
      if (x2 > x1) cells.push({ k: best.kind, x1, x2 });
    }
    return cells;
  };

  // ---- buffer-on-hand lane: the buffer the SOP started with, stepped through the
  // dated events to now. Drawn only when an SOP gives an absolute buffer to track. ----
  const startBuffer = ledger.startBufferDays;
  const laneEvents: LaneEvent[] = [];
  rows.forEach((r, i) => {
    if (r.gapBeforeDays >= 1 && i > 0) laneEvents.push({ atMs: rows[i - 1].endMs, deltaDays: -r.gapBeforeDays, kind: 'loss', projected: false });
    if (r.kind === 'done' && r.varianceDays >= 1) laneEvents.push({ atMs: r.plannedEndMs, deltaDays: -r.varianceDays, kind: 'loss', projected: false });
    if (r.kind === 'done' && r.varianceDays <= -1) laneEvents.push({ atMs: r.endMs, deltaDays: -r.varianceDays, kind: 'gain', projected: false });
    if (isForecastOver(r)) laneEvents.push({ atMs: r.plannedEndMs, deltaDays: -r.varianceDays, kind: 'forecast', projected: true });
  });
  laneEvents.sort((a, b) => a.atMs - b.atMs);

  // Walk the events into flats (a level held over a span) and risers (a step at an
  // event), carrying the running LEVEL so the lane can label the buffer actually in
  // hand at each inflection, not just how much that step moved it.
  const laneClampX = (ms: number) => Math.max(labelW, Math.min(W - PAD_R, x(ms)));
  const laneStartX = laneClampX(firstStartMs);
  const laneFlats: { x1: number; x2: number; level: number; projected: boolean }[] = [];
  const laneRisers: { x: number; from: number; to: number; kind: LaneEvent['kind']; projected: boolean }[] = [];
  let laneLevel = startBuffer ?? 0; // the running buffer; its final value is the level at `now`
  let laneMaxLevel = laneLevel;
  let lanePx = laneStartX;
  for (const e of laneEvents) {
    const ex = laneClampX(e.atMs);
    laneFlats.push({ x1: lanePx, x2: ex, level: laneLevel, projected: e.projected });
    laneRisers.push({ x: ex, from: laneLevel, to: laneLevel + e.deltaDays, kind: e.kind, projected: e.projected });
    laneLevel += e.deltaDays;
    laneMaxLevel = Math.max(laneMaxLevel, laneLevel);
    lanePx = ex;
  }
  laneFlats.push({ x1: lanePx, x2: x(now), level: laneLevel, projected: false });
  const laneEndLevel = laneLevel;
  const laneMax = Math.max(10, laneMaxLevel, ledger.guidelineDays) * 1.12;
  const bufY = (v: number) => laneBot - (Math.max(0, v) / laneMax) * (LANE_H - 10);

  const constraintCx = labelW - (labelW > 40 ? 12 : 6);

  return (
    <div className={styles.chartwrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.scheduleSvg} role="img" aria-label={t(locale, 'clSchedule')}>
        {/* faint week gridlines — the column structure you scan down (none inside a
            collapsed run; the break glyph marks that discontinuity instead) */}
        {weeks.map((wk, k) => (collapsed[k] ? null : (
          <line key={`g${k}`} x1={x(wk)} y1={TOP - 6} x2={x(wk)} y2={gridBot + 2}
            stroke="var(--border)" strokeWidth={1} opacity={0.5} />
        )))}
        <line x1={x(tMax)} y1={TOP - 6} x2={x(tMax)} y2={gridBot + 2} stroke="var(--border)" strokeWidth={1} opacity={0.5} />

        {/* axis breaks: the conventional double-slash at the seam, a faint guide down the
            grid, and the collapsed duration spelled out — an unmarked break would be a
            false statement about how much time it represents (design.md §8c / #42) */}
        {breaks.map((b, i) => (
          <g key={`brk${i}`}>
            <line x1={b.cx} y1={TOP - 6} x2={b.cx} y2={sopMs != null ? laneBot : gridBot + 2}
              stroke="var(--border)" strokeWidth={1} strokeDasharray="2 3" />
            <path d={`M ${b.cx - 5} ${axisY + 3} l 4 -8 M ${b.cx - 1} ${axisY + 3} l 4 -8`}
              stroke="var(--muted)" strokeWidth={1.25} fill="none" />
            {/* clamp the label so a break near the right edge can't clip it off-canvas */}
            <ChartLabel x={Math.min(Math.max(b.cx, labelW + 16), W - PAD_R - 16)} y={axisY + 15}
              textAnchor="middle" fontSize={9} fill="var(--muted)">
              {t(locale, 'clAxisBreak', { d: b.days })}
            </ChartLabel>
          </g>
        ))}

        {/* today + SOP verticals span the grid (and the lane) */}
        <line x1={x(now)} y1={TOP - 12} x2={x(now)} y2={sopMs != null ? laneBot : gridBot + 2}
          stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
        <ChartLabel x={x(now)} y={TOP - 16} textAnchor="middle" fontSize={10} fill="var(--muted)">
          {t(locale, 'clTodayLabel', { date: dayShort(now, locale) })}
        </ChartLabel>
        {sopMs != null && (
          <>
            <line x1={x(sopMs)} y1={TOP - 12} x2={x(sopMs)} y2={laneBot} stroke="var(--fg)" strokeWidth={1.5} />
            <ChartLabel x={Math.min(x(sopMs), W - 8)} y={TOP - 16} textAnchor="end" fontSize={11} fill="var(--fg)">
              {t(locale, 'clSopLabel', { month: monthLong(sopMs, locale) })}
            </ChartLabel>
          </>
        )}

        {/* month letters under the grid */}
        <line x1={labelW} y1={axisY} x2={W - PAD_R} y2={axisY} stroke="var(--border)" strokeWidth={1} />
        {showMonthLetters && months.map((m) => {
          const from = Math.max(m.ms, tMin), to = Math.min(m.next, tMax);
          if (x(to) - x(from) < 10) return null;
          return (
            <ChartLabel key={`ml${m.ms}`} x={(x(from) + x(to)) / 2} y={axisY + 14} textAnchor="middle" fontSize={9} fill="var(--muted)">
              {monthNarrow.format(new Date(m.ms))}
            </ChartLabel>
          );
        })}

        {/* rows: label + constraint ring + day-accurate state cells + plan tick + idle marker */}
        {rows.map((r, i) => {
          const y = rowY(i);
          const cyTop = y - CELL_H / 2;
          const isConstraint = ledger.liveConstraintId === r.id;
          const cells = cellsFor(r);
          return (
            <g key={r.id}>
              {isConstraint && <ConstraintRing cx={constraintCx} cy={y} r={2} />}
              <ChartLabel x={isConstraint ? labelW - RING_PAD : labelW - TEXT_PAD} y={y + 3.5} textAnchor="end"
                fontSize={11} fill="var(--fg)" className={styles.rowLabel} onClick={() => onJump(r.id)}>
                {r.name}
              </ChartLabel>

              {/* idle handoff, drawn TO THE DAY in the channel above this row */}
              {r.gapBeforeDays >= 1 && i > 0 && (
                <>
                  <line x1={x(rows[i - 1].endMs)} y1={y - ROW_H / 2 + 3} x2={x(r.startMs)} y2={y - ROW_H / 2 + 3}
                    stroke="var(--warn)" strokeWidth={2} strokeDasharray="2 2" />
                  <ChartLabel x={(x(rows[i - 1].endMs) + x(r.startMs)) / 2} y={y - ROW_H / 2} textAnchor="middle"
                    fontSize={9} fill="var(--warn)">
                    {t(locale, 'clIdleDays', { d: r.gapBeforeDays })}
                  </ChartLabel>
                </>
              )}

              {cells.map((c, ci) => {
                const stroke = CELL_STROKE[c.k];
                return (
                  <rect key={ci} x={c.x1} y={cyTop} width={Math.max(0.75, c.x2 - c.x1)} height={CELL_H} rx={2}
                    fill={CELL_FILL[c.k]} fillOpacity={c.k === 'plan' ? 0.92 : 1}
                    stroke={stroke ?? 'none'} strokeWidth={stroke ? 1.25 : 0}
                    strokeDasharray={c.k === 'forecast' || c.k === 'sched' ? '2 1.5' : undefined} />
                );
              })}

              {/* plan tick — where the plan said this phase would end (day-accurate) */}
              {r.kind !== 'notStarted' && x(r.plannedEndMs) >= labelW && x(r.plannedEndMs) <= W - PAD_R && (
                <line x1={x(r.plannedEndMs)} y1={cyTop - 2} x2={x(r.plannedEndMs)} y2={cyTop + CELL_H + 2}
                  stroke="var(--muted)" strokeWidth={1.25} />
              )}

              {/* ONE hit target per row — the whole band answers to one hover (design.md) */}
              <rect className={styles.rowHit} x={0} y={y - ROW_H / 2} width={W} height={ROW_H} rx={4}
                tabIndex={0} role="button" aria-label={r.name}
                onMouseEnter={(e) => onRowCard(r, e.currentTarget, labelW, e.clientX)}
                onMouseMove={(e) => onRowCard(r, e.currentTarget, labelW, e.clientX)}
                onMouseLeave={() => onRowCard(null, null)}
                onFocus={(e) => onRowCard(r, e.currentTarget, labelW)}
                onBlur={() => onRowCard(null, null)}
                onClick={() => onJump(r.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump(r.id); } }}
                data-row-id={r.id} />
            </g>
          );
        })}

        {/* ---------- buffer-on-hand lane ---------- */}
        {sopMs != null && startBuffer != null && (
          <g>
            <rect x={labelW} y={laneTop} width={plotW} height={LANE_H} rx={6}
              fill="var(--surface)" stroke="var(--border)" strokeWidth={1} />
            <ChartLabel x={labelW - TEXT_PAD} y={laneTop + 13} textAnchor="end" fontSize={10} fill="var(--muted)">
              {t(locale, 'clBufferLane')}
            </ChartLabel>
            {/* reference lines: the 50%-rule reserve and zero */}
            {[0, ledger.guidelineDays].map((v, gi) => (
              <g key={gi}>
                <line x1={labelW} y1={bufY(v)} x2={W - PAD_R} y2={bufY(v)}
                  stroke="var(--border)" strokeWidth={1} strokeDasharray={gi ? '3 3' : undefined} opacity={gi ? 0.8 : 1} />
                <ChartLabel x={W - PAD_R - 2} y={bufY(v) - 2} textAnchor="end" fontSize={8} fill="var(--muted)">
                  {gi ? t(locale, 'clBufferGuideline', { d: v }) : t(locale, 'clBufferDaysShort', { d: 0 })}
                </ChartLabel>
              </g>
            ))}
            {/* flats: the level held over a span */}
            {laneFlats.map((f, i) => (
              <line key={`f${i}`} x1={f.x1} y1={bufY(f.level)} x2={f.x2} y2={bufY(f.level)}
                stroke="var(--fg)" strokeWidth={2} strokeDasharray={f.projected ? '3 2' : undefined} />
            ))}
            {/* the buffer the program STARTED with — the baseline every later level reads from */}
            <circle cx={laneStartX} cy={bufY(startBuffer)} r={2.4} fill="var(--fg)" />
            <ChartLabel x={laneStartX} y={bufY(startBuffer) - 6} textAnchor="middle" fontSize={8} fill="var(--muted)">
              {t(locale, 'clBufferDaysShort', { d: startBuffer })}
            </ChartLabel>
            {/* risers: a coloured step at each event, labelled with the buffer IN HAND after it */}
            {laneRisers.map((s, i) => {
              const col = s.kind === 'gain' ? 'var(--ok)' : s.kind === 'forecast' ? 'var(--warn)' : 'var(--bad)';
              const up = s.to >= s.from;
              return (
                <g key={`r${i}`}>
                  <line x1={s.x} y1={bufY(s.from)} x2={s.x} y2={bufY(s.to)} stroke={col} strokeWidth={2.5}
                    strokeDasharray={s.projected ? '3 2' : undefined} />
                  <circle cx={s.x} cy={bufY(s.to)} r={2.4} fill={col} />
                  <ChartLabel x={s.x} y={bufY(s.to) + (up ? -6 : 12)} textAnchor="middle" fontSize={8} fill={col}>
                    {t(locale, 'clBufferDaysShort', { d: Math.round(s.to) })}
                  </ChartLabel>
                </g>
              );
            })}
            {/* now: the buffer currently in hand (where the walked line lands) */}
            <circle cx={x(now)} cy={bufY(laneEndLevel)} r={3} fill="var(--fg)" />
            <ChartLabel x={x(now) + 6} y={bufY(laneEndLevel) - 6} fontSize={10} fill="var(--fg)">
              {t(locale, 'clBufferNow', { d: Math.round(laneEndLevel) })}
            </ChartLabel>
          </g>
        )}
      </svg>
    </div>
  );
}

export { CARD_W, W };
