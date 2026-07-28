'use client';

import { useRef, useState, type SVGProps } from 'react';
import ChartLabel from './ChartLabel';
import { t, Locale } from '../lib/i18n';
import { localDate } from '../lib/dates';
import { DAY_MS, dayFloor } from '../lib/sop';
import ConstraintRing from './ConstraintRing';
import { hasIdleGapBefore, isForecastOver, isRealizedOverrun, isRealizedUnderrun } from '../lib/chainLedger';
import type { ChainLedgerResult, ScheduleRow } from '../lib/chainLedger';
import { bufferSeries, type BufferPoint } from '../lib/bufferSeries';
import { flowScale, blownAt } from '../lib/bufferFlow';
import {
  keepNonOverlapping, dodgeLabels, inkBox, halfHFor, baselineToCentreY, centreToBaselineY,
  type PlacedLabel,
} from '../lib/labelPlacement';
import { focusWindow, panWindow, zoomWindow, type Span } from '../lib/focusWindow';
import styles from './ChainLedger.module.css';

// The Critical Chain "Schedule" instrument (docs/CRITICAL_CHAIN_VIEW_PLAN.md §4a,
// issues #75 then #161). Two panels on one x-axis:
//   • OPTION A BARS — one row per chain phase, and the phase's VARIANCE rides its own
//     bar as a LENGTH (issue #161, decision 1). Every mark on a row is drawn from THAT
//     ROW's own dates, so it can be traced back to the phase it describes. That is the
//     whole argument: this replaced a phase × WEEK state grid, whose cell could only
//     say "mostly over-running that week" — and before that, full-height bands, which
//     belonged to no row at all. Critical chain is a relay-runner argument, so the DAY a
//     phase went past its estimate is the fact you act on, and a week cell rounds it off.
//     Marks, all day-accurate: solid ink for work that happened (soft once done, bold on
//     the live phase), a solid --bad tail past the plan tick for days already lost, a
//     dashed --ok ghost back to the tick for days handed back, a dashed --muted outline
//     for forecast / not-yet-started work, a dashed --bad outline for forecast to go
//     over, and a dashed --warn rule in the channel ABOVE the row for an idle handoff.
//   • a two-tone buffer FLOW below, on the same x-axis (issue #161, decision 2):
//     one value per day — buffer LEFT (green, in hand) against buffer SPENT (red) —
//     with the boundary between them as the reading. It replaces a stepped lane
//     whose ~10 risers each carried a label, and most of whose code existed to stop
//     those labels colliding; the reader wanted ONE number, and a step they want
//     explained is a column they look up in the grid above. That is what the shared
//     x-axis is for. Per-move fidelity did not move here — it already exists twice,
//     in "Where the buffer went" and in the day summary.
// All colour is theme tokens (globals.css); nothing is a literal (design.md §8b).

const WEEK_MS = 7 * DAY_MS;

// ---- SVG user-space geometry (px here is viewBox coordinate space, design.md §9) ----
const W = 900, PAD_R = 14, ROW_H = 34, TOP = 36;
const BAR_H = 19; // the bar inside each row band
// Where the idle-handoff rule sits inside a row band, measured DOWN from the band's top.
// The rule and the count that names it are BOTH rendered from the single `y` placeIdle
// returns, so they cannot drift apart; this only says where that line falls.
const IDLE_DY = 2;
// Air between a row label and the mark it is anchored beside, and the extra a rule needs
// beyond a label's own width before that label may sit CENTRED on it — below which the
// halo's knockout would leave too little rule showing either side to read as a rule.
const LABEL_GAP = 4, IDLE_CENTRE_AIR = 16;
const FLOW_H = 112, FLOW_GAP = 28; // the two-tone buffer flow below the grid
// EXTENTS of the flow's two short markers: the reserve stub in from the right edge, and
// the blown-day tick either side of 0%.
const GUIDELINE_STUB_W = 20, BLOWN_TICK_H = 6;
// STROKE widths, shared between what is DRAWN and the ink boxes the label pass must clear
// (`inkBox`) — a rule whose two sites disagree is one the pass thinks it dodged.
const BOUNDARY_W = 1.75, GRIDLINE_W = 1, GUIDELINE_W = 1.5, BLOWN_TICK_W = 2;
const AXIS_H = 24; // week/month ticks under the grid
const RING_PAD = 24, TEXT_PAD = 10, CHAR_W = 6.5, WIDE_CHAR_W = 12;
const CARD_W = 272;
// Type sizes (viewBox units — the SVG scales to the column, so these read a touch
// larger overall than the old 8–11 range that was hard to read, issue #83). FS_ROW
// (phase names) and FS_EMPH (today/SOP/now markers) share a value but are named apart
// on purpose, so either can be tuned without moving the other.
const FS_ROW = 12, FS_EMPH = 12, FS_AXIS = 11, FS_SMALL = 10;
// A run of this many empty weeks (no phase, no handoff) collapses to a marked break
// of BREAK_W instead of donating that many full columns to nothing (issue #75 / #42).
// 6 weeks so a modest buffer tail stays inline; only a clearly long run collapses.
const COLLAPSE_MIN_WEEKS = 6, BREAK_W = 26;
// Each zoom-in shrinks the focus window to this fraction of its span (zoom-out is the inverse).
const ZOOM_STEP = 0.6;

const textWidth = (s: string) =>
  [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? WIDE_CHAR_W : CHAR_W), 0);

/** A percentage as the axis writes it: rounded, and negatives with a real minus
 *  sign rather than a hyphen — this axis's negative half is its point, so the
 *  glyph that says so should not be the one that also means "range". */
const pctText = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

const dayShort = (ms: number, locale: Locale) => localDate(new Date(ms), locale, { month: 'short', day: 'numeric' });
const monthLong = (ms: number, locale: Locale) => localDate(new Date(ms), locale, { month: 'long', year: 'numeric' });

/** Monday 00:00 UTC on or before `ms` (ISO week start, matching the old graticule). */
function weekFloor(ms: number): number {
  const d = new Date(ms);
  const dow = d.getUTCDay() || 7; // Sun→7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - (dow - 1) * DAY_MS;
}
const weekCeil = (ms: number): number => weekFloor(ms + WEEK_MS - 1);

/** A full-height vertical — today, the SOP, a break seam, the crosshair — running `y0` to
 *  `y1` at `cx`, with `cut` removed from its middle. Every one of them crosses the gutter
 *  between the grid and the flow, where the flow's caption sits, and a rule through a word
 *  ruins the word; no placement pass can help, because they all nudge in y and this ink is
 *  vertical. One component so a fifth vertical cannot be added without the cut. */
function VRule({ cx, y0, y1, cut, ...stroke }: {
  cx: number; y0: number; y1: number; cut: { top: number; bottom: number } | null;
} & SVGProps<SVGLineElement>) {
  const spans = cut ? [[y0, cut.top], [cut.bottom, y1]] : [[y0, y1]];
  return <>{spans.map(([a, b], k) => <line key={k} x1={cx} y1={a} x2={cx} y2={b} {...stroke} />)}</>;
}

/** A hovered/focused row plus where its card should sit, in px relative to the section. */
export interface RowCard { row: ScheduleRow; left: number; top: number }

