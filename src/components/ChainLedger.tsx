'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { t, Locale } from '../lib/i18n';
import { tNodes, joinNodes } from './tNodes';
import { localDate } from '../lib/dates';
import { DAY_MS } from '../lib/sop';
import AnchorHeading from './AnchorHeading';
import { isForecastOver } from '../lib/chainLedger';
import type { ChainLedgerResult, ResourceRef, ScheduleRow, Situation, WaterfallRow } from '../lib/chainLedger';
import styles from './ChainLedger.module.css';

// The Critical Chain section (docs/CRITICAL_CHAIN_VIEW_PLAN.md §4): headline fact +
// judgment sentence, the time-scaled Schedule with buffer-movement background bands,
// "Where the buffer went", and "Who is oversubscribed". Every string is a full
// sentence via lib/i18n; every number arrives precomputed in the ledger — this
// component ONLY renders structured facts (the deterministic layer is the product).

/** An active phase the program's owner is running in ANOTHER program. */
export interface OwnerOtherActive {
  projectId: number;
  projectName: string;
  phaseName: string;
}

interface ChainLedgerProps {
  projectId: number;
  locale: Locale;
  now: number; // server-provided so SSR and hydration agree
  ledger: ChainLedgerResult;
  sopDate: string | null;
  volumeFirstYear: number;
  owner: string | null; // the program's Googler owner
  ownerPersonId: number | null; // resolved so the mention can link
  ownerOtherActive: OwnerOtherActive[];
}

const jumpToPhase = (id: number) => window.dispatchEvent(new CustomEvent('autoknow:jump-phase', { detail: id }));

const monthLong = (iso: string, locale: Locale) => localDate(iso, locale, { month: 'long', year: 'numeric' });
const dayShort = (ms: number, locale: Locale) => localDate(new Date(ms), locale, { month: 'short', day: 'numeric' });

// ---- Schedule SVG geometry ----
// BOT stacks the bands under the last row, each clear of the one above: the
// buffer bracket + its label, the single-letter month row, then the quarter row.
const W = 860, PAD_R = 12, ROW_H = 36, TOP = 26, BOT = 76;
const BRACKET_LABEL_DY = 18, MONTH_LETTER_DY = 34, QUARTER_DY = 50;
// Label-column sizing: the gutter fits the LONGEST phase name instead of a fixed
// width, so short names don't donate a third of the chart to whitespace.
const RING_PAD = 24, TEXT_PAD = 10, CHAR_W = 5.9, WIDE_CHAR_W = 11;
// One hue per meaning (tokens in globals.css, both themes).
const BAND_FILL = {
  loss: 'var(--band-lost)',
  forecastLoss: 'var(--band-lost-forecast)',
  gain: 'var(--band-gained)',
  buffer: 'var(--band-buffer)',
} as const;
const textWidth = (s: string) =>
  [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? WIDE_CHAR_W : CHAR_W), 0);

