'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { t, Locale } from '../lib/i18n';
import { tNodes, joinNodes } from './tNodes';
import { localDate } from '../lib/dates';
import { DAY_MS, dayFloor } from '../lib/sop';
import AnchorHeading from './AnchorHeading';
import OverlayDialog from './OverlayDialog';
import ConstraintRing from './ConstraintRing';
import PersonCell, { type PersonRef } from './PersonCell';
import { ChainSchedule } from './ChainSchedule';
import { useSteadyPageScroll } from '../lib/useSteadyPageScroll';
import { summaryAt } from '../lib/chainDay';
import { isForecastOver, isRealizedOverrun, isRealizedUnderrun, isSevereOverrun } from '../lib/chainLedger';
import { phasesEditHref } from '../lib/phase';
import { partnerHref, programHref } from '../lib/entityHref';
import type { ChainLedgerResult, ResourceRef, Situation, WaterfallRow } from '../lib/chainLedger';
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
  /** The program's Googler owner, off the `ownerPersonId` FK (#127 E7) — id AND name
   *  together, so the sentence cannot end up with a route and no name to put on it (the
   *  pairing #153 drew out on the phase rail). Null when the program has no owner. The
   *  stored `ownerName` string used to ride alongside as a fallback label; the FK makes
   *  it dead weight — a resolved owner is exactly a program that HAS one. */
  ownerPerson: PersonRef | null;
  ownerOtherActive: OwnerOtherActive[];
}

const jumpToPhase = (id: number) => window.dispatchEvent(new CustomEvent('autoknow:jump-phase', { detail: id }));

const monthLong = (iso: string, locale: Locale) => localDate(iso, locale, { month: 'long', year: 'numeric' });
const dayShort = (ms: number, locale: Locale) => localDate(new Date(ms), locale, { month: 'short', day: 'numeric' });