type BarKind = 'done' | 'elapsed' | 'over' | 'under' | 'forecast' | 'fover' | 'sched';
// Nuance, not a wall of black (user call): settled/done work recedes (soft ink), the
// LIVE phase's elapsed work carries the weight, and the red/green exceptions pop against
// that calm baseline. All theme tokens (design.md §8b).
//
// A mark is FILLED when work happened in it — `done`, `elapsed`, `over` — and OUTLINED
// when nothing did: `under` (days handed back, which are days nobody worked), `forecast`,
// `fover` and `sched`. Outlined and dashed are the same set on purpose:
// `BAR_STROKE[k] != null` IS "this mark is a claim, not a record", and the render site
// derives the dash from it, so a new kind cannot be added as a solid claim by forgetting
// a second table (the old code hard-coded `k === 'forecast' || k === 'sched'` — that
// second table, in its drift-prone form).
const BAR_FILL: Record<BarKind, string> = {
  done: 'var(--fg)', elapsed: 'var(--fg)', over: 'var(--bad)',
  under: 'none', forecast: 'none', fover: 'none', sched: 'none',
};
// Only the three FILLED kinds have a meaningful entry here; the outlined four are 1
// because their fill is `none` and an opacity on nothing is nothing. Exhaustive over
// BarKind anyway, so adding a kind is a type error rather than a silently missing look —
// but do not read the four 1s as tuned values, or spend time adjusting them.
const BAR_OPACITY: Record<BarKind, number> = {
  done: 0.42, elapsed: 0.86, over: 0.94, under: 1, forecast: 1, fover: 1, sched: 1,
};
const BAR_STROKE: Record<BarKind, string | null> = {
  done: null, elapsed: null, over: null,
  under: 'var(--ok)', forecast: 'var(--muted)', fover: 'var(--bad)', sched: 'var(--muted)',
};

/** One drawn span of a phase's own timeline. */
interface BarMark { kind: BarKind; a: number; b: number }

/** The marks a phase draws, in ms, each one a span of ITS OWN dates — the encoding, in
 *  one pure function. Option A's rule is that a mark has an owner, so nothing here reads
 *  another row, a week boundary or the chart's geometry.
 *
 *  Which rows earn an over/under tail is decided by the exported waterfall predicates,
 *  never by comparing the dates again: the chart, the buffer flow, the day summary and
 *  "Where the buffer went" then cannot disagree about which phases moved the buffer
 *  (chainLedger.ts's predicate header; the +1-day phase that drew a red mark with no
 *  waterfall row behind it is the bug that rule exists for). */
function barMarks(r: ScheduleRow, now: number): BarMark[] {
  if (r.kind === 'done') {
    // The solid bar runs to whichever end came FIRST, and the tail past it says which
    // way the phase missed. A phase that landed inside the predicates' 1-day noise floor
    // has no tail at all, so its bar runs to its true end rather than stopping at a plan
    // tick it did not quite meet — the chart would otherwise draw a few hours of work as
    // no work.
    if (isRealizedOverrun(r)) {
      return [{ kind: 'done', a: r.startMs, b: r.plannedEndMs }, { kind: 'over', a: r.plannedEndMs, b: r.endMs }];
    }
    if (isRealizedUnderrun(r)) {
      return [{ kind: 'done', a: r.startMs, b: r.endMs }, { kind: 'under', a: r.endMs, b: r.plannedEndMs }];
    }
    return [{ kind: 'done', a: r.startMs, b: r.endMs }];
  }
  if (r.kind === 'active') {
    const elapsedEnd = Math.min(now, r.endMs);
    const marks: BarMark[] = [{ kind: 'elapsed', a: r.startMs, b: elapsedEnd }];
    if (isForecastOver(r)) {
      marks.push({ kind: 'forecast', a: now, b: r.plannedEndMs });
      marks.push({ kind: 'fover', a: r.plannedEndMs, b: r.endMs });
    } else {
      marks.push({ kind: 'forecast', a: now, b: r.endMs });
    }
    return marks;
  }
  return [{ kind: 'sched', a: r.startMs, b: r.endMs }]; // notStarted
}

/** The variance a row's tail already says as a LENGTH, as the number that says it in
 *  days, the date to anchor that number to, and the ink to write it in — or null where
 *  the phase moved no buffer and draws no tail.
 *
 *  Beside `barMarks` and pure for the same reason: the three predicates tested here are
 *  three of the ones tested there, so the tail and the number cannot disagree about which
 *  rows moved the buffer. `varianceDays` is read only to PRINT, which is the exemption
 *  chainLedger.ts's predicate header grants explicitly — the eslint family blocks
 *  ORDERING comparisons on it, not display. */
function varianceLabel(r: ScheduleRow, locale: Locale): { text: string; fill: string; at: number } | null {
  if (isRealizedOverrun(r)) return { text: t(locale, 'clBarOver', { d: r.varianceDays }), fill: 'var(--bad)', at: r.endMs };
  if (isRealizedUnderrun(r)) return { text: t(locale, 'clBarUnder', { d: -r.varianceDays }), fill: 'var(--ok)', at: r.plannedEndMs };
  if (isForecastOver(r)) return { text: t(locale, 'clBarOver', { d: r.varianceDays }), fill: 'var(--bad)', at: r.endMs };
  return null;
}

