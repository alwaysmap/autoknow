'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { t, Locale } from '../lib/i18n';
import { localDate } from '../lib/dates';
import { DAY_MS } from '../lib/sop';
import type { ChainLedgerResult, ScheduleRow, Situation, WaterfallRow } from '../lib/chainLedger';
import styles from './ChainLedger.module.css';

// The Critical Chain section (docs/CRITICAL_CHAIN_VIEW_PLAN.md §4): headline fact +
// judgment sentence, the time-scaled Schedule with buffer-movement background bands,
// "Where the buffer went", and "Who is oversubscribed". Every string is a full
// sentence via lib/i18n; every number arrives precomputed in the ledger — this
// component ONLY renders structured facts (the deterministic layer is the product).

interface ChainLedgerProps {
  projectId: number;
  locale: Locale;
  now: number; // server-provided so SSR and hydration agree
  ledger: ChainLedgerResult;
  sopDate: string | null;
  volumeFirstYear: number;
}

const jumpToPhase = (id: number) => window.dispatchEvent(new CustomEvent('autoknow:jump-phase', { detail: id }));

const monthLong = (iso: string, locale: Locale) => localDate(iso, locale, { month: 'long', year: 'numeric' });
const dayShort = (ms: number, locale: Locale) => localDate(new Date(ms), locale, { month: 'short', day: 'numeric' });

// ---- Schedule SVG geometry ----
const W = 860, LABEL_W = 180, PAD_R = 16, ROW_H = 36, TOP = 26, BOT = 44;

