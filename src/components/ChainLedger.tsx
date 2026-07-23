'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { t, Locale } from '../lib/i18n';
import { tNodes, joinNodes } from './tNodes';
import { localDate } from '../lib/dates';
import { DAY_MS } from '../lib/sop';
import AnchorHeading from './AnchorHeading';
import OverlayDialog from './OverlayDialog';
import ConstraintRing from './ConstraintRing';
import { ChainSchedule, CARD_W, W } from './ChainSchedule';
import type { RowCard } from './ChainSchedule';
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

const CARD_GAP = 16; // px between the pointer and the summary card's near edge


export default function ChainLedger({
  projectId, locale, now, ledger, sopDate, volumeFirstYear, owner, ownerPersonId, ownerOtherActive,
}: ChainLedgerProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const wrapRef = useRef<HTMLElement>(null);
  const sopMs = sopDate ? +new Date(sopDate) : null;

  // Row hover card. Position is measured in the EVENT, not in an effect — the
  // element's box is what anchors it, and setState-in-effect is a lint error here.
  const [rowCard, setRowCard] = useState<RowCard | null>(null);
  const onRowCard = (row: ScheduleRow | null, el: SVGRectElement | null, labelW = 0, clientX?: number) => {
    if (!row || !el || !wrapRef.current) return setRowCard(null);
    const box = el.getBoundingClientRect();
    const wrap = wrapRef.current.getBoundingClientRect();
    // LOCKED vertically to its row — the card belongs to that phase and drifting it
    // up and down would break the tie — but FREE horizontally, following the pointer
    // so the reader can slide it off whatever it happens to be covering. Clamped to
    // the section so it can never hang outside; CARD_W is the max-width the
    // stylesheet gives it, which is all the clamp needs to know.
    // Without a pointer (keyboard focus) it parks past the label column, which is
    // the one place guaranteed not to cover the row names.
    const scale = box.width / W; // the hit rect spans the chart's full W user units
    const parked = box.left - wrap.left + labelW * scale + 8;
    // Follow the pointer, but FLIP to its LEFT once it crosses the section's midpoint
    // (#82). Pinned only to the right and clamped, the card parks against the right
    // edge and sits on top of the very cells the reader is pointing at; opening it to
    // the left there covers the already-read span behind the pointer instead. CARD_W
    // is the max width (the card may be narrower — a slightly larger gap, never an
    // overlap), which is all the pre-render estimate needs.
    let followed = parked;
    if (clientX != null) {
      const px = clientX - wrap.left;
      followed = px > wrap.width / 2 ? px - CARD_GAP - CARD_W : px + CARD_GAP;
    }
    setRowCard({
      row,
      left: Math.round(Math.max(0, Math.min(followed, wrap.width - CARD_W))),
      top: box.top - wrap.top + box.height / 2,
    });
  };
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
    <section className={styles.wrapper} data-testid="chain-ledger" ref={wrapRef}>
      <AnchorHeading
        id="critical-chain"
        linkLabel={t(locale, 'anchorLink')}
        actions={
          /* the key lives behind the ⓘ, not on the page (design.md §7) — same
             pattern as the Phases decoder */
          <button type="button" className={styles.infoBtn} title={t(locale, 'clKeyTitle')}
            aria-label={t(locale, 'clKeyTitle')} onClick={() => setLegendOpen(true)}>
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

      <ChainSchedule ledger={ledger} sopMs={sopMs} now={now} locale={locale} onRowCard={onRowCard} onJump={jumpToPhase} />

      {/* One phase's whole story against the buffer: when it ran, what it cost or
          handed back, and whether the chain is currently waiting on it. Rendered
          here rather than inside the chart because .chartwrap scrolls. */}
      {rowCard && (() => {
        const r = rowCard.row;
        const when =
          r.kind === 'done' ? t(locale, 'clRowRan', { a: dayShort(r.startMs, locale), b: dayShort(r.endMs, locale) })
          : r.kind === 'active' ? t(locale, 'clRowRunning', { a: dayShort(r.startMs, locale), b: dayShort(r.endMs, locale) })
          : t(locale, 'clRowPlannedWindow', { a: dayShort(r.startMs, locale), b: dayShort(r.endMs, locale) });
        const status = r.kind === 'done' ? 'statusDone' : r.kind === 'active' ? 'statusInProgress' : 'statusNotStarted';
        // The buffer claim. An ACTIVE row defers to isForecastOver and to the very
        // keys the bar's own label uses: a forecast variance under FORECAST_NOISE_DAYS
        // is rounding noise, and saying "spends 1 more day" beside a bar labelled "on
        // pace" is the exact disagreement lib/chainLedger warns about. A DONE row is
        // measured from real dates, so there it counts from one day.
        const claim: { text: string; bad: boolean } =
          r.kind === 'notStarted' ? { text: t(locale, 'clRowNoClaim'), bad: false }
          : r.kind === 'active'
            ? (isForecastOver(r)
                ? { text: t(locale, r.remainingDays === 1 ? 'clWorkLeftOverOne' : 'clWorkLeftOver', { d: r.remainingDays, o: r.varianceDays }), bad: true }
                : { text: t(locale, r.remainingDays === 1 ? 'clWorkLeftOnPaceOne' : 'clWorkLeftOnPace', { d: r.remainingDays }), bad: false })
          : r.varianceDays >= 1
            ? { text: t(locale, r.varianceDays === 1 ? 'clRowSpentOne' : 'clRowSpent', { d: r.varianceDays }), bad: true }
          : r.varianceDays <= -1
            ? { text: t(locale, r.varianceDays === -1 ? 'clRowGaveOne' : 'clRowGave', { d: -r.varianceDays }), bad: false }
            : { text: t(locale, 'clRowOnPlan'), bad: false };
        return (
          <div className={styles.hoverCard} role="status" data-testid="chain-row-card"
            style={{ left: rowCard.left, top: rowCard.top, transform: 'translateY(-50%)' }}>
            <div className={styles.hoverCardName}>{r.name}</div>
            <div className={styles.hoverCardLine}>{t(locale, status)} · {when}</div>
            <div className={claim.bad ? styles.hoverCardBad : styles.hoverCardLine}>{claim.text}</div>
            {r.gapBeforeDays >= 1 && (
              <div className={styles.hoverCardBad}>{t(locale, 'clSatIdle', { d: r.gapBeforeDays })}</div>
            )}
            {ledger.liveConstraintId === r.id && (
              <div className={styles.hoverCardChain}>{t(locale, 'clKeyRing')}</div>
            )}
          </div>
        );
      })()}

      {/* Below the chart, the two readings of it sit SIDE BY SIDE on a wide
          screen — what to do next (left) and where the buffer went (right) —
          and stack on narrow. Both follow from the same picture above. */}
      <div className={styles.lowerGrid}>
      {/* Next steps read AFTER the picture they follow from (2026-07-20 user call). */}
      {sopMs != null && ledger.bufferDays != null && (
        <div className={styles.steps}>
          {/* Same element and class as "Where the buffer went" beside it. It was
              a <p><strong>, which put the two column headings on different tags,
              sizes, weights AND margins — 4px of vertical disagreement between
              two things the grid presents as a matched pair. */}
          <h3 className={`${styles.subtitle} ${ledger.register === 'act' ? styles.act : ''}`}>
            {t(locale, ledger.register === 'act' ? 'clJudgeAct' : ledger.register === 'plan' ? 'clJudgePlan' : 'clJudgeNone')}
          </h3>
          {nextSteps.length > 0 && (
            <ul className={styles.stepList}>
              {nextSteps.map((step, i) => <li key={i} className={styles.step}>{step}</li>)}
            </ul>
          )}
        </div>
      )}

      {wfRows.length > 0 && (
        <div className={styles.block}>
          <h3 className={styles.subtitle}>{t(locale, 'clWhereBufferWent')}</h3>
          <div className={styles.wf}>
            {wfRows.map((w, i) => {
              // Evidence is optional (unattributed rows have none), and rendering an
              // empty cell was what made this list choppy — a phantom grid track under
              // every other row. Emit it only when there is something to say.
              const ev = evidence(w);
              return (
                <React.Fragment key={i}>
                  <span className={w.kind === 'unattributed' ? styles.muted : styles.wfLabel}>
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
                  {/* bar and number as ONE right-anchored unit, so the number lands at
                      the column edge and the numbers line up down the list. */}
                  <span className={styles.wfValue}>
                    <span className={`${styles.bar} ${w.gain ? styles.barGain : styles.barLoss} ${w.kind === 'unattributed' ? styles.barFaint : ''}`}
                      style={{ width: `${Math.min(12, Math.max(0.5, w.days * 0.55))}rem` }} />
                    <span className={`${styles.num} ${w.gain ? styles.gainText : styles.lossText}`}>
                      {w.days === 1
                        ? t(locale, w.gain ? 'clGaveBackOneDay' : 'clCostOneDay')
                        : t(locale, w.gain ? 'clGaveBackDays' : 'clCostDays', { d: w.days })}
                    </span>
                  </span>
                  {ev.length > 0 && <span className={styles.evidence}>{joinNodes(ev, ' · ')}</span>}
                </React.Fragment>
              );
            })}
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
      </div>

      {ledger.rebaselineSuggested && (
        <p className={styles.rebaseline}>
          {t(locale, 'clRebaseline')}{' '}
          <Link href={`/programs/${projectId}/phases`}>{t(locale, 'editPhases')}</Link>
        </p>
      )}

      {/* the schedule key, consulted on demand */}
      <OverlayDialog open={legendOpen} onClose={() => setLegendOpen(false)} width="26rem"
        title={t(locale, 'clKeyTitle')} closeLabel={t(locale, 'close')}>
        {/* one cell per meaning — the grid separates state by colour + position, no
            textures (issue #75). */}
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={2} y={2} width={8} height={10} rx={2} fill="var(--fg)" fillOpacity={0.42} />
            <rect x={12} y={2} width={8} height={10} rx={2} fill="var(--fg)" fillOpacity={0.86} />
          </svg>
          {t(locale, 'clKeyOnPlan')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={4} y={2} width={14} height={10} rx={2} fill="var(--bad)" />
          </svg>
          {t(locale, 'clKeyOver')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={4} y={2} width={14} height={10} rx={2} fill="var(--ok)" />
          </svg>
          {t(locale, 'clKeyEarly')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <line x1={3} y1={7} x2={19} y2={7} stroke="var(--warn)" strokeWidth={2} strokeDasharray="2 2" />
          </svg>
          {t(locale, 'clKeyIdle')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={4} y={2} width={14} height={10} rx={2} fill="none" stroke="var(--muted)" strokeWidth={1.25} strokeDasharray="2 1.5" />
          </svg>
          {t(locale, 'clKeyForecast')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={4} y={3} width={10} height={8} rx={2} fill="var(--fg)" fillOpacity={0.86} />
            <line x1={16} y1={1} x2={16} y2={13} stroke="var(--muted)" strokeWidth={1.5} />
          </svg>
          {t(locale, 'clKeyTick')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden style={{ overflow: 'visible' }}>
            <ConstraintRing cx={11} cy={7} r={1.5} />
          </svg>
          {t(locale, 'clKeyRing')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <path d="M2 5 H9 V10 H14 V7 H20" fill="none" stroke="var(--fg)" strokeWidth={1.5} />
            <line x1={9} y1={5} x2={9} y2={10} stroke="var(--bad)" strokeWidth={2} />
            <line x1={14} y1={10} x2={14} y2={7} stroke="var(--ok)" strokeWidth={2} />
          </svg>
          {t(locale, 'clKeyBufferLane')}
        </div>
      </OverlayDialog>


    </section>
  );
}