export function ChainSchedule({ ledger, sopMs, now, locale, onRowCard, onJump }: {
  ledger: ChainLedgerResult; sopMs: number | null; now: number; locale: Locale;
  onRowCard: (row: ScheduleRow | null, el: SVGRectElement | null, clientX?: number) => void;
  onJump: (phaseId: number) => void;
}) {
  // A hover crosshair synchronised across the grid AND the buffer lane, so the eye can
  // read one date down both at once (#75). Hooks stay above the early return.
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  // Focus window (#75): null = Fit (the whole chain). When set, the x-axis narrows to this
  // date range so day-level detail is legible; the user sizes it (Fit / 2-week / zoom ±) and
  // drags to slide it. Held here because it drives the same x() the whole instrument reads.
  const [focus, setFocus] = useState<Span | null>(null);
  const drag = useRef<{ clientX: number; from: Span } | null>(null); // an in-flight pan gesture
  const didPan = useRef(false); // a pan just moved the view → swallow the click it would fire
  const rows = ledger.schedule;
  if (rows.length === 0) return null;

  const lastEnd = rows[rows.length - 1].endMs;
  // The DATA extent always reaches the SOP; a long run of EMPTY weeks (the buffer tail, or a
  // stretch nothing lands on) is COLLAPSED to a marked break rather than donating that many
  // columns to nothing (issue #75, superseding #42's "break the linear axis").
  const firstStartMs = Math.min(...rows.map((r) => r.startMs));
  const dataMin = weekFloor(firstStartMs);
  const dataMax = weekCeil(Math.max(sopMs ?? 0, lastEnd, now));
  // The RENDERED axis is the focus window snapped to whole weeks (the grid is week-based), or
  // the full data extent in Fit. Everything downstream — weeks, occupied, x, msAtX — reads
  // tMin/tMax, so narrowing them here zooms the whole instrument (grid + lane) from one place.
  const tMin = focus ? Math.max(dataMin, weekFloor(focus.min)) : dataMin;
  const tMax = focus ? Math.min(dataMax, weekCeil(focus.max)) : dataMax;
  const inView = (ms: number) => ms >= tMin && ms <= tMax;
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
  const flowTop = axisY + AXIS_H + FLOW_GAP;
  const flowBot = flowTop + FLOW_H;
  // The flow is a share of B₀, so it needs a B₀ to be a share OF: no SOP, or a program
  // that started with no buffer at all, and there is no percentage story to tell.
  // bufferSeries says so by returning null, and the chart says so in words rather than
  // drawing a frame it invented (AGENTS lesson 5).
  const series = sopMs != null ? bufferSeries(ledger, now) : null;
  const noteY = flowTop + 4; // where the honest "no buffer to divide" line sits instead
  const H = (series ? flowBot : sopMs != null ? noteY : gridBot + AXIS_H) + 26;
  // How far a full-height vertical (today, a break seam, the crosshair) runs: to the
  // flow's floor when the flow is drawn, else just past the grid.
  const vExtentBot = series ? flowBot : gridBot + 2;
  // The crosshair's date caption sits below the line — but with no flow the line stops
  // ABOVE the month-letter axis, so drop the caption clear of that axis rather than 15px
  // under the line (where it would land in the same band as the month letters).
  const crosshairDateY = series ? flowBot + 15 : axisY + AXIS_H + 12;

  // The flow's CAPTION sits in the gutter between the two panels — and every full-height
  // vertical (today, the SOP, a break seam, the crosshair) runs straight through that
  // gutter to reach the flow. A rule through a word ruins the word, and no de-collider
  // can help here: the placement passes nudge labels in Y, and this ink is vertical. So a
  // vertical is CUT where it would cross the caption, and only there — one date still
  // reads down both panels, the cut lands in the panel gutter where the eye expects a
  // seam, and the caption is safe from a crosshair that can arrive at any x.
  // The cut is UNCONDITIONAL, not "only where a vertical would actually hit the caption":
  // the crosshair follows the pointer, so a conditional gap would open and close as the
  // user sweeps across the caption — a flicker on the one line they are actively moving.
  // Cutting every vertical instead gives the whole gutter one consistent seam, and drops
  // the caption's width (measured with this file's own narrow estimator, the unsafe
  // direction for a cut) out of the geometry entirely. Half-height follows `box()`'s
  // convention below, so the gap matches the box the placement passes reserve.
  const flowTitleY = flowTop - 8; // baseline of the caption rendered with the flow
  const captionCut = series ? (() => {
    const cy = baselineToCentreY(flowTitleY, FS_SMALL), halfH = halfHFor(FS_SMALL);
    return { top: cy - halfH, bottom: cy + halfH };
  })() : null;

  // ---- piecewise time axis: full weeks share the space; empty runs collapse ----
  // A week is OCCUPIED (never collapses) if any phase span or idle handoff touches it,
  // or it holds the `today`/SOP rule — collapse keys on emptiness, not on band kind
  // (design.md §8c / #42 open-Q4, so the overshoot case collapses the right span too).
  const weekIndex = (ms: number) => Math.floor((weekFloor(ms) - tMin) / WEEK_MS);
  const occupied = weeks.map((w0) => {
    const w1 = w0 + WEEK_MS;
    return rows.some((r, i) =>
      barMarks(r, now).some((s) => s.b > w0 && s.a < w1)
      || (hasIdleGapBefore(r) && i > 0 && rows[i - 1].endMs < w1 && r.startMs > w0));
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
  // Inverse of x() for the hover crosshair: the date under a pixel. A collapsed run
  // holds no real dates, so it resolves to that run's start.
  const msAtX = (px: number): number => {
    if (px <= labelW) return tMin;
    if (px >= W - PAD_R) return tMax;
    let k = weekX0.findIndex((x0, i) => px >= x0 && px < weekX1[i]);
    if (k < 0) k = nWeeks - 1;
    const wStart = tMin + k * WEEK_MS;
    return collapsed[k] ? wStart : wStart + ((px - weekX0[k]) / (weekX1[k] - weekX0[k])) * WEEK_MS;
  };
  // Pointer clientX → hovered date, via the SVG's rendered box → viewBox units. Suppressed
  // mid-pan: a drag is scrubbing the view, not scanning a date.
  const trackPointer = (clientX: number) => {
    if (drag.current) return;
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = Math.max(labelW, Math.min(W - PAD_R, ((clientX - r.left) / r.width) * W));
    setHoverMs(msAtX(px));
  };

  // ---- zoom / pan (#75) ----
  // Pan drags the focus window under the pointer; only meaningful once zoomed in. Panning
  // maps client-px moved → viewBox px → ms across the CURRENT view span, applied from the
  // window at gesture start so it never drifts. A move past a few px marks the gesture a pan
  // (so the trailing click doesn't fire onJump) and drops the crosshair.
  const panBy = (clientX: number) => {
    const d = drag.current;
    const r = svgRef.current?.getBoundingClientRect();
    if (!d || !r) return;
    const dxPx = ((clientX - d.clientX) / r.width) * W;
    if (Math.abs(dxPx) > 2) { didPan.current = true; setHoverMs(null); }
    const dxMs = -(dxPx / plotW) * (d.from.max - d.from.min); // content follows the mouse
    setFocus(panWindow(d.from, dxMs, dataMin, dataMax));
  };
  const startPan = (clientX: number) => { if (focus) { drag.current = { clientX, from: focus }; didPan.current = false; } };
  const endPan = () => { drag.current = null; };

  // Zoom buttons. Centre a zoom on the current view (or, from Fit, on today clamped to data).
  const zoomCenter = focus ? (focus.min + focus.max) / 2 : Math.min(Math.max(now, dataMin), dataMax);
  const fitSpan = (dataMax - dataMin) / 2; // the first zoom-in from Fit lands at half the chain
  const jumpToFit = () => setFocus(null);
  const jumpToTwoWeeks = () => setFocus(focusWindow(zoomCenter, 2 * WEEK_MS, dataMin, dataMax));
  const zoomIn = () => setFocus(zoomWindow(focus, ZOOM_STEP, zoomCenter, fitSpan, dataMin, dataMax));
  const zoomOut = () => setFocus(zoomWindow(focus, 1 / ZOOM_STEP, zoomCenter, fitSpan, dataMin, dataMax));

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

  // Axis-row labels (collapsed-break durations + month letters) must not overlap — the
  // break duration wins, a month letter near it yields (an overlapping label is useless).
  const axisBreakLabelX = breaks.map((b) => Math.min(Math.max(b.cx, labelW + 16), W - PAD_R - 16));
  const axisMonths = showMonthLetters
    ? months.map((m) => {
        const from = Math.max(m.ms, tMin), to = Math.min(m.next, tMax);
        return { ms: m.ms, letter: monthNarrow.format(new Date(m.ms)), cx: (x(from) + x(to)) / 2, span: x(to) - x(from) };
      }).filter((o) => o.span >= 12)
    : [];
  const axisLabelY = axisY + 16, axisHalfH = halfHFor(FS_AXIS);
  // Break durations (priority 2) and month letters (priority 1) share the axis line, so
  // de-collide them together, then split back per-series so each render site indexes its own.
  const axisKeep = keepNonOverlapping([
    ...breaks.map((b, i) => ({ x: axisBreakLabelX[i], y: axisLabelY, halfW: textWidth(t(locale, 'clAxisBreak', { d: b.days })) / 2 + 3, halfH: axisHalfH, priority: 2 })),
    ...axisMonths.map((o) => ({ x: o.cx, y: axisLabelY, halfW: textWidth(o.letter) / 2 + 3, halfH: axisHalfH, priority: 1 })),
  ]);
  const keepBreak = axisKeep.slice(0, breaks.length);
  const keepMonth = axisKeep.slice(breaks.length);
  // today vs SOP share the top line; if they'd collide, drop `today` a line below SOP.
  // These two REFLOW (both stay, on different lines) rather than going through
  // keepNonOverlapping, which HIDES a loser — both markers are always worth showing.
  // The SOP label is END-anchored and clamped to W-8, so its box is measured from there.
  const todayHalfW = textWidth(t(locale, 'clTodayLabel', { date: dayShort(now, locale) })) / 2;
  const sopLabelRight = sopMs != null ? Math.min(x(sopMs), W - 8) : 0;
  const sopLabelW = sopMs != null ? textWidth(t(locale, 'clSopLabel', { month: monthLong(sopMs, locale) })) : 0;
  const topClash = sopMs != null && x(now) + todayHalfW + 4 > sopLabelRight - sopLabelW && x(now) - todayHalfW < sopLabelRight;
  const todayLabelY = topClash ? TOP - 4 : TOP - 18;

  // Option A's bars: each mark drawn straight from the row's own dates, at the day, and
  // clipped to the FOCUS WINDOW rather than to a week. The filter drops two kinds of mark.
  // A ZERO-LENGTH one (`b > a`) is a span the row's dates collapsed — a phase whose
  // forecast remainder is nothing, say. One entirely OUTSIDE the window is dropped rather
  // than clamped, because x() pins an out-of-range date to the frame edge, so a clamped
  // mark would draw a sliver there claiming work happened on a day the reader can see is
  // empty.
  const barsFor = (r: ScheduleRow) => barMarks(r, now)
    .filter((m) => m.b > m.a && m.b > tMin && m.a < tMax)
    .map((m) => ({ k: m.kind, x1: x(Math.max(m.a, tMin)), x2: x(Math.min(m.b, tMax)) }));

  // ---- the row area's own labels: the per-bar variance number, and the idle-day count ----
  //
  // Neither goes through `dodgeLabels`, and that is a geometry fact rather than an
  // omission: a row is ROW_H tall around a BAR_H bar, so the free channel either side of
  // the bar is thinner than a label box (2 * halfHFor(FS_SMALL)). A nudge cannot clear the
  // bar without leaving the row, and a variance number on a neighbouring row would say
  // that neighbour ran over — the one thing Option A exists to prevent. So these labels
  // de-collide in X, where they DO have room, and the y each one sits at is fixed by what
  // it names.
  //
  // Two variance numbers are always ROW_H apart against boxes 2 * halfHFor(FS_SMALL)
  // tall, so those can never meet. The pair that CAN is an idle count and the variance
  // number of the row above it, and the data pairs them up: a gap usually opens precisely
  // because the previous phase over-ran, so the count lands on the tail that number sits at
  // the end of. `placeIdle` separates that pair — see there.
  //
  // Both labels are also clamped inside the frame and haloed, which are the two collisions
  // no de-collider sees at all: a clipped label and a label on ink.
  // tests/labelCollisionSweep.test.tsx §5 asserts all of it from the rendered geometry
  // rather than from this paragraph.
  const halfWOf = (text: string) => textWidth(text) / 2 + 3;
  /** The furthest left and right a label of this width may be CENTRED and still sit whole
   *  inside the plot — the clamp both placers end on. */
  const clampIntoFrame = (cx: number, halfW: number) =>
    Math.max(labelW + halfW, Math.min(W - PAD_R - halfW, cx));
  /** A label placed just past `at`, or just before it when past would leave the frame.
   *  Both row labels want this: a variance number sits beyond the end of its tail, and a
   *  short gap's count sits beyond the end of its rule. */
  const besideOrFlipped = (at: number, halfW: number) =>
    clampIntoFrame(at + LABEL_GAP + halfW <= W - PAD_R - halfW
      ? at + LABEL_GAP + halfW
      : at - LABEL_GAP - halfW, halfW);
  /** The variance number placed beside the END of the tail it names — flipped to the
   *  tail's other side when it would run past the frame, which is not an edge case: the
   *  axis reaches the SOP, so the live phase's forecast tail often ends near it. */
  const placeVariance = (r: ScheduleRow, y: number) => {
    const v = varianceLabel(r, locale);
    if (v == null || !inView(v.at)) return null;
    return { text: v.text, fill: v.fill, x: besideOrFlipped(x(v.at), halfWOf(v.text)), y };
  };
  /** The idle handoff before a row: the dashed rule in the channel ABOVE it, and the day
   *  count ON that rule's own line — not stacked above it.
   *
   *  Above the rule is where this count used to sit, and the screenshot said no: it landed
   *  12.8px under the previous row's variance number, against the 12px those two boxes
   *  reserve — 0.8px of clearance, which no overlap test can fail and which reads as one
   *  clump of two numbers about two different rows. Nudging it DOWN toward its rule is not
   *  available either; that channel is ROW_H/2 − BAR_H/2 tall, thinner than a label box.
   *  Sitting it ON the line takes that pair to 19px apart — 7px of real clearance — and
   *  costs nothing, because the count is haloed and the rule is dashed: the knockout reads
   *  as the conventional annotated rule.
   *
   *  7px is still not much, so the rest of the separation is taken in X, where there
   *  is room. The count centres on the rule only when the rule is long enough to still
   *  read either side of the knockout; on a SHORT gap it steps past the rule's right end
   *  instead. Both halves of that rule earn their place: centring on a short rule would
   *  delete the mark into its own label (AGENTS lesson 18), and it is also what put the
   *  count under the previous row's number, because a short gap's midpoint is barely a
   *  label's width from the tail that gap follows. It steps LEFT only when stepping right
   *  would leave the frame — the number is the point of the mark, and half a number
   *  outside the plot is not a number. */
  const placeIdle = (r: ScheduleRow, i: number, y: number) => {
    if (!hasIdleGapBefore(r) || i === 0 || rows[i - 1].endMs >= tMax || r.startMs <= tMin) return null;
    const x1 = x(rows[i - 1].endMs), x2 = x(r.startMs);
    const text = t(locale, 'clIdleDays', { d: r.gapBeforeDays }), halfW = halfWOf(text);
    const fitsOnTheRule = x2 - x1 >= 2 * halfW + IDLE_CENTRE_AIR;
    return {
      text, x1, x2,
      x: fitsOnTheRule ? clampIntoFrame((x1 + x2) / 2, halfW) : besideOrFlipped(x2, halfW),
      y: y - ROW_H / 2 + IDLE_DY,
    };
  };

  // ---- the two-tone buffer flow (issue #161, decisions 2/3/5/7) ----
  // Everything the flow renders is derived here, in ONE place, from the day series:
  // the frame, the two bands, the boundary between them, and every label — including
  // the de-collision pass, so no label can be added later without going through it.
  // Label strategy is the semantic split (design.md §8c): the y-axis values HIDE a
  // loser (a dropped gridline value is still readable off the scale and its
  // neighbours), while the readings — how much is left at today, what the negative
  // half means, the day the buffer ran out — are each a distinct fact that cannot be
  // inferred from anything else on the chart, so they DODGE and all survive.
  const flow = series == null ? null : (() => {
    const scale = flowScale(series.points.map((p) => p.leftPct));
    const yOf = (pct: number) => flowBot - ((pct - scale.min) / (scale.max - scale.min)) * FLOW_H;
    // Only the focus window is drawn, plus one point either side: x() clamps those to
    // the frame's edge, so the bands reach it instead of stopping a day short.
    const firstIn = series.points.findIndex((p) => inView(p.ms));
    if (firstIn < 0) return null;
    let lastIn = series.points.length - 1;
    while (lastIn > firstIn && !inView(series.points[lastIn].ms)) lastIn--;
    const pts = series.points.slice(Math.max(0, firstIn - 1), lastIn + 2);
    const px = (p: BufferPoint) => Math.max(labelW, Math.min(W - PAD_R, x(p.ms)));

    // A band between two per-day percentage functions, as one filled polygon: out
    // along the top, back along the bottom. Where the two meet the band is
    // zero-height and simply disappears — which is how a blown buffer draws no green
    // and a program above 100% draws no red, without either being a special case.
    const band = (ps: BufferPoint[], top: (p: BufferPoint) => number, bot: (p: BufferPoint) => number) =>
      ps.length < 2 ? null
        : `M ${ps.map((p) => `${px(p)} ${yOf(top(p))}`).join(' L ')}`
          + ` L ${[...ps].reverse().map((p) => `${px(p)} ${yOf(bot(p))}`).join(' L ')} Z`;
    // Split at today so the forecast tail draws lighter and dashed (decision 5). Each
    // half keeps the boundary day the other ends on, so they meet rather than leaving
    // a one-day slit between them.
    const past = pts.filter((p, i) => !p.projected || (i > 0 && !pts[i - 1].projected));
    const ahead = pts.filter((p, i) => p.projected || (i + 1 < pts.length && pts[i + 1].projected));
    const ZERO = () => 0, FULL = () => 100;
    const leftTop = (p: BufferPoint) => Math.max(0, p.leftPct); // green: 0 → buffer left
    const spentBot = (p: BufferPoint) => Math.min(100, p.leftPct); // red: buffer left → 100%
    const debtBot = (p: BufferPoint) => Math.min(0, p.leftPct); // the part below 0%: days past SOP
    const boundary = (ps: BufferPoint[]) => ps.map((p) => `${px(p)},${yOf(p.leftPct)}`).join(' ');

    const nowPt = series.points.find((p) => p.ms === dayFloor(now)) ?? series.points[series.points.length - 1];
    const blown = blownAt(series.points);
    // The 50%-of-remaining reserve is a value that only exists as of NOW
    // (chainLedger.ts defines it as remainingTotal / 2), so it is a marker, never a
    // rule across the chart — a full-width line would state a threshold that did not
    // apply in the past (decision 7). Two cases drop it rather than distort something:
    // a reserve OUTSIDE the frame (the frame is derived from the FLOW, and stretching
    // it to hold a reserve far above B₀ would squash the reading this chart exists for
    // — the headline's title states the reserve in words either way), and a reserve of
    // ZERO days, which is not a threshold but a program with no work left.
    const guidelinePct = (ledger.guidelineDays * 100) / series.startBufferDays;
    const showGuideline = ledger.guidelineDays > 0 && guidelinePct > scale.min && guidelinePct < scale.max;

    /** The boundary's highest and lowest y across a span of the plot, or null where the
     *  line does not reach. A label is a horizontal strip ~90px wide, and this line can
     *  drop that far inside it — so a reading placed a fixed offset from the boundary AT
     *  TODAY gets struck through by the boundary a few pixels away. Each reading clears
     *  the line across its OWN width instead, which is a fact about the data under it,
     *  not a guess.
     *
     *  Whole SEGMENTS, not sampled points: a span narrower than one day's spacing sits
     *  between two points and would otherwise report "no line here" while the line runs
     *  straight through it. A segment that only partly overlaps donates its full drop,
     *  which over-reserves — the safe direction (labelPlacement's TUNING note). */
    const boundaryBand = (from: number, to: number): { top: number; bottom: number } | null => {
      let top = Infinity, bottom = -Infinity;
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        if (px(p1) < from) continue;
        if (px(p0) > to) break; // pts are ms-ascending and px is monotone in ms
        top = Math.min(top, yOf(p0.leftPct), yOf(p1.leftPct));
        bottom = Math.max(bottom, yOf(p0.leftPct), yOf(p1.leftPct));
      }
      return top === Infinity ? null : { top, bottom };
    };

    // ---- labels ----
    const box = (text: string, cx: number, cy: number, priority: number, size = FS_SMALL) =>
      ({ x: cx, y: cy, halfW: textWidth(text) / 2 + 3, halfH: halfHFor(size), priority, text, size });
    // Boxes are in CENTRE space (what labelPlacement reasons about); each render site
    // converts back to a baseline. The whole flow goes through one pass, so mixing the
    // two spaces — the trap this module's helpers exist to close — cannot happen here.
    const endAnchored = (text: string, right: number, cy: number, priority: number, size = FS_SMALL) =>
      box(text, right - (textWidth(text) / 2 + 3), cy, priority, size);
    const startAnchored = (text: string, left: number, cy: number, priority: number, size = FS_SMALL) =>
      box(text, left + textWidth(text) / 2 + 3, cy, priority, size);

    // The scale: plain percentages in the left gutter…
    const axisTicks = scale.ticks.filter((v) => v >= 0)
      .map((v) => ({ v, ...endAnchored(t(locale, 'clFlowPct', { p: pctText(v) }), labelW - 4, yOf(v), 1) }));
    // …and, below zero, what the percentage MEANS (decision 3) — never "−14 d left",
    // which is not a thing anybody has. That sentence is far too wide for the name
    // gutter, so it sits just inside the plot, where the sub-zero half is empty by
    // construction: the buffer starts at 100% and only ever reaches this band late.
    const debtTicks = scale.ticks.filter((v) => v < 0).map((v) => ({
      v,
      ...startAnchored(t(locale, 'clFlowPastSop', {
        p: pctText(v), d: Math.round((-v * series.startBufferDays) / 100),
      }), labelW + 6, yOf(v), 1),
    }));
    // The reading at today: what is in hand, and what has gone — one label per band,
    // the emphasis on what is LEFT, which is the number the reader came for.
    //
    // Past zero there is nothing "left" to report, so the reading switches to the
    // axis's own phrasing, days past the SOP: the chart never writes "−76% left ·
    // −126d", a quantity nobody has (decision 3, and the rule the axis already follows).
    const leftText = nowPt.leftPct >= 0
      ? t(locale, 'clFlowLeft', { p: pctText(nowPt.leftPct), d: Math.round(nowPt.leftDays) })
      : t(locale, 'clFlowPastSop', { p: pctText(nowPt.leftPct), d: Math.round(-nowPt.leftDays) });
    const spentText = t(locale, 'clFlowSpent', { p: pctText(100 - nowPt.leftPct) });
    // The pair sits to the RIGHT of today and FLIPS to its left when the wider of the
    // two would run past the frame — not an edge case: a program whose forecast finish
    // is near its SOP puts today hard against the right edge, and it shipped clipped on
    // the first real page load. Both flip on the WIDER one's measurement; split, they
    // would read as two labels about two different moments.
    const nowWidest = Math.max(textWidth(leftText), textWidth(spentText));
    const nowFits = x(now) + 6 + nowWidest + 6 <= W - PAD_R;
    // The strip of plot the pair occupies, and where the boundary runs across it: the
    // "left" reading sits below the line's lowest point there, "spent" above its
    // highest, so neither is crossed however steeply the buffer was moving.
    const nowSpan = nowFits
      ? { from: x(now), to: x(now) + 12 + nowWidest }
      : { from: x(now) - 12 - nowWidest, to: x(now) };
    const nowBand = boundaryBand(nowSpan.from, nowSpan.to)
      ?? { top: yOf(nowPt.leftPct), bottom: yOf(nowPt.leftPct) };
    // `priority` is inert for these two — they only ever reach dodgeLabels, which keeps
    // every label and orders by x. It is carried so the box grammar stays one grammar.
    const nowAnchored = (text: string, cy: number, priority: number, size: number) => (nowFits
      ? startAnchored(text, x(now) + 6, cy, priority, size)
      : endAnchored(text, x(now) - 6, cy, priority, size));
    // Which side of the boundary the pair sits on is a question about ROOM, not about
    // sign. A blown buffer has no green band left to sit in; its MIRROR — a buffer at or
    // above B₀, where the line rides in the frame's top pad — has no red band above. Same
    // fact, both times: one side of the line has run out of plot, so both readings stack
    // into the side that is left, "spent" still above "left" (the tank drains from the
    // top). Reading that off `leftPct > 0` saw only the blown half, so a program holding
    // 115% of its buffer placed "spent" above the frame's ceiling — where the dodge's own
    // bounds clamp pinned it back onto the boundary, dead centre.
    //
    // The pair is placed TOGETHER, in one expression, because what has to hold is a
    // relation between them: "spent" above "left", always. As two independent offsets it
    // inverted in the state neither of them named — a boundary that both starts high and
    // collapses below zero across the label's own width, so NEITHER side has room. FAR is
    // what keeps the order when they share a side: dodgeLabels orders by x, not by
    // priority, so a flipped pair would otherwise stack in whichever order their two
    // widths happened to fall.
    //
    // The predicates size ONE label per side, which is the straddle case they decide. When
    // they send both to one side, that side may be too small for the FAR label too —
    // deliberately: dodgeLabels clamps it into the plot and dodges it clear, and the clamp
    // can only push it FURTHER from the line, never past its partner, so the order
    // survives. Sizing them for the stacked case would only move the straddle threshold
    // and stop the pair straddling in plots where it fits comfortably.
    const NEAR = 10, FAR = 25;
    const above = nowBand.top - flowTop, below = flowBot - nowBand.bottom;
    const roomAbove = above >= FS_SMALL + NEAR, roomBelow = below >= FS_EMPH + NEAR;
    const [leftY, spentY] = roomAbove && roomBelow
      ? [nowBand.bottom + NEAR, nowBand.top - NEAR]
      : (roomBelow || (!roomAbove && below >= above))
        ? [nowBand.bottom + FAR, nowBand.bottom + NEAR] // both below, spent nearer the line
        : [nowBand.top - NEAR, nowBand.top - FAR]; // both above, left nearer the line
    const nowLeft = nowAnchored(leftText, leftY, 3, FS_EMPH);
    const nowSpent = nowAnchored(spentText, spentY, 2, FS_SMALL);
    const guidelineLabel = endAnchored(
      t(locale, 'clBufferGuideline', { d: ledger.guidelineDays }), W - PAD_R - 3, yOf(guidelinePct) - 8, 2);
    // Centred on the day it names, but never off the frame: a label half outside the
    // plot is one you cannot read, and its date is the point of it.
    const blownLabel = blown && inView(blown.ms)
      ? (() => {
          const b = box(t(locale, 'clFlowBlown', { date: dayShort(blown.ms, locale) }), x(blown.ms), yOf(0) - 13, 2);
          return { ...b, x: Math.max(labelW + b.halfW, Math.min(W - PAD_R - b.halfW, b.x)) };
        })()
      : null;

    // The anchors hide a loser; the readings all survive, nudged in y around whichever
    // anchors did. Bounds keep every dodged label inside the plot — below its floor is
    // where the crosshair's own date caption lives.
    const anchors = [...axisTicks, ...(showGuideline ? [guidelineLabel] : [])];
    const anchorKeep = keepNonOverlapping(anchors);
    const readings = [...debtTicks, nowLeft, nowSpent, ...(blownLabel ? [blownLabel] : [])];

    // Every piece of INK the readings have to clear, as opposed to the CAPTIONS naming it
    // — see `inkBox`, which exists because this is the bug that shipped here. Each entry
    // states the same geometry as its render site below, so a change to one that misses
    // the other is a rule the pass thinks it dodged. The boundary is the one that is not
    // axis-aligned, so it goes in per reading, as the y range it covers across THAT
    // reading's own width — the fact under the label, not a guess taken at one x.
    //
    // Two pieces of the flow's ink are deliberately absent, because something else already
    // holds them off: the frame, which the `bounds` below keep every label inside, and the
    // dot at today, which the readings clear by being anchored 6px past it in x.
    const boundaryUnder = (l: PlacedLabel): PlacedLabel[] => {
      const b = boundaryBand(l.x - l.halfW, l.x + l.halfW);
      return b == null ? [] : [inkBox(l.x - l.halfW, b.top, l.x + l.halfW, b.bottom, BOUNDARY_W)];
    };
    const ink: PlacedLabel[] = [
      ...scale.ticks.map((v) => inkBox(labelW, yOf(v), W - PAD_R, yOf(v), GRIDLINE_W)),
      ...(showGuideline ? [inkBox(W - PAD_R - GUIDELINE_STUB_W, yOf(guidelinePct), W - PAD_R, yOf(guidelinePct), GUIDELINE_W)] : []),
      ...(blown && blownLabel ? [inkBox(x(blown.ms), yOf(0) - BLOWN_TICK_H, x(blown.ms), yOf(0) + BLOWN_TICK_H, BLOWN_TICK_W)] : []),
      ...readings.flatMap(boundaryUnder),
    ];

    const readingY = dodgeLabels([...anchors.filter((_, i) => anchorKeep[i]), ...ink], readings,
      { top: flowTop + 2, bottom: flowBot - 2 });
    const placed = readings.map((r, i) => ({ ...r, y: readingY[i] }));

    return {
      scale, yOf, nowPt, blown, guidelinePct, showGuideline,
      areas: {
        leftPast: band(past, leftTop, ZERO), leftAhead: band(ahead, leftTop, ZERO),
        spentPast: band(past, FULL, spentBot), spentAhead: band(ahead, FULL, spentBot),
        debtPast: band(past, ZERO, debtBot), debtAhead: band(ahead, ZERO, debtBot),
      },
      boundaryPast: boundary(past),
      boundaryAhead: boundary(ahead),
      axisTicks: axisTicks.filter((_, i) => anchorKeep[i]),
      guidelineLabel: showGuideline && anchorKeep[anchors.length - 1] ? guidelineLabel : null,
      debtLabels: placed.slice(0, debtTicks.length),
      nowLeftLabel: placed[debtTicks.length],
      nowSpentLabel: placed[debtTicks.length + 1],
      blownLabel: blownLabel ? placed[debtTicks.length + 2] : null,
    };
  })();

  const constraintCx = labelW - (labelW > 40 ? 12 : 6);

  const crosshairX = hoverMs != null ? x(hoverMs) : null;

  return (
    <div className={styles.chartwrap}>
      {/* zoom / pan controls: Fit (whole chain) · 2-week focus · zoom out/in. When zoomed,
          drag the chart to slide the window. */}
      <div className={styles.zoomBar} role="group" aria-label={t(locale, 'clZoomLabel')}>
        <button type="button" className={styles.zoomBtn} aria-pressed={focus == null} onClick={jumpToFit}>
          {t(locale, 'clZoomFit')}
        </button>
        <button type="button" className={styles.zoomBtn} onClick={jumpToTwoWeeks}>
          {t(locale, 'clZoomTwoWeeks')}
        </button>
        <button type="button" className={styles.zoomBtn} onClick={zoomOut} disabled={focus == null}
          aria-label={t(locale, 'clZoomOut')}>−</button>
        <button type="button" className={styles.zoomBtn} onClick={zoomIn} aria-label={t(locale, 'clZoomIn')}>+</button>
      </div>
      <div className={styles.scheduleScroll}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={styles.scheduleSvg} role="img"
        aria-label={t(locale, 'clSchedule')} data-pannable={focus != null}
        onMouseLeave={() => { setHoverMs(null); endPan(); onRowCard(null, null); }}
        onMouseDown={(e) => startPan(e.clientX)}
        onMouseMove={(e) => { if (drag.current) panBy(e.clientX); }}
        onMouseUp={endPan}>
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
            <VRule cx={b.cx} y0={TOP - 6} y1={vExtentBot} cut={captionCut}
              stroke="var(--border)" strokeWidth={1} strokeDasharray="2 3" />
            <path d={`M ${b.cx - 5} ${axisY + 3} l 4 -8 M ${b.cx - 1} ${axisY + 3} l 4 -8`}
              stroke="var(--muted)" strokeWidth={1.25} fill="none" />
            {/* the duration label wins its axis slot over month letters (kept-flag); clamped
                so a break near the right edge can't clip it off-canvas */}
            {keepBreak[i] && (
              <ChartLabel x={axisBreakLabelX[i]} y={axisY + 16} textAnchor="middle" fontSize={FS_AXIS} fill="var(--muted)">
                {t(locale, 'clAxisBreak', { d: b.days })}
              </ChartLabel>
            )}
          </g>
        ))}

        {/* today + SOP verticals span the grid (and the lane) — hidden when a zoom has
            scrolled their date out of the focus window (an edge-clamped line would lie). */}
        {inView(now) && (
          <>
            <VRule cx={x(now)} y0={TOP - 12} y1={vExtentBot} cut={captionCut}
              stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
            <ChartLabel x={x(now)} y={todayLabelY} textAnchor="middle" fontSize={FS_EMPH} fill="var(--muted)">
              {t(locale, 'clTodayLabel', { date: dayShort(now, locale) })}
            </ChartLabel>
          </>
        )}
        {sopMs != null && inView(sopMs) && (
          <>
            <VRule cx={x(sopMs)} y0={TOP - 12} y1={vExtentBot} cut={captionCut} stroke="var(--fg)" strokeWidth={1.5} />
            <ChartLabel x={Math.min(x(sopMs), W - 8)} y={TOP - 18} textAnchor="end" fontSize={FS_EMPH} fill="var(--fg)">
              {t(locale, 'clSopLabel', { month: monthLong(sopMs, locale) })}
            </ChartLabel>
          </>
        )}

        {/* month letters under the grid — only those that clear the break labels above */}
        <line x1={labelW} y1={axisY} x2={W - PAD_R} y2={axisY} stroke="var(--border)" strokeWidth={1} />
        {axisMonths.map((o, i) => (keepMonth[i] ? (
          <ChartLabel key={`ml${o.ms}`} x={o.cx} y={axisY + 16} textAnchor="middle" fontSize={FS_AXIS} fill="var(--muted)">
            {o.letter}
          </ChartLabel>
        ) : null))}

        {/* rows: label + constraint ring + Option A bars + plan tick + idle marker */}
        {rows.map((r, i) => {
          const y = rowY(i);
          const barTop = y - BAR_H / 2;
          const isConstraint = ledger.liveConstraintId === r.id;
          const bars = barsFor(r);
          const variance = placeVariance(r, y);
          const idle = placeIdle(r, i, y);
          return (
            <g key={r.id}>
              {isConstraint && <ConstraintRing cx={constraintCx} cy={y} r={2} />}
              {/* The LABEL is the JUMP target (issue #22). A transparent rect over the WHOLE
                  label column gives touch an adequate tap area — the ~12px glyphs alone are
                  well under the touch-target guidance (design.md §9) — while the visible name
                  carries the affordance. It is painted UNDER the text so the name keeps its own
                  :hover underline and click; both jump, so neither handler is dead. rowHit below
                  now starts AFTER labelW, so it no longer swallows these: the label's jump is
                  reachable on every device, mouse included (it was buried before). */}
              <rect className={styles.labelHit} x={0} y={y - ROW_H / 2} width={labelW} height={ROW_H}
                aria-hidden onClick={() => onJump(r.id)} />
              <ChartLabel x={isConstraint ? labelW - RING_PAD : labelW - TEXT_PAD} y={y + 4} textAnchor="end"
                fontSize={FS_ROW} fill="var(--fg)" className={styles.rowLabel} onClick={() => onJump(r.id)}>
                {r.name}
              </ChartLabel>

              {/* idle handoff, drawn TO THE DAY in the channel above this row (only when the
                  gap overlaps the focus window). The count rides the rule's own line and is
                  HALOED, so it knocks the dashes out behind itself rather than being struck
                  through by them — see placeIdle for why it is not stacked above the rule. */}
              {idle && (
                <>
                  <line x1={idle.x1} y1={idle.y} x2={idle.x2} y2={idle.y}
                    stroke="var(--warn)" strokeWidth={2} strokeDasharray="2 2" />
                  {/* the DEFAULT halo, not the flow's --surface one: the rows sit straight
                      on the page background (the section sets none), while the flow paints
                      its own surface frame. A halo in the wrong background token is a pale
                      rectangle around the word rather than a knockout. */}
                  <ChartLabel x={idle.x} y={centreToBaselineY(idle.y, FS_SMALL)} textAnchor="middle"
                    fontSize={FS_SMALL} fill="var(--warn)">
                    {idle.text}
                  </ChartLabel>
                </>
              )}

              {/* the bars: solid where the work happened, dashed outline where it is a claim */}
              {bars.map((b, bi) => {
                const stroke = BAR_STROKE[b.k];
                return (
                  <rect key={bi} x={b.x1} y={barTop} width={Math.max(0.75, b.x2 - b.x1)} height={BAR_H} rx={2}
                    fill={BAR_FILL[b.k]} fillOpacity={BAR_OPACITY[b.k]}
                    stroke={stroke ?? 'none'} strokeWidth={stroke ? 1.25 : 0}
                    strokeDasharray={stroke ? '2 1.5' : undefined} />
                );
              })}

              {/* plan tick — where the plan said this phase would end (day-accurate). It is
                  the datum every tail is measured FROM, so it is drawn over the bars. */}
              {r.kind !== 'notStarted' && inView(r.plannedEndMs) && (
                <line x1={x(r.plannedEndMs)} y1={barTop - 2} x2={x(r.plannedEndMs)} y2={barTop + BAR_H + 2}
                  stroke="var(--muted)" strokeWidth={1.25} />
              )}

              {/* the variance as a NUMBER beside the tail that already says it as a length —
                  the magnitude a length alone cannot be read off to the day (§4a's quiet
                  `+9d` / `−4d`). Haloed for the flipped case, where it sits over its own bar. */}
              {variance && (
                <ChartLabel x={variance.x} y={centreToBaselineY(variance.y, FS_SMALL)} textAnchor="middle"
                  fontSize={FS_SMALL} fill={variance.fill} data-testid={`chain-bar-variance-${r.id}`}>
                  {variance.text}
                </ChartLabel>
              )}

              {/* The row BODY reveals the status card — NEVER the jump (issue #22). It starts
                  at labelW, so it no longer covers the label (the jump target above); the plot
                  band answers to one hover and drives the shared date crosshair (#75). On MOUSE,
                  hover shows the card. On TOUCH there is no hover, so a tap's synthesized
                  mouseenter shows it AND the click reveals it too (idempotent — some engines skip
                  the enter on a second tap of the same row); crucially the click does NOT
                  navigate, so the card survives to be read and dismissed. KEYBOARD keeps two
                  DISTINCT actions: focus shows the card, Enter/Space jumps. */}
              <rect className={styles.rowHit} x={labelW} y={y - ROW_H / 2} width={W - labelW} height={ROW_H} rx={4}
                tabIndex={0} role="button" aria-label={r.name}
                onMouseEnter={(e) => { if (drag.current) return; onRowCard(r, e.currentTarget, e.clientX); trackPointer(e.clientX); }}
                onMouseMove={(e) => { if (drag.current) return; onRowCard(r, e.currentTarget, e.clientX); trackPointer(e.clientX); }}
                onMouseLeave={() => onRowCard(null, null)}
                onFocus={(e) => onRowCard(r, e.currentTarget)}
                onBlur={() => onRowCard(null, null)}
                onClick={(e) => { if (didPan.current) { didPan.current = false; return; } onRowCard(r, e.currentTarget, e.clientX); trackPointer(e.clientX); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump(r.id); } }}
                data-row-id={r.id} />
            </g>
          );
        })}

        {/* ---------- the two-tone buffer flow ---------- */}
        {flow && (
          <g data-testid="chain-buffer-flow">
            <rect x={labelW} y={flowTop} width={plotW} height={FLOW_H} rx={6}
              fill="var(--surface)" stroke="var(--border)" strokeWidth={1} />
            {/* title above the flow, leaving the left gutter free for the y-axis scale.
                Its box is `captionCut` above, which every full-height vertical cuts
                around — change one and the other follows, or the rules cut empty air. */}
            <ChartLabel x={labelW} y={flowTitleY} textAnchor="start" fontSize={FS_SMALL} fill="var(--muted)"
              data-testid="chain-flow-title">
              {t(locale, 'clFlowTitle')}
            </ChartLabel>
            {/* the derived scale. 0% and 100% are not scale, they are the two facts the
                chart is about — B₀ and the moment it runs out — so they carry weight the
                intermediate gridlines do not. */}
            {flow.scale.ticks.map((v) => (
              <line key={`ft${v}`} x1={labelW} y1={flow.yOf(v)} x2={W - PAD_R} y2={flow.yOf(v)}
                stroke="var(--border)" strokeWidth={GRIDLINE_W} opacity={v === 0 || v === 100 ? 1 : 0.4} />
            ))}
            {/* BUFFER SPENT rides above the boundary, BUFFER LEFT below it: the buffer as a
                tank that drains from the top. The forecast halves are the same two claims
                about days not yet spent, so they are the same two hues, lighter (decision 5). */}
            {flow.areas.spentPast && <path d={flow.areas.spentPast} fill="var(--bad)" fillOpacity={0.17} />}
            {flow.areas.spentAhead && <path d={flow.areas.spentAhead} fill="var(--bad)" fillOpacity={0.09} />}
            {flow.areas.leftPast && <path d={flow.areas.leftPast} fill="var(--ok)" fillOpacity={0.22} />}
            {flow.areas.leftAhead && <path d={flow.areas.leftAhead} fill="var(--ok)" fillOpacity={0.11} />}
            {/* below 0% the buffer is not low, it is GONE, and every further day is a day
                past the SOP — the one band that gets a second coat of the same ink */}
            {flow.areas.debtPast && <path d={flow.areas.debtPast} fill="var(--bad)" fillOpacity={0.3} />}
            {flow.areas.debtAhead && <path d={flow.areas.debtAhead} fill="var(--bad)" fillOpacity={0.18} />}
            {/* the boundary IS the reading: solid through today, dashed into the forecast */}
            {flow.boundaryPast && (
              <polyline points={flow.boundaryPast} fill="none" stroke="var(--fg)" strokeWidth={BOUNDARY_W} />
            )}
            {flow.boundaryAhead && (
              <polyline points={flow.boundaryAhead} fill="none" stroke="var(--fg)" strokeWidth={BOUNDARY_W}
                strokeDasharray="3 2" opacity={0.75} />
            )}
            {/* the 50%-of-remaining reserve, as a marker at the right edge rather than a
                rule across the chart: it is a value that only exists as of now */}
            {flow.showGuideline && (
              <line x1={W - PAD_R - GUIDELINE_STUB_W} y1={flow.yOf(flow.guidelinePct)} x2={W - PAD_R} y2={flow.yOf(flow.guidelinePct)}
                stroke="var(--muted)" strokeWidth={GUIDELINE_W} strokeDasharray="4 3" />
            )}
            {/* Every label below renders CENTRED on its own collision box, so what was
                placed and what is painted cannot drift apart — the class of bug where a
                de-collider reports clear and the screen shows otherwise. */}
            {flow.guidelineLabel && (
              <ChartLabel x={flow.guidelineLabel.x} y={centreToBaselineY(flow.guidelineLabel.y, FS_SMALL)}
                textAnchor="middle" fontSize={FS_SMALL} fill="var(--muted)" halo="var(--surface)">
                {flow.guidelineLabel.text}
              </ChartLabel>
            )}
            {/* the day the buffer ran out — usually in the forecast tail, which is why the
                tail is drawn at all */}
            {flow.blown && flow.blownLabel && (
              <>
                <line x1={x(flow.blown.ms)} y1={flow.yOf(0) - BLOWN_TICK_H} x2={x(flow.blown.ms)} y2={flow.yOf(0) + BLOWN_TICK_H}
                  stroke="var(--bad)" strokeWidth={BLOWN_TICK_W} />
                <ChartLabel x={flow.blownLabel.x} y={centreToBaselineY(flow.blownLabel.y, FS_SMALL)} textAnchor="middle"
                  fontSize={FS_SMALL} fill="var(--bad)" halo="var(--surface)">
                  {flow.blownLabel.text}
                </ChartLabel>
              </>
            )}
            {/* the scale's own values: plain percentages in the gutter, and below zero what
                that percentage means in days past the SOP */}
            {flow.axisTicks.map((tk) => (
              <ChartLabel key={`fl${tk.v}`} x={tk.x} y={centreToBaselineY(tk.y, FS_SMALL)} textAnchor="middle"
                fontSize={FS_SMALL} fill="var(--muted)">
                {tk.text}
              </ChartLabel>
            ))}
            {flow.debtLabels.map((tk, i) => (
              <ChartLabel key={`fd${i}`} x={tk.x} y={centreToBaselineY(tk.y, FS_SMALL)} textAnchor="middle"
                fontSize={FS_SMALL} fill="var(--bad)" halo="var(--surface)">
                {tk.text}
              </ChartLabel>
            ))}
            {/* the reading at today, one label in each band */}
            {inView(now) && (
              <>
                <circle cx={x(now)} cy={flow.yOf(flow.nowPt.leftPct)} r={3.2} fill="var(--fg)" />
                <ChartLabel x={flow.nowSpentLabel.x} y={centreToBaselineY(flow.nowSpentLabel.y, FS_SMALL)}
                  textAnchor="middle" fontSize={FS_SMALL} fill="var(--muted)" halo="var(--surface)">
                  {flow.nowSpentLabel.text}
                </ChartLabel>
                <ChartLabel x={flow.nowLeftLabel.x} y={centreToBaselineY(flow.nowLeftLabel.y, FS_EMPH)}
                  textAnchor="middle" fontSize={FS_EMPH} fill="var(--fg)" halo="var(--surface)">
                  {flow.nowLeftLabel.text}
                </ChartLabel>
              </>
            )}
            {/* transparent overlay so hovering the flow also drives the crosshair */}
            <rect x={labelW} y={flowTop} width={plotW} height={FLOW_H} fill="transparent"
              onMouseMove={(e) => trackPointer(e.clientX)} />
          </g>
        )}
        {/* An SOP with no buffer to divide: say so, rather than draw a share of nothing. */}
        {sopMs != null && series == null && (
          <ChartLabel x={labelW} y={noteY} textAnchor="start" fontSize={FS_SMALL} fill="var(--muted)">
            {t(locale, 'clFlowNoBase')}
          </ChartLabel>
        )}

        {/* shared date crosshair — one vertical line down the grid AND the lane, so the eye
            reads a single date across both (#75). Non-interactive, drawn on top. */}
        {crosshairX != null && (
          <g style={{ pointerEvents: 'none' }}>
            <VRule cx={crosshairX} y0={TOP - 8} y1={vExtentBot} cut={captionCut}
              stroke="var(--chain)" strokeWidth={1.25} opacity={0.85} />
            <ChartLabel x={crosshairX} y={crosshairDateY} textAnchor="middle"
              fontSize={FS_SMALL} fill="var(--chain-ink)">
              {dayShort(hoverMs!, locale)}
            </ChartLabel>
          </g>
        )}
      </svg>
      </div>
    </div>
  );
}

export { CARD_W, W };