export default function ChainLedger({
  projectId, locale, now, ledger, sopDate, volumeFirstYear, ownerPerson, ownerOtherActive,
}: ChainLedgerProps) {
  const scrollPageTo = useSteadyPageScroll();
  const [legendOpen, setLegendOpen] = useState(false);
  const sopMs = sopDate ? +new Date(sopDate) : null;

  // The day the docked day strip describes (issue #161 step 4/4) — the position
  // ChainSchedule's crosshair/focus is tracking, defaulting to today. Unlike the row
  // card it replaced, this is never null: a docked panel states something at rest,
  // rather than disappearing the moment nothing is hovered.
  const [dayMs, setDayMs] = useState(() => dayFloor(now));
  const daySummary = summaryAt(ledger.schedule, dayMs, now);
  const nameOf = (id: number) => ledger.schedule.find((r) => r.id === id)?.name ?? `#${id}`;
  const remTotal = ledger.schedule.reduce((s, r) => s + r.remainingDays, 0);

  // Every entity MENTION is a link (design.md §2): phases jump to their rail row
  // (a button — anchors would collide with the rail's links), programs/partners/
  // people navigate to their pages.
  const phaseBtn = (id: number) => (
    <button type="button" className={styles.phaseLink} onClick={() => jumpToPhase(id)}>{nameOf(id)}</button>
  );
  const progLink = (id: number, name: string) => (
    <Link href={programHref(id)} className={styles.entityLink}>{name}</Link>
  );
  // A contended resource is a partner or a PERSON, and the person half goes through the
  // same cell as the owner sentence below — one component knows a person's route, so
  // this file cannot hand-roll a second /people/:id (the sweep entityHref.ts flags).
  const resLink = (r: ResourceRef) => (
    r.kind === 'partner'
      ? <Link href={partnerHref(r.id)} className={styles.entityLink}>{r.name}</Link>
      : <PersonCell person={{ id: r.id, name: r.name }} className={styles.entityLink} />
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

  // ---- overruns lead the list. A phase past its OWN estimate is where the plan
  // and the work have parted company, and until now the ledger only reported that
  // as history in "Where the buffer went" — nothing ever asked anyone to act on it,
  // so a phase could double its estimate under a heading reading "Nothing needs to
  // change today". It is also the least disruptive thing to act on (the heading's
  // promised order): root-causing a phase beats moving people between programs,
  // which beats moving the SOP.
  // Live phases get a bullet each — there are rarely more than two; finished ones
  // collapse into ONE re-planning bullet, since five bullets each ending "and
  // re-estimate" is one recommendation printed five times.
  // Phases with no estimated duration are skipped: with nothing to be a percentage
  // OF, every sentence here would be a false statement about lateness (the mutation
  // boundary requires a positive duration, so this is legacy data only).
  const liveOverruns = ledger.situations
    .filter((s): s is Extract<Situation, { type: 'forecastOverrun' }> => s.type === 'forecastOverrun' && s.plannedDays > 0)
    .sort((a, b) => b.overPct - a.overPct || b.days - a.days);
  const sunkOverruns = ledger.situations
    .filter((s): s is Extract<Situation, { type: 'sunkOverrun' }> => s.type === 'sunkOverrun' && s.plannedDays > 0)
    .sort((a, b) => b.overPct - a.overPct || b.days - a.days);
  // Re-planning is the second half of every overrun sentence, so the group carries
  // the way to do it — the phase editor, where estimated durations live. ONE link,
  // on the last overrun bullet: repeated on every bullet it stops reading as an
  // affordance and starts reading as punctuation.
  const overrunSteps: React.ReactNode[] = liveOverruns.map((o) =>
    tNodes(locale, isSevereOverrun(o) ? 'clOverrunSevere' : 'clOverrunActive', {
      phase: phaseBtn(o.phaseId), pct: o.overPct, d: o.days, p: o.plannedDays, r: o.remainingDays,
    }));
  if (sunkOverruns.length > 0) {
    overrunSteps.push(sunkOverruns.length === 1
      ? tNodes(locale, 'clOverrunSunkOne', {
          phases: phaseBtn(sunkOverruns[0].phaseId), d: sunkOverruns[0].days, pct: sunkOverruns[0].overPct,
        })
      : tNodes(locale, 'clOverrunSunk', {
          phases: joinNodes(sunkOverruns.map((s) =>
            tNodes(locale, 'clOverrunSunkItem', { phase: phaseBtn(s.phaseId), pct: s.overPct }))),
        }));
  }
  const lastOverrun = overrunSteps.length - 1;
  overrunSteps.forEach((step, i) => nextSteps.push(
    i < lastOverrun ? step : (
      <>
        {step}{' '}
        <Link href={phasesEditHref(projectId)} className={styles.entityLink}>{t(locale, 'editPhases')}</Link>
      </>
    ),
  ));

  // who the chain is waiting on, and whose slack can move. When the NEXT phase is
  // also the oversubscribed one, its staffing clause rides on this bullet rather
  // than repeating the same person-and-phase as a second bullet.
  const upNextCoveredHere = upNext != null && oversub.some((o) => o.phaseId === upNext.toId);
  // Only a phase that is actually past its plan can be called overrunning — the
  // same two lists the overrun bullets above are built from, so a bullet and an
  // oversubscription opener can never disagree about which phases are over.
  const overrunning = new Set([...liveOverruns, ...sunkOverruns].map((s) => s.phaseId));
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
  if (ownerPerson && ownerOtherActive.length > 0) {
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
      // A person inside a SENTENCE, so the name matters more here than anywhere: an
      // LDAP address mid-prose is design.md §6's "reads as a machine wrote it". Same
      // PersonCell the tables use — the sentence and the cells cannot disagree about
      // what this person is called, or about where clicking them goes.
      owner: <PersonCell person={ownerPerson} className={styles.entityLink} />,
      n: ownerOtherActive.length,
      items,
    }));
  }

  // the escalation, when the SOP is already overshot
  if (overshoot) {
    nextSteps.push(
      <>
        {/* Only ever changes WHERE you are — a link, not a button (design.md §6,
            #168). A real `href` so it works with no JS, keyboard, and middle-click;
            the `onClick` only upgrades the jump to the centered, steady-scroll one
            `useSteadyPageScroll` gives every other in-page scroll on this page — a
            plain default-scrolled anchor would land the target at the viewport's
            top edge instead of centered, and skip the press-halts-motion guard. */}
        <a href="#program-status" className={styles.declareBtn}
          onClick={(e) => { e.preventDefault(); scrollPageTo(document.getElementById('program-status'), { behavior: 'smooth', block: 'center' }); }}>
          {t(locale, 'clLeverDeclare', { month: monthLong(`${overshoot.proposedSopMonth}-01`, locale) })}
        </a>
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

      <ChainSchedule ledger={ledger} sopMs={sopMs} now={now} locale={locale} onDay={setDayMs} onJump={jumpToPhase} />

      {/* The docked day strip (issue #161 step 4/4, replacing the per-row hover card):
          a FIXED panel under the chart, never floating, so it needs none of the
          retired card's pointer-follow/flip math. It answers "what was EVERYTHING
          doing on this day" (lib/chainDay's header) rather than "what is the row
          under the pointer" — every phase the tracked day crosses, plus the two
          things that are not phases and still cost buffer: a credit window a phase
          opened by finishing early, and an idle gap between a baton landing and
          being picked up. */}
      <div className={styles.dayStrip} data-testid="chain-day-strip">
        <div className={styles.dayName}>
          {t(locale, 'cdTitle')} · {dayShort(dayMs, locale)}
          {dayMs === dayFloor(now) ? ` ${t(locale, 'cdToday')}` : ''}
        </div>
        {daySummary.phases.length === 0 && daySummary.gaps.length === 0 && daySummary.credits.length === 0 ? (
          <p className={styles.dayLine}>{t(locale, 'cdNothing')}</p>
        ) : (
          <>
            {daySummary.phases.map((p) => {
              const r = p.row;
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
                : isRealizedOverrun(r)
                  ? { text: t(locale, r.varianceDays === 1 ? 'clRowSpentOne' : 'clRowSpent', { d: r.varianceDays }), bad: true }
                : isRealizedUnderrun(r)
                  ? { text: t(locale, r.varianceDays === -1 ? 'clRowGaveOne' : 'clRowGave', { d: -r.varianceDays }), bad: false }
                  : { text: t(locale, 'clRowOnPlan'), bad: false };
              return (
                <div key={r.id} className={styles.dayStripItem}>
                  <div className={styles.dayName}>
                    {phaseBtn(r.id)} · {t(locale, 'cdDayOf', { i: p.dayIndex, n: p.spanDays })}
                  </div>
                  <div className={styles.dayLine}>{t(locale, status)} · {when}</div>
                  <div className={claim.bad ? styles.dayBad : styles.dayLine}>{claim.text}</div>
                  {ledger.liveConstraintId === r.id && (
                    <div className={styles.dayChain}>{t(locale, 'clKeyRing')}</div>
                  )}
                </div>
              );
            })}
            {daySummary.credits.map((c) => (
              <div key={`credit-${c.phaseId}`} className={styles.dayStripItem}>
                <div className={styles.dayName}>{phaseBtn(c.phaseId)}</div>
                <div className={styles.dayLine}>
                  {t(locale, c.days === 1 ? 'clRowGaveOne' : 'clRowGave', { d: c.days })}
                </div>
              </div>
            ))}
            {daySummary.gaps.map((g) => (
              <div key={`gap-${g.fromId}-${g.toId}`} className={styles.dayStripItem}>
                <div className={styles.dayBad}>
                  {tNodes(locale, ledger.schedule.find((x) => x.id === g.toId)?.kind === 'notStarted' ? 'clEvidenceGapOngoing' : 'clEvidenceGap', {
                    from: phaseBtn(g.fromId), to: phaseBtn(g.toId),
                    d1: dayShort(g.fromMs, locale), d2: dayShort(g.toMs, locale),
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

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
                  {/* The gain/loss stated in words, right-anchored so the day counts
                      line up down the list. The magnitude bar that used to sit here was
                      removed (2026-07-24 user call): at 0.55rem/day a long loss clamped to a 12rem
                      slab that starved the label column and wrapped long phase names —
                      and the number already carries the magnitude (§6, one measure per
                      cell). Colour (red loss / green gain) survives on the text. */}
                  <span className={`${styles.wfValue} ${w.gain ? styles.gainText : styles.lossText}`}>
                    {w.days === 1
                      ? t(locale, w.gain ? 'clGaveBackOneDay' : 'clCostOneDay')
                      : t(locale, w.gain ? 'clGaveBackDays' : 'clCostDays', { d: w.days })}
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
          <Link href={phasesEditHref(projectId)}>{t(locale, 'editPhases')}</Link>
        </p>
      )}

      {/* the schedule key, consulted on demand */}
      <OverlayDialog open={legendOpen} onClose={() => setLegendOpen(false)} width="26rem"
        title={t(locale, 'clKeyTitle')} closeLabel={t(locale, 'close')}>
        {/* one glyph per mark, drawn the way the chart draws it (issue #161, Option A):
            each swatch is the SAME shape as the bar it names, with the plan tick where
            the chart puts it — a legend whose glyph is a different shape from the ink
            teaches the reader the wrong thing. */}
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={2} y={2} width={8} height={10} rx={2} fill="var(--fg)" fillOpacity={0.42} />
            <rect x={12} y={2} width={8} height={10} rx={2} fill="var(--fg)" fillOpacity={0.86} />
          </svg>
          {t(locale, 'clKeyOnPlan')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={2} y={2} width={9} height={10} rx={2} fill="var(--fg)" fillOpacity={0.42} />
            <rect x={11} y={2} width={9} height={10} rx={2} fill="var(--bad)" fillOpacity={0.94} />
            <line x1={11} y1={1} x2={11} y2={13} stroke="var(--muted)" strokeWidth={1.5} />
          </svg>
          {t(locale, 'clKeyOver')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={2} y={2} width={9} height={10} rx={2} fill="var(--fg)" fillOpacity={0.42} />
            <rect x={11} y={2} width={9} height={10} rx={2} fill="none" stroke="var(--ok)"
              strokeWidth={1.25} strokeDasharray="2 1.5" />
            <line x1={20} y1={1} x2={20} y2={13} stroke="var(--muted)" strokeWidth={1.5} />
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
            <rect x={2} y={2} width={9} height={10} rx={2} fill="none" stroke="var(--muted)"
              strokeWidth={1.25} strokeDasharray="2 1.5" />
            <rect x={11} y={2} width={9} height={10} rx={2} fill="none" stroke="var(--bad)"
              strokeWidth={1.25} strokeDasharray="2 1.5" />
            <line x1={11} y1={1} x2={11} y2={13} stroke="var(--muted)" strokeWidth={1.5} />
          </svg>
          {t(locale, 'clKeyForecast')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <rect x={2} y={3} width={12} height={8} rx={2} fill="var(--fg)" fillOpacity={0.86} />
            <line x1={14} y1={1} x2={14} y2={13} stroke="var(--muted)" strokeWidth={1.5} />
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
          {/* the two-tone flow in miniature: the same two bands either side of one
              boundary, drawn from the same tokens as the chart (issue #161) */}
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide} aria-hidden>
            <path d="M2 4 H20 V8 L14 9 L8 6 L2 5 Z" fill="var(--bad)" fillOpacity={0.17} />
            <path d="M2 5 L8 6 L14 9 L20 8 V12 H2 Z" fill="var(--ok)" fillOpacity={0.22} />
            <path d="M2 5 L8 6 L14 9 L20 8" fill="none" stroke="var(--fg)" strokeWidth={1.5} />
          </svg>
          {t(locale, 'clKeyBufferLane')}
        </div>
      </OverlayDialog>


    </section>
  );
}
