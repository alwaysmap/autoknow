'use client';

import { sopBufferReading, type SopBufferClass } from '../lib/sop';
import { t, Locale } from '../lib/i18n';
import styles from './SopOutlookCell.module.css';

/** Class token → its ink, one row each, the way every other token-keyed surface here
 *  spells it (ProgramsClient's SOP_OUTLOOK_COLOR, sop's SOP_TONE_BY_CLASS). A Record
 *  is exhaustive, so a fifth class would fail to compile rather than fall through to
 *  whichever branch happened to be last. */
const INK_BY_CLASS: Record<SopBufferClass, string> = {
  blown: styles.blown,
  late: styles.late,
  atrisk: styles.atrisk,
  ontrack: styles.ontrack,
};

/**
 * THE "will this make its SOP" cell, shared by /ecosystem and /ecosystem-summary.
 *
 * It existed hand-rolled in both, with the same four branches over the same helper and
 * the same four i18n keys, styled two different ways — the three-variants shape AGENTS
 * lesson 7 warns about. Both pages replaced a Monte Carlo blind to the real plan
 * (ADR forecasts-derive-from-the-real-chain-never-a-synthetic-model); one component is
 * what makes "they now answer the SOP question the same way" true of the rendering and
 * not just the arithmetic.
 *
 * The TEXT is the buffer in weeks, which is the cell's whole job — a quantity, not a
 * verdict. The INK is `sopBufferClass`, so a program holding two weeks against ten
 * weeks of chain no longer reads as healthy green here while its own page calls it
 * Some Risk and the ecosystem tile counts it at risk
 * ([ADR](../../docs/adr/2026-08-03-a-summary-count-uses-the-threshold-of-the-detail-it-summarizes.md)).
 *
 * `now` is a PROP, never `Date.now()` here: this is a client component, so calling it
 * during render gives SSR and hydration different answers. Both pages snapshot it once
 * per request in their Server Component.
 */
export default function SopOutlookCell({
  chainRemainingDays,
  sopDate,
  hillChartProgress,
  now,
  locale,
}: {
  chainRemainingDays: number;
  sopDate: string | null;
  hillChartProgress: number;
  now: number;
  locale: Locale;
}) {
  // No SOP set is not an outlook — say so rather than implying a healthy one.
  if (!sopDate) return <span className={styles.unknown}>{t(locale, 'tbd')}</span>;
  if (hillChartProgress >= 100) return <span className={styles.ontrack}>{t(locale, 'finishedLabel')}</span>;

  // One reading, read two ways: the buffer's SIGN picks the sentence (weeks in hand, or
  // weeks past), the CLASS picks the ink. Asking the class which sentence to print would
  // put the verdict back in charge of the quantity.
  const { cls, bufferDays } = sopBufferReading(chainRemainingDays, sopDate, now);
  return (
    <span className={INK_BY_CLASS[cls]}>
      {bufferDays >= 0
        ? t(locale, 'slackWeeks', { n: Math.floor(bufferDays / 7) })
        : t(locale, 'lateByWeeks', { n: Math.ceil(-bufferDays / 7) })}
    </span>
  );
}