function ScheduleChart({ ledger, sopMs, now, locale }: {
  ledger: ChainLedgerResult; sopMs: number | null; now: number; locale: Locale;
}) {
  const rows = ledger.schedule;
  if (rows.length === 0) return null;
  const H = TOP + rows.length * ROW_H + BOT;
  // constraint rows also carry the ring, so they need the wider pad
  const labelW = Math.min(220, Math.max(56, Math.ceil(Math.max(
    ...rows.map((r) => textWidth(r.name) + (ledger.liveConstraintId === r.id ? RING_PAD : TEXT_PAD)),
  ))));
  const tMin = Math.min(...rows.map((r) => r.startMs));
  const tMax = Math.max(sopMs ?? 0, ...rows.map((r) => r.endMs), now) + 7 * DAY_MS;
  const x = (ms: number) => labelW + ((ms - tMin) / (tMax - tMin)) * (W - labelW - PAD_R);
  const rowY = (i: number) => TOP + i * ROW_H + ROW_H / 2;

  // Graticule, three levels of granularity but ONE level of labelling: week and
  // month ticks sit on the axis (unlabelled — they give the eye a scale), while
  // quarters keep the full-height line and the only text.
  const axisY = TOP + rows.length * ROW_H + 8;
  const pxPerDay = (W - labelW - PAD_R) / ((tMax - tMin) / DAY_MS);
  const showWeeks = pxPerDay * 7 >= 4; // below this they'd read as a smear
  const showMonths = pxPerDay * 30 >= 8;

  const weeks: number[] = [];
  if (showWeeks) {
    const d = new Date(tMin);
    const dow = d.getUTCDay() || 7; // Sunday → 7, so weeks start Monday (ISO)
    let ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + ((8 - dow) % 7) * DAY_MS;
    for (let guard = 0; guard < 400 && ms <= tMax; guard++, ms += 7 * DAY_MS) weeks.push(ms);
  }

  // Single-letter month labels come from the locale (Intl 'narrow': J F M … in
  // en/de, 1 2 3 … in ja/ko). UTC-pinned so SSR and hydration agree.
  const monthNarrow = new Intl.DateTimeFormat(locale, { month: 'narrow', timeZone: 'UTC' });
  const months: { ms: number; next: number; isQuarter: boolean; label: string; letter: string; onAxis: boolean }[] = [];
  {
    const first = new Date(tMin);
    let my = first.getUTCFullYear();
    let mm = first.getUTCMonth(); // starts on the month CONTAINING tMin, so the
    for (let guard = 0; guard < 160; guard++) { // partial first month still gets a letter
      const ms = Date.UTC(my, mm, 1);
      if (ms > tMax) break;
      months.push({
        ms,
        next: Date.UTC(mm === 11 ? my + 1 : my, (mm + 1) % 12, 1),
        isQuarter: mm % 3 === 0,
        label: `Q${Math.floor(mm / 3) + 1} ’${String(my).slice(2)}`,
        letter: monthNarrow.format(new Date(ms)),
        onAxis: ms >= tMin, // a tick before tMin would render left of the axis
      });
      mm += 1;
      if (mm > 11) { mm = 0; my += 1; }
    }
  }
  const quarters = months.filter((m) => m.isQuarter && m.onAxis);
  const showMonthLetters = pxPerDay * 30 >= 12;

  // Buffer-movement background bands (§4a). Four meanings, four HUES — spent loss
  // (red) and forecast loss (amber) were previously one hue at two opacities and
  // could not be told apart; "days gained" (green) and "room still in hand"
  // (teal) likewise shared a colour.
  const bands: { x1: number; x2: number; kind: 'loss' | 'forecastLoss' | 'gain' | 'buffer' }[] = [];
  rows.forEach((r, i) => {
    if (r.gapBeforeDays >= 1 && i > 0) bands.push({ x1: rows[i - 1].endMs, x2: r.startMs, kind: 'loss' });
    if (r.kind === 'done' && r.varianceDays >= 1) bands.push({ x1: r.plannedEndMs, x2: r.endMs, kind: 'loss' });
    if (r.kind === 'done' && r.varianceDays <= -1) bands.push({ x1: r.endMs, x2: r.plannedEndMs, kind: 'gain' });
    if (isForecastOver(r)) bands.push({ x1: r.plannedEndMs, x2: r.endMs, kind: 'forecastLoss' });
    if (r.kind === 'active' && r.varianceDays <= -1) bands.push({ x1: r.endMs, x2: r.plannedEndMs, kind: 'gain' });
  });
  const lastEnd = rows[rows.length - 1].endMs;
  if (sopMs != null) bands.push(sopMs >= lastEnd
    ? { x1: lastEnd, x2: sopMs, kind: 'buffer' }
    : { x1: sopMs, x2: lastEnd, kind: 'loss' });

  const barLabel = (r: ScheduleRow): { text: string; bad: boolean } | null => {
    if (r.kind === 'done' && r.varianceDays <= -1) {
      const d = -r.varianceDays;
      return { text: t(locale, d === 1 ? 'clOneDayEarly' : 'clDaysEarly', { d }), bad: false };
    }
    if (r.kind === 'done' && r.varianceDays >= 1) {
      const d = r.varianceDays;
      return { text: t(locale, d === 1 ? 'clOneDayOverPlan' : 'clDaysOverPlan', { d }), bad: true };
    }
    if (r.kind === 'active') {
      const one = r.remainingDays === 1;
      return isForecastOver(r)
        ? { text: t(locale, one ? 'clWorkLeftOverOne' : 'clWorkLeftOver', { d: r.remainingDays, o: r.varianceDays }), bad: true }
        : { text: t(locale, one ? 'clWorkLeftOnPaceOne' : 'clWorkLeftOnPace', { d: r.remainingDays }), bad: false };
    }
    return null;
  };

  return (
    <div className={styles.chartwrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.scheduleSvg} role="img" aria-label={t(locale, 'clSchedule')}>
        {bands.map((b, i) => (
          <rect key={`band${i}`} x={x(b.x1)} y={TOP - 8} width={Math.max(1.5, x(b.x2) - x(b.x1))} height={rows.length * ROW_H + 16}
            fill={BAND_FILL[b.kind]} />
        ))}
        {/* graticule: week ticks (finest), month ticks, quarter lines + labels */}
        {weeks.map((ms) => (
          <line key={`w${ms}`} x1={x(ms)} y1={axisY - 3} x2={x(ms)} y2={axisY}
            stroke="var(--border)" strokeWidth={1} opacity={0.55} />
        ))}
        {showMonths && months.filter((m) => m.onAxis && !m.isQuarter).map((m) => (
          <line key={`m${m.ms}`} x1={x(m.ms)} y1={axisY - 7} x2={x(m.ms)} y2={axisY}
            stroke="var(--border)" strokeWidth={1} />
        ))}
        <line x1={labelW} y1={axisY} x2={W - PAD_R} y2={axisY} stroke="var(--border)" strokeWidth={1} />
        {/* one locale-narrow letter per month, centred in the month's visible span */}
        {showMonthLetters && months.map((m) => {
          const from = Math.max(m.ms, tMin);
          const to = Math.min(m.next, tMax);
          // ja/ko narrow months are "4月"/"10月", not one glyph — measure the real
          // label so a tight span drops it instead of overlapping its neighbour.
          if (x(to) - x(from) < Math.max(9, textWidth(m.letter) * (9 / 11) + 3)) return null;
          return (
            <text key={`ml${m.ms}`} x={(x(from) + x(to)) / 2} y={axisY + MONTH_LETTER_DY}
              textAnchor="middle" fontSize={9} fill="var(--muted)">
              {m.letter}
            </text>
          );
        })}
        {quarters.map((q) => (
          <g key={q.ms}>
            <line x1={x(q.ms)} y1={TOP - 8} x2={x(q.ms)} y2={axisY} stroke="var(--border)" strokeWidth={1} />
            <text x={x(q.ms)} y={axisY + QUARTER_DY} textAnchor="middle" fontSize={10} fill="var(--muted)">{q.label}</text>
          </g>
        ))}

        <line x1={x(now)} y1={TOP - 12} x2={x(now)} y2={TOP + rows.length * ROW_H + 8} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
        <text x={x(now)} y={TOP - 16} textAnchor="middle" fontSize={10} fill="var(--muted)">
          {t(locale, 'clTodayLabel', { date: dayShort(now, locale) })}
        </text>

        {sopMs != null && (
          <g>
            <line x1={x(sopMs)} y1={TOP - 12} x2={x(sopMs)} y2={TOP + rows.length * ROW_H + 8} stroke="var(--fg)" strokeWidth={1.5} />
            <text x={Math.min(x(sopMs), W - 8)} y={TOP - 16} textAnchor="end" fontSize={11} fill="var(--fg)">
              {t(locale, 'clSopLabel', { month: monthLong(new Date(sopMs).toISOString(), locale) })}
            </text>
          </g>
        )}

        {rows.map((r, i) => {
          const y = rowY(i);
          const label = barLabel(r);
          const isConstraint = ledger.liveConstraintId === r.id;
          return (
            <g key={r.id}>
              {isConstraint && <circle cx={labelW - 12} cy={y} r={6} fill="none" stroke="var(--chain)" strokeWidth={2} />}
              <text x={isConstraint ? labelW - RING_PAD : labelW - TEXT_PAD} y={y + 3.5} textAnchor="end" fontSize={11} fill="var(--fg)"
                className={styles.rowLabel} onClick={() => jumpToPhase(r.id)}>
                {r.name}
              </text>
              {r.kind === 'done' && (
                <rect x={x(r.startMs)} y={y - 4.5} width={Math.max(2, x(r.endMs) - x(r.startMs))} height={9} rx={2} fill="var(--fg)" />
              )}
              {r.kind === 'active' && (
                <>
                  <rect x={x(r.startMs)} y={y - 4.5} width={Math.max(2, x(now) - x(r.startMs))} height={9} rx={2} fill="var(--fg)" />
                  <rect x={x(now)} y={y - 4.5} width={Math.max(2, x(r.endMs) - x(now))} height={9} rx={2}
                    fill="none" stroke="var(--fg)" strokeWidth={1.25} />
                </>
              )}
              {r.kind === 'notStarted' && (
                <rect x={x(r.startMs)} y={y - 4.5} width={Math.max(2, x(r.endMs) - x(r.startMs))} height={9} rx={2}
                  fill="none" stroke="var(--fg)" strokeWidth={1.25} />
              )}
              {r.kind !== 'notStarted' && (
                <line x1={x(r.plannedEndMs)} y1={y - 8.5} x2={x(r.plannedEndMs)} y2={y + 8.5} stroke="var(--muted)" strokeWidth={1.5} />
              )}
              {r.gapBeforeDays >= 1 && i > 0 && (
                <text x={x(rows[i - 1].endMs)} y={y - 10} fontSize={10} fill="var(--bad)">
                  {t(locale, 'clSatIdle', { d: r.gapBeforeDays })}
                </text>
              )}
              {label && (() => {
                // Beside the bar when it fits; otherwise under it (starting at the
                // bar's own left edge, always clear) — never clipped off-canvas.
                const right = x(Math.max(r.endMs, r.plannedEndMs)) + 8;
                const fits = right + textWidth(label.text) * (10 / 11) <= W - 4;
                return (
                  <text x={fits ? right : x(r.startMs)} y={fits ? y + 3.5 : y + 15} fontSize={10}
                    fill={label.bad ? 'var(--bad)' : 'var(--muted)'}>
                    {label.text}
                  </text>
                );
              })()}
            </g>
          );
        })}

        {sopMs != null && ledger.bufferDays != null && ledger.bufferDays > 0 && (
          <g>
            <path d={`M ${x(lastEnd)} ${TOP + rows.length * ROW_H + 4} L ${x(lastEnd)} ${TOP + rows.length * ROW_H + 8} L ${x(sopMs)} ${TOP + rows.length * ROW_H + 8} L ${x(sopMs)} ${TOP + rows.length * ROW_H + 4}`}
              fill="none" stroke="var(--ok)" strokeWidth={1.5} />
            <text x={(x(lastEnd) + x(sopMs)) / 2} y={axisY + BRACKET_LABEL_DY} textAnchor="middle" fontSize={10} fill="var(--ok)">
              {t(locale, 'clDaysOfRoom', { d: ledger.bufferDays })}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function ChainLedger({
  projectId, locale, now, ledger, sopDate, volumeFirstYear, owner, ownerPersonId, ownerOtherActive,
}: ChainLedgerProps) {
  const legendRef = useRef<HTMLDialogElement>(null);
  const sopMs = sopDate ? +new Date(sopDate) : null;
  const nameOf = (id: number) => ledger.schedule.find((r) => r.id === id)?.name ?? `#${id}`;
  const remTotal = ledger.schedule.reduce((s, r) => s + r.remainingDays, 0);

  // Every entity MENTION is a link (design.md §2): phases jump to their rail row
  // (a button — anchors would collide with the rail's links), programs/partners/
  // people navigate to their pages.
  const phaseBtn = (id: number) => (
    <button type="button" className={styles.phaseLink} onClick={() => jumpToPhase(id)}>{nameOf(id)}</button>
  );
  const progLink = (id: number, name: string) => (
    <Link href={`/programs/${id}`} className={styles.entityLink}>{name}</Link>
  );
  const resLink = (r: ResourceRef) => (
    <Link href={r.kind === 'partner' ? `/partners/${r.id}` : `/people/${r.id}`} className={styles.entityLink}>{r.name}</Link>
  );

  // ---- headline: ONE sentence — buffer, estimated end date, SOP. The history
  // (started with / used / who took it) lives in Where the buffer went. ----
  let headline: string | null = null;
  if (sopMs != null && ledger.bufferDays != null && ledger.projectedFinishMs != null) {
    const month = monthLong(sopDate!, locale);
    const date = localDate(new Date(ledger.projectedFinishMs), locale, { month: 'long', day: 'numeric', year: 'numeric' });
    headline = ledger.bufferDays >= 0
      ? t(locale, 'clBufferHeadline', { d: ledger.bufferDays, date, month })
      : t(locale, 'clOvershootHeadline', { d: -ledger.bufferDays, date, month });
  }

  // ---- next steps: ONE list (2026-07-20 user call). The resource-contention
  // sentences ARE the recommendations — they used to be summarized tersely here
  // and again, more fully, in a separate Resource Constraints block. The fuller
  // form won; the owner's cross-program load moved in from the phase rail so
  // every schedule/contention recommendation reads in one place. ----
  const oversub = ledger.situations.filter((s): s is Extract<Situation, { type: 'oversubscribed' }> => s.type === 'oversubscribed');
  const upNext = ledger.situations.find((s): s is Extract<Situation, { type: 'upcomingHandoff' }> => s.type === 'upcomingHandoff');
  const overshoot = ledger.situations.find((s): s is Extract<Situation, { type: 'sopOvershoot' }> => s.type === 'sopOvershoot');

  const nextSteps: React.ReactNode[] = [];

  // who the chain is waiting on, and whose slack can move. When the NEXT phase is
  // also the oversubscribed one, its staffing clause rides on this bullet rather
  // than repeating the same person-and-phase as a second bullet.
  const upNextCoveredHere = upNext != null && oversub.some((o) => o.phaseId === upNext.toId);
  // Only a phase that is actually past its plan can be called overrunning.
  const overrunning = new Set(
    ledger.situations
      .filter((s) => s.type === 'sunkOverrun' || s.type === 'forecastOverrun')
      .map((s) => (s as Extract<Situation, { type: 'forecastOverrun' }>).phaseId),
  );
  for (const o of oversub) {
    const carriesUpNext = upNext != null && upNextCoveredHere && o.phaseId === upNext.toId;
    const n = o.moves.length + o.tight.length;
    const openerKey = overrunning.has(o.phaseId)
      ? (n === 1 ? 'clOversubOverrunOne' : 'clOversubOverrun')
      : (n === 1 ? 'clOversubNeutralOne' : 'clOversubNeutral');
    const nameLink = resLink({ kind: o.kind, id: o.resourceId, name: o.name });
    nextSteps.push(
      <>
        {tNodes(locale, openerKey, { phase: phaseBtn(o.phaseId), name: nameLink, n })}
        {o.moves.length > 0 && (
          <>
            {' '}
            {tNodes(locale, 'clOversubMoves', {
              phase: phaseBtn(o.phaseId),
              name: resLink({ kind: o.kind, id: o.resourceId, name: o.name }),
              programs: joinNodes(o.moves.map((m) =>
                tNodes(locale, 'clProgWithBuffer', { name: progLink(m.programId, m.programName), d: m.bufferDays ?? 0 }))),
            })}
          </>
        )}
        {o.tight.length > 0 && (
          <>
            {' '}
            {tNodes(locale, 'clOversubTight', {
              programs: joinNodes(o.tight.map((m) => progLink(m.programId, m.programName))),
            })}
          </>
        )}
        {carriesUpNext && (
          <>
            {' '}
            {tNodes(locale, 'clUpNextConfirm', { current: phaseBtn(upNext!.fromId) })}
          </>
        )}
      </>,
    );
  }

  // the next phase's staffing — the handoff worth agreeing before it starts
  if (upNext && !upNextCoveredHere && upNext.contended.length > 0) {
    nextSteps.push(
      <>
        {tNodes(locale, 'clUpNextLine', {
          phase: phaseBtn(upNext.toId),
          names: joinNodes(upNext.contended.map((c) => resLink(c))),
          n: Math.max(...upNext.contended.map((c) => c.n)),
        })}{' '}
        {tNodes(locale, 'clUpNextConfirm', { current: phaseBtn(upNext.fromId) })}
      </>,
    );
  } else if (upNext && !upNextCoveredHere && ledger.register !== 'none') {
    nextSteps.push(tNodes(locale, 'clLeverHandoff', { from: phaseBtn(upNext.fromId), to: phaseBtn(upNext.toId) }));
  }

  // the program owner's load elsewhere — a flag, not a proven constraint
  if (owner && ownerOtherActive.length > 0) {
    const byProgram = new Map<number, { name: string; phases: string[] }>();
    for (const o of ownerOtherActive) {
      const g = byProgram.get(o.projectId) ?? { name: o.projectName, phases: [] };
      g.phases.push(o.phaseName);
      byProgram.set(o.projectId, g);
    }
    const items = joinNodes(
      [...byProgram.entries()].map(([pid, g]) => (
        <>
          {progLink(pid, g.name)}
          {` (${g.phases.join(', ')})`}
        </>
      )),
      '; ',
    );
    nextSteps.push(tNodes(locale, ownerOtherActive.length === 1 ? 'clOwnerLoadOne' : 'clOwnerLoad', {
      owner: ownerPersonId != null
        ? <Link href={`/people/${ownerPersonId}`} className={styles.entityLink}>{owner}</Link>
        : owner,
      n: ownerOtherActive.length,
      items,
    }));
  }

  // the escalation, when the SOP is already overshot
  if (overshoot) {
    nextSteps.push(
      <>
        <button type="button" className={styles.declareBtn}
          onClick={() => document.getElementById('program-status')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          {t(locale, 'clLeverDeclare', { month: monthLong(`${overshoot.proposedSopMonth}-01`, locale) })}
        </button>
        {overshoot.unitsDelayed != null && (
          <>
            {' — '}
            {t(locale, 'clUnitsDelayed', {
              units: overshoot.unitsDelayed.toLocaleString(locale), volume: volumeFirstYear.toLocaleString(locale),
            })}
          </>
        )}
      </>,
    );
  }

  // ---- waterfall rows, losses first by size, unattributed last ----
  const wfRows = [...ledger.waterfall].sort((a, b) => {
    if (a.kind === 'unattributed') return 1;
    if (b.kind === 'unattributed') return -1;
    return Number(a.gain) - Number(b.gain) || b.days - a.days;
  });
  const evidence = (w: WaterfallRow): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    if ((w.kind === 'overrun' || w.kind === 'underrun') && w.phaseId != null) {
      const r = ledger.schedule.find((x) => x.id === w.phaseId)!;
      const planned = Math.round((r.plannedEndMs - r.startMs) / DAY_MS);
      out.push(t(locale, 'clEvidencePlanTook', {
        p: planned, a: Math.round((r.endMs - r.startMs) / DAY_MS),
        from: dayShort(r.startMs, locale), to: dayShort(r.endMs, locale),
      }));
      if (w.kind === 'overrun') {
        const sunk = ledger.situations.find((s) => s.type === 'sunkOverrun' && s.phaseId === w.phaseId);
        if (sunk && sunk.type === 'sunkOverrun' && sunk.contended.length > 0) {
          out.push(tNodes(locale, 'clEvidenceContended', { names: joinNodes(sunk.contended.map(resLink)) }));
        }
        out.push(t(locale, 'clEvidenceSunk'));
      }
    }
    if (w.kind === 'gap' && w.fromId != null && w.toId != null) {
      const from = ledger.schedule.find((x) => x.id === w.fromId)!;
      const to = ledger.schedule.find((x) => x.id === w.toId)!;
      out.push(to.kind === 'notStarted'
        ? tNodes(locale, 'clEvidenceGapOngoing', { from: phaseBtn(from.id), d1: dayShort(from.endMs, locale) })
        : tNodes(locale, 'clEvidenceGap', {
            from: phaseBtn(from.id), to: phaseBtn(to.id),
            d1: dayShort(from.endMs, locale), d2: dayShort(to.startMs, locale),
          }));
      out.push(t(locale, 'clEvidenceGapAvoid'));
    }
    if (w.kind === 'forecast' && w.phaseId != null) {
      const r = ledger.schedule.find((x) => x.id === w.phaseId)!;
      out.push(t(locale, 'clEvidenceForecast', {
        e: Math.round((now - r.startMs) / DAY_MS), r: r.remainingDays,
        p: Math.round((r.plannedEndMs - r.startMs) / DAY_MS),
      }));
    }
    if (w.kind === 'unattributed') out.push(t(locale, 'clEvidenceUnattributed'));
    return out;
  };

  return (
    <section className={styles.wrapper} data-testid="chain-ledger">
      <AnchorHeading
        id="critical-chain"
        linkLabel={t(locale, 'anchorLink')}
        actions={
          /* the key lives behind the ⓘ, not on the page (design.md §7) — same
             pattern as the Phases decoder */
          <button type="button" className={styles.infoBtn} title={t(locale, 'clKeyTitle')}
            aria-label={t(locale, 'clKeyTitle')} onClick={() => legendRef.current?.showModal()}>
            <svg viewBox="0 0 16 16" width={15} height={15} aria-hidden>
              <circle cx={8} cy={8} r={6.6} fill="none" stroke="currentColor" strokeWidth={1.4} />
              <circle cx={8} cy={5} r={1} fill="currentColor" />
              <line x1={8} y1={7.4} x2={8} y2={11.2} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
            </svg>
          </button>
        }
      >
        {t(locale, 'criticalChain')}
      </AnchorHeading>

      {sopMs == null || ledger.bufferDays == null ? (
        <p className={styles.headline}>{t(locale, 'clNoSop')}</p>
      ) : (
        <p className={styles.headline}
          title={t(locale, 'clGuidelineTitle', { b: ledger.bufferDays, rem: remTotal, g: ledger.guidelineDays })}>
          {headline}
        </p>
      )}

      <ScheduleChart ledger={ledger} sopMs={sopMs} now={now} locale={locale} />

      {/* Next steps read AFTER the picture they follow from (2026-07-20 user call). */}
      {sopMs != null && ledger.bufferDays != null && (
        <div className={styles.steps}>
          <p className={styles.judgment}>
            <strong className={ledger.register === 'act' ? styles.act : undefined}>
              {t(locale, ledger.register === 'act' ? 'clJudgeAct' : ledger.register === 'plan' ? 'clJudgePlan' : 'clJudgeNone')}
            </strong>
          </p>
          {nextSteps.length > 0 && (
            <ul className={styles.stepList}>
              {nextSteps.map((step, i) => <li key={i} className={styles.step}>{step}</li>)}
            </ul>
          )}
        </div>
      )}

      {ledger.rebaselineSuggested && (
        <p className={styles.rebaseline}>
          {t(locale, 'clRebaseline')}{' '}
          <Link href={`/programs/${projectId}/phases`}>{t(locale, 'editPhases')}</Link>
        </p>
      )}

      {/* the schedule key, consulted on demand */}
      <dialog ref={legendRef} className={styles.legendDialog}
        onClick={(e) => { if (e.target === legendRef.current) legendRef.current?.close(); }}>
        <h3 className={styles.legendTitle}>{t(locale, 'clKeyTitle')}</h3>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={1} y={4.5} width={20} height={5} rx={2} fill="var(--fg)" />
          </svg>
          {t(locale, 'clKeySolid')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={1.5} y={5} width={19} height={4} rx={2} fill="none" stroke="var(--fg)" strokeWidth={1.25} />
          </svg>
          {t(locale, 'clKeyOutline')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={1} y={4.5} width={13} height={5} rx={2} fill="var(--fg)" />
            <line x1={17} y1={1.5} x2={17} y2={12.5} stroke="var(--muted)" strokeWidth={1.5} />
          </svg>
          {t(locale, 'clKeyTick')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <circle cx={11} cy={7} r={5.5} fill="none" stroke="var(--chain)" strokeWidth={1.8} />
          </svg>
          {t(locale, 'clKeyRing')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={1} y={1} width={20} height={12} fill={BAND_FILL.loss} />
          </svg>
          {t(locale, 'clKeyRed')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={1} y={1} width={20} height={12} fill={BAND_FILL.forecastLoss} />
          </svg>
          {t(locale, 'clKeyAmber')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={1} y={1} width={20} height={12} fill={BAND_FILL.gain} />
          </svg>
          {t(locale, 'clKeyGreen')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={1} y={1} width={20} height={12} fill={BAND_FILL.buffer} />
          </svg>
          {t(locale, 'clKeyTeal')}
        </div>
      </dialog>

      {wfRows.length > 0 && (
        <div className={styles.block}>
          <h3 className={styles.subtitle}>{t(locale, 'clWhereBufferWent')}</h3>
          <div className={styles.wf}>
            {wfRows.map((w, i) => (
              <React.Fragment key={i}>
                <span className={w.kind === 'unattributed' ? styles.muted : undefined}>
                  {w.kind === 'gap' ? tNodes(locale, 'clIdleBefore', { phase: phaseBtn(w.toId!) })
                    : w.kind === 'unattributed' ? t(locale, 'clUnattributed')
                    : (
                      // a BUTTON, not an anchor: it jumps to the rail row (an action),
                      // and anchors here would collide with the rail's phase links
                      // in strict-mode selectors.
                      <button type="button" className={styles.phaseLink} onClick={() => jumpToPhase(w.phaseId!)}>
                        {nameOf(w.phaseId!)}
                      </button>
                    )}
                </span>
                <span>
                  <span className={`${styles.bar} ${w.gain ? styles.barGain : styles.barLoss} ${w.kind === 'unattributed' ? styles.barFaint : ''}`}
                    style={{ width: `${Math.min(12, Math.max(0.5, w.days * 0.55))}rem` }} />
                </span>
                <span className={`${styles.num} ${w.gain ? styles.gainText : styles.lossText}`}>
                  {w.days === 1
                    ? t(locale, w.gain ? 'clGaveBackOneDay' : 'clCostOneDay')
                    : t(locale, w.gain ? 'clGaveBackDays' : 'clCostDays', { d: w.days })}
                </span>
                <span className={styles.evidence}>{joinNodes(evidence(w), ' · ')}</span>
              </React.Fragment>
            ))}
          </div>
          {ledger.usedDays != null && ledger.startBufferDays != null && (
            <p className={styles.net}>
              {ledger.usedDays >= 0
                ? t(locale, 'clNetUsed', { used: ledger.usedDays, b0: ledger.startBufferDays })
                : t(locale, 'clNetGained', { g: -ledger.usedDays, b0: ledger.startBufferDays })}
            </p>
          )}
        </div>
      )}

    </section>
  );
}