function ScheduleChart({ ledger, sopMs, now, locale }: {
  ledger: ChainLedgerResult; sopMs: number | null; now: number; locale: Locale;
}) {
  const rows = ledger.schedule;
  if (rows.length === 0) return null;
  const H = TOP + rows.length * ROW_H + BOT;
  const tMin = Math.min(...rows.map((r) => r.startMs));
  const tMax = Math.max(sopMs ?? 0, ...rows.map((r) => r.endMs), now) + 14 * DAY_MS;
  const x = (ms: number) => LABEL_W + ((ms - tMin) / (tMax - tMin)) * (W - LABEL_W - PAD_R);
  const rowY = (i: number) => TOP + i * ROW_H + ROW_H / 2;

  // Quarter gridlines across the visible range.
  const quarters: { ms: number; label: string }[] = [];
  const first = new Date(tMin);
  let qy = first.getUTCFullYear();
  let qm = Math.floor(first.getUTCMonth() / 3) * 3;
  for (let guard = 0; guard < 40; guard++) {
    const ms = Date.UTC(qy, qm, 1);
    if (ms > tMax) break;
    if (ms >= tMin) quarters.push({ ms, label: `Q${qm / 3 + 1} ’${String(qy).slice(2)}` });
    qm += 3;
    if (qm >= 12) { qm = 0; qy += 1; }
  }

  // Buffer-movement background bands (§4a): red = days lost, paler red = forecast
  // loss not yet spent, green = days gained + the buffer still in hand.
  const bands: { x1: number; x2: number; kind: 'loss' | 'forecastLoss' | 'gain' }[] = [];
  rows.forEach((r, i) => {
    if (r.gapBeforeDays >= 1 && i > 0) bands.push({ x1: rows[i - 1].endMs, x2: r.startMs, kind: 'loss' });
    if (r.kind === 'done' && r.varianceDays >= 1) bands.push({ x1: r.plannedEndMs, x2: r.endMs, kind: 'loss' });
    if (r.kind === 'done' && r.varianceDays <= -1) bands.push({ x1: r.endMs, x2: r.plannedEndMs, kind: 'gain' });
    if (r.kind === 'active' && r.varianceDays >= 1) bands.push({ x1: r.plannedEndMs, x2: r.endMs, kind: 'forecastLoss' });
    if (r.kind === 'active' && r.varianceDays <= -1) bands.push({ x1: r.endMs, x2: r.plannedEndMs, kind: 'gain' });
  });
  const lastEnd = rows[rows.length - 1].endMs;
  if (sopMs != null) bands.push(sopMs >= lastEnd
    ? { x1: lastEnd, x2: sopMs, kind: 'gain' }
    : { x1: sopMs, x2: lastEnd, kind: 'loss' });

  const barLabel = (r: ScheduleRow): { text: string; bad: boolean } | null => {
    if (r.kind === 'done' && r.varianceDays <= -1) return { text: t(locale, 'clDaysEarly', { d: -r.varianceDays }), bad: false };
    if (r.kind === 'done' && r.varianceDays >= 1) return { text: t(locale, 'clDaysOverPlan', { d: r.varianceDays }), bad: true };
    if (r.kind === 'active') {
      return r.varianceDays >= 1
        ? { text: t(locale, 'clWorkLeftOver', { d: r.remainingDays, o: r.varianceDays }), bad: true }
        : { text: t(locale, 'clWorkLeftOnPace', { d: r.remainingDays }), bad: false };
    }
    return null;
  };

  return (
    <div className={styles.chartwrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.scheduleSvg} role="img" aria-label={t(locale, 'clSchedule')}>
        {bands.map((b, i) => (
          <rect key={`band${i}`} x={x(b.x1)} y={TOP - 8} width={Math.max(1.5, x(b.x2) - x(b.x1))} height={rows.length * ROW_H + 16}
            fill={b.kind === 'gain' ? 'var(--ok-soft)' : 'var(--bad-soft)'} opacity={b.kind === 'forecastLoss' ? 0.55 : 1} />
        ))}
        {quarters.map((q) => (
          <g key={q.ms}>
            <line x1={x(q.ms)} y1={TOP - 8} x2={x(q.ms)} y2={TOP + rows.length * ROW_H + 8} stroke="var(--border)" strokeWidth={1} />
            <text x={x(q.ms)} y={H - 22} textAnchor="middle" fontSize={10} fill="var(--muted)">{q.label}</text>
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
              {isConstraint && <circle cx={LABEL_W - 12} cy={y} r={6} fill="none" stroke="var(--chain)" strokeWidth={2} />}
              <text x={isConstraint ? LABEL_W - 24 : LABEL_W - 10} y={y + 3.5} textAnchor="end" fontSize={11} fill="var(--fg)"
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
              {label && (
                <text x={Math.min(x(Math.max(r.endMs, r.plannedEndMs)) + 8, W - 4)} y={y + 3.5} fontSize={10}
                  fill={label.bad ? 'var(--bad)' : 'var(--muted)'}>
                  {label.text}
                </text>
              )}
            </g>
          );
        })}

        {sopMs != null && ledger.bufferDays != null && ledger.bufferDays > 0 && (
          <g>
            <path d={`M ${x(lastEnd)} ${TOP + rows.length * ROW_H + 4} L ${x(lastEnd)} ${TOP + rows.length * ROW_H + 8} L ${x(sopMs)} ${TOP + rows.length * ROW_H + 8} L ${x(sopMs)} ${TOP + rows.length * ROW_H + 4}`}
              fill="none" stroke="var(--ok)" strokeWidth={1.5} />
            <text x={(x(lastEnd) + x(sopMs)) / 2} y={TOP + rows.length * ROW_H + 20} textAnchor="middle" fontSize={10} fill="var(--ok)">
              {t(locale, 'clDaysOfRoom', { d: ledger.bufferDays })}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function ChainLedger({ projectId, locale, now, ledger, sopDate, volumeFirstYear }: ChainLedgerProps) {
  const legendRef = useRef<HTMLDialogElement>(null);
  const sopMs = sopDate ? +new Date(sopDate) : null;
  const nameOf = (id: number) => ledger.schedule.find((r) => r.id === id)?.name ?? `#${id}`;
  const remTotal = ledger.schedule.reduce((s, r) => s + r.remainingDays, 0);

  // ---- headline: the fact, then its history ----
  const headlineParts: string[] = [];
  if (sopMs != null && ledger.bufferDays != null) {
    const month = monthLong(sopDate!, locale);
    headlineParts.push(
      ledger.bufferDays >= 0
        ? t(locale, 'clBufferHeadline', { d: ledger.bufferDays, month })
        : t(locale, 'clOvershootHeadline', { d: -ledger.bufferDays, month }),
    );
    if (ledger.startBufferDays != null && ledger.usedDays != null && ledger.usedDays !== 0) {
      headlineParts.push(
        ledger.usedDays > 0
          ? t(locale, 'clStartedWith', { b0: ledger.startBufferDays, used: ledger.usedDays })
          : t(locale, 'clGainedSince', { b0: ledger.startBufferDays, g: -ledger.usedDays }),
      );
      const losses = ledger.waterfall
        .filter((w) => !w.gain && w.kind !== 'unattributed')
        .sort((a, b) => b.days - a.days)
        .slice(0, 2)
        .map((w) => w.kind === 'gap'
          ? t(locale, 'clFragGap', { d: w.days, phase: nameOf(w.toId!) })
          : t(locale, 'clFragOverrun', { d: w.days, phase: nameOf(w.phaseId!) }));
      if (ledger.usedDays > 0 && losses.length > 0) headlineParts.push(t(locale, 'clUsedMostlyBy', { items: losses.join(', ') }));
    }
    if (ledger.fourWeekDeltaDays != null && ledger.fourWeekDeltaDays !== 0) {
      const b4 = ledger.bufferDays - ledger.fourWeekDeltaDays;
      headlineParts.push(
        b4 >= 0
          ? t(locale, 'clWasFourWeeks', { b4 })
          : t(locale, 'clWasFourWeeksOver', { b4: -b4 }),
      );
    }
  }

  // ---- judgment sentence: register opener + computed reactions ----
  const oversub = ledger.situations.filter((s): s is Extract<Situation, { type: 'oversubscribed' }> => s.type === 'oversubscribed');
  const upNext = ledger.situations.find((s): s is Extract<Situation, { type: 'upcomingHandoff' }> => s.type === 'upcomingHandoff');
  const overshoot = ledger.situations.find((s): s is Extract<Situation, { type: 'sopOvershoot' }> => s.type === 'sopOvershoot');

  const reactions: React.ReactNode[] = [];
  if (ledger.register !== 'none') {
    const firstMove = oversub.find((o) => o.moves.length > 0);
    if (firstMove) {
      reactions.push(t(locale, 'clLeverMove', {
        name: firstMove.name, program: firstMove.moves[0].programName, d: firstMove.moves[0].bufferDays ?? 0,
      }));
    }
    if (upNext) reactions.push(t(locale, 'clLeverHandoff', { from: nameOf(upNext.fromId), to: nameOf(upNext.toId) }));
    if (overshoot) {
      reactions.push(
        <button key="declare" type="button" className={styles.declareBtn}
          onClick={() => document.getElementById('program-status')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          {t(locale, 'clLeverDeclare', { month: monthLong(`${overshoot.proposedSopMonth}-01`, locale) })}
        </button>,
      );
      if (overshoot.unitsDelayed != null) {
        reactions.push(t(locale, 'clUnitsDelayed', {
          units: overshoot.unitsDelayed.toLocaleString(locale), volume: volumeFirstYear.toLocaleString(locale),
        }));
      }
    }
  }

  // ---- waterfall rows, losses first by size, unattributed last ----
  const wfRows = [...ledger.waterfall].sort((a, b) => {
    if (a.kind === 'unattributed') return 1;
    if (b.kind === 'unattributed') return -1;
    return Number(a.gain) - Number(b.gain) || b.days - a.days;
  });
  const evidence = (w: WaterfallRow): string[] => {
    const out: string[] = [];
    if ((w.kind === 'overrun' || w.kind === 'underrun') && w.phaseId != null) {
      const r = ledger.schedule.find((x) => x.id === w.phaseId)!;
      const planned = Math.round((r.plannedEndMs - r.startMs) / DAY_MS);
      out.push(t(locale, 'clEvidencePlanTook', {
        p: planned, a: Math.round((r.endMs - r.startMs) / DAY_MS),
        from: dayShort(r.startMs, locale), to: dayShort(r.endMs, locale),
      }));
      if (w.kind === 'overrun') {
        const sunk = ledger.situations.find((s) => s.type === 'sunkOverrun' && s.phaseId === w.phaseId);
        if (sunk && sunk.type === 'sunkOverrun' && sunk.contendedNames.length > 0) {
          out.push(t(locale, 'clEvidenceContended', { names: sunk.contendedNames.join(', ') }));
        }
        out.push(t(locale, 'clEvidenceSunk'));
      }
    }
    if (w.kind === 'gap' && w.fromId != null && w.toId != null) {
      const from = ledger.schedule.find((x) => x.id === w.fromId)!;
      const to = ledger.schedule.find((x) => x.id === w.toId)!;
      out.push(to.kind === 'notStarted'
        ? t(locale, 'clEvidenceGapOngoing', { from: from.name, d1: dayShort(from.endMs, locale) })
        : t(locale, 'clEvidenceGap', { from: from.name, to: to.name, d1: dayShort(from.endMs, locale), d2: dayShort(to.startMs, locale) }));
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

  const resourceHref = (kind: 'partner' | 'person', id: number) => (kind === 'partner' ? `/partners/${id}` : `/people/${id}`);

  return (
    <section className={styles.wrapper} data-testid="chain-ledger">
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{t(locale, 'criticalChain')}</h2>
        {/* the key lives behind the ⓘ, not on the page (design.md §7) — same
            pattern as the Phases decoder */}
        <button type="button" className={styles.infoBtn} title={t(locale, 'clKeyTitle')}
          aria-label={t(locale, 'clKeyTitle')} onClick={() => legendRef.current?.showModal()}>
          <svg viewBox="0 0 16 16" width={15} height={15} aria-hidden>
            <circle cx={8} cy={8} r={6.6} fill="none" stroke="currentColor" strokeWidth={1.4} />
            <circle cx={8} cy={5} r={1} fill="currentColor" />
            <line x1={8} y1={7.4} x2={8} y2={11.2} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {sopMs == null || ledger.bufferDays == null ? (
        <p className={styles.headline}>{t(locale, 'clNoSop')}</p>
      ) : (
        <p className={styles.headline}
          title={t(locale, 'clGuidelineTitle', { b: ledger.bufferDays, rem: remTotal, g: ledger.guidelineDays })}>
          {headlineParts.join(' ')}
        </p>
      )}

      {sopMs != null && ledger.bufferDays != null && (
        <p className={styles.judgment}>
          <strong className={ledger.register === 'act' ? styles.act : undefined}>
            {t(locale, ledger.register === 'act' ? 'clJudgeAct' : ledger.register === 'plan' ? 'clJudgePlan' : 'clJudgeNone')}
          </strong>
          {reactions.length > 0 && (
            <span className={styles.reactions}>
              {' '}
              {reactions.map((r, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {r}
                </span>
              ))}
            </span>
          )}
        </p>
      )}

      {ledger.rebaselineSuggested && (
        <p className={styles.rebaseline}>
          {t(locale, 'clRebaseline')}{' '}
          <Link href={`/programs/${projectId}/phases`}>{t(locale, 'editPhases')}</Link>
        </p>
      )}

      <ScheduleChart ledger={ledger} sopMs={sopMs} now={now} locale={locale} />

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
            <rect x={1} y={1} width={10} height={12} fill="var(--bad-soft)" />
            <rect x={11} y={1} width={10} height={12} fill="var(--bad-soft)" opacity={0.55} />
          </svg>
          {t(locale, 'clKeyRed')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={1} y={1} width={20} height={12} fill="var(--ok-soft)" />
          </svg>
          {t(locale, 'clKeyGreen')}
        </div>
      </dialog>

      {wfRows.length > 0 && (
        <div className={styles.block}>
          <h3 className={styles.subtitle}>{t(locale, 'clWhereBufferWent')}</h3>
          <div className={styles.wf}>
            {wfRows.map((w, i) => (
              <React.Fragment key={i}>
                <span className={w.kind === 'unattributed' ? styles.muted : undefined}>
                  {w.kind === 'gap' ? t(locale, 'clIdleBefore', { phase: nameOf(w.toId!) })
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
                <span className={styles.evidence}>{evidence(w).join(' · ')}</span>
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

      {(oversub.length > 0 || (upNext && upNext.contended.length > 0)) && (
        <div className={styles.block}>
          <h3 className={styles.subtitle}>{t(locale, 'clResourceConstraints')}</h3>
          <ul className={styles.resList}>
            {oversub.map((o) => (
              <li key={`${o.kind}${o.resourceId}`} className={styles.resline}>
                <ResLine locale={locale} sit={o} nameOf={nameOf} href={resourceHref(o.kind, o.resourceId)} />
              </li>
            ))}
            {upNext && upNext.contended.length > 0 && (
              <li className={styles.resline}>
                {t(locale, 'clUpNextLine', {
                  phase: nameOf(upNext.toId),
                  names: upNext.contended.map((c) => c.name).join(', '),
                  n: Math.max(...upNext.contended.map((c) => c.n)),
                })}{' '}
                {t(locale, 'clUpNextConfirm', { current: nameOf(upNext.fromId) })}
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

// One oversubscription line: sentence templates with linked entities substituted.
function ResLine({ locale, sit, nameOf, href }: {
  locale: Locale;
  sit: Extract<Situation, { type: 'oversubscribed' }>;
  nameOf: (id: number) => string;
  href: string;
}) {
  const n = sit.moves.length + sit.tight.length;
  const line = t(locale, 'clOversubLine', { phase: nameOf(sit.phaseId), name: sit.name, n });
  const [before, after] = line.split(sit.name);
  return (
    <>
      {before}
      <Link href={href} className={styles.entityLink}>{sit.name}</Link>
      {after}
      {sit.moves.length > 0 && (
        <>
          {' '}
          {t(locale, 'clOversubMoves', {
            phase: nameOf(sit.phaseId),
            programs: sit.moves.map((m) => t(locale, 'clProgWithBuffer', { name: m.programName, d: m.bufferDays ?? 0 })).join(', '),
          })}
        </>
      )}
      {sit.tight.length > 0 && (
        <>
          {' '}
          {t(locale, 'clOversubTight', { programs: sit.tight.map((m) => m.programName).join(', ') })}
        </>
      )}
    </>
  );
}
