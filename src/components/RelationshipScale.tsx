'use client';

import React, { useRef, useState } from 'react';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { updatePartnerRelationship } from '../app/actions/relationship';
import { REL_SCORES, REL_KEY, clampScore, type RelScore } from '../lib/relationship';
import styles from './RelationshipScale.module.css';
import { localDate } from '../lib/dates';

// Partner relationship health on a 7-point scale — deliberately NOT a needle and
// deliberately colorless. Health is read as POSITION on a common 1..7 axis: a solid
// ink dot at the current score, an open ring where it was last time. Because every
// partner renders the same fixed axis, stacking these tracks (the /partners list)
// makes relative health across all relationships legible at a glance.

export function RelationshipScaleTrack({
  score,
  previousScore,
  compact = false,
}: {
  score: RelScore | null;
  previousScore?: RelScore | null;
  compact?: boolean;
}) {
  const locale = useLocale();
  // Fixed geometry so tracks align row-to-row regardless of container width.
  const W = 132, H = compact ? 14 : 18, PAD = 9;
  const x = (s: number) => PAD + ((s - 1) / (REL_SCORES.length - 1)) * (W - 2 * PAD);
  const cy = H / 2;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={score === null ? t(locale, 'relNotRated') : `${score}/5 — ${t(locale, REL_KEY[score])}`}
      className={styles.track}
    >
      <line x1={x(1)} y1={cy} x2={x(REL_SCORES.length)} y2={cy} stroke="var(--border, #d6d6d6)" strokeWidth={1.2} />
      {REL_SCORES.map((s) => (
        <circle key={s} cx={x(s)} cy={cy} r={1.7} fill="var(--muted, #9a948a)" opacity={0.55} />
      ))}
      {/* previous score: an open ring — where the relationship was last time */}
      {previousScore != null && previousScore !== score && (
        <circle cx={x(previousScore)} cy={cy} r={4.2} fill="none" stroke="var(--muted, #9a948a)" strokeWidth={1.4} />
      )}
      {/* current score: one solid ink dot */}
      {score !== null && <circle cx={x(score)} cy={cy} r={compact ? 4.4 : 5.2} fill="var(--fg, #1f1c17)" />}
    </svg>
  );
}

// ---- Face + sparkline (the legible form of the scale) --------------------------
// A pain-scale/"airport bathroom" face carries the VALENCE the dot-axis couldn't:
// nobody has to ask whether 7 is good when 7 is beaming. Ink-only (the scale stays
// colorless by design) — mouth curvature and eyes do all the work.

export function RelationshipFace({ score, size = 22, decorative = false }: {
  score: RelScore; size?: number;
  /** Inside an already-labeled control (e.g. the picker radios) the face must not
   *  contribute to the accessible name. */
  decorative?: boolean;
}) {
  const locale = useLocale();
  // curvature: -1 (deep frown, 1) .. +1 (big smile, 7); 4 is a flat "steady".
  const c = (score - 3) / 2;
  const endY = 3.6 - c * 1.6;
  const ctlY = 3.6 + c * 3.4;
  return (
    <svg
      viewBox="-10 -10 20 20"
      width={size}
      height={size}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `${score}/5 — ${t(locale, REL_KEY[score])}` })}
    >
      <circle cx={0} cy={0} r={8.6} fill="none" stroke="currentColor" strokeWidth={1.5} />
      <circle cx={-3.1} cy={-2.6} r={1.15} fill="currentColor" />
      <circle cx={3.1} cy={-2.6} r={1.15} fill="currentColor" />
      <path
        d={`M -4 ${endY} Q 0 ${ctlY} 4 ${endY}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {!decorative && (
        <title>{`${score}/5 — ${t(locale, REL_KEY[score])} (1 = ${t(locale, REL_KEY[1])}, 5 = ${t(locale, REL_KEY[5])})`}</title>
      )}
    </svg>
  );
}

/** Tiny 1..7 history line, oldest → newest, latest point emphasized. */
export function RelationshipSparkline({ history, width = 64, height = 18 }: {
  history: number[]; width?: number; height?: number;
}) {
  if (history.length < 2) return null;
  const pad = 3;
  const x = (i: number) => pad + (i / (history.length - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((clampScore(v) - 1) / (REL_SCORES.length - 1)) * (height - 2 * pad);
  const points = history.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = history[history.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke="var(--muted, #9a948a)" strokeWidth={1.3} strokeLinejoin="round" />
      <circle cx={x(history.length - 1)} cy={y(last)} r={2.2} fill="var(--fg, #333)" />
    </svg>
  );
}

// Compact readout for list rows: aligned track + numeral. Sorting the column and
// scanning dot positions are the two ways to compare partners; both need no color.
export function RelationshipCell({ score }: { score: RelScore | null; history?: number[] }) {
  const locale = useLocale();
  if (score === null) {
    return <span className={styles.notRated}>{t(locale, 'relNotRated')}</span>;
  }
  return (
    <span className={styles.cell}>
      <RelationshipFace score={score} size={22} />
    </span>
  );
}

// Full unit for the partner page header: track, score + descriptor, updated date,
// and the update dialog (score picker + required note).
export default function RelationshipScale({
  partnerId,
  score,
  updatedAt,
  editable = true,
}: {
  partnerId: number;
  score: RelScore | null;
  previousScore?: RelScore | null;
  /** Oldest → newest scores for the sparkline; falls back to the dot track. */
  history?: number[];
  updatedAt?: string | null;
  editable?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const locale = useLocale();
  const [pick, setPick] = useState<RelScore>(score ?? 4);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);

  const open = () => { setPick(score ?? 4); setNoteError(false); dialogRef.current?.showModal(); };
  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => { if (e.target === dialogRef.current) dialogRef.current?.close(); };

  return (
    <div className={styles.wrapper} data-testid="relationship-scale">
      <div className={styles.readout}>
        {score !== null
          ? <RelationshipFace score={score} size={34} />
          : <span className={styles.descriptor}>{t(locale, 'relNotRated')}</span>}
      </div>
      {updatedAt && (
        <div className={styles.updatedAt}>
          {t(locale, 'updatedOn', { d: localDate(updatedAt, locale, { month: 'short', day: 'numeric' }) })}
        </div>
      )}
      {editable && (
        <button type="button" onClick={open} className={styles.updateBtn}>{t(locale, 'update')}</button>
      )}

      <dialog ref={dialogRef} className={styles.dialog} onClick={onBackdrop}>
        <div className={styles.dialogHeader}><h3>{t(locale, 'relUpdateTitle')}</h3></div>
        <form
          action={async (formData) => {
            if (!((formData.get('notes') as string) || '').trim()) { setNoteError(true); return; }
            setNoteError(false);
            setIsSubmitting(true);
            try { await updatePartnerRelationship(formData); dialogRef.current?.close(); }
            catch (err) { console.error(err); }
            finally { setIsSubmitting(false); }
          }}
          className={styles.dialogForm}
        >
          <input type="hidden" name="partnerId" value={partnerId} />
          <input type="hidden" name="score" value={pick} />

          <div className={styles.formGroup}>
            <div className={styles.scaleHint}>{t(locale, 'relScaleHint')}</div>
            <div className={styles.picker} role="radiogroup" aria-label={t(locale, 'relScoreAria')}>
              {REL_SCORES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={pick === s}
                  onClick={() => setPick(clampScore(s))}
                  className={`${styles.pickBtn} ${pick === s ? styles.pickBtnActive : ''}`}
                >
                  <RelationshipFace score={s} size={20} decorative />
                  {s}
                </button>
              ))}
            </div>
            <div className={styles.pickDescriptor}>{t(locale, REL_KEY[pick])}</div>
          </div>

          <div className={styles.formGroup}>
            <span className={styles.formLabel}>{t(locale, 'updateWhatWhy')}</span>
            <MarkdownNoteEditor name="notes" ariaLabel={t(locale, 'updateWhatWhy')}
              placeholder={t(locale, 'relNotePlaceholder')} />
            {noteError && <div className={styles.noteError}>{t(locale, 'updateNeedsNote')}</div>}
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={() => dialogRef.current?.close()} disabled={isSubmitting} className={styles.cancelBtn}>
              {t(locale, 'cancel')}
            </button>
            <button type="submit" disabled={isSubmitting} className={styles.submitBtn}>
              {isSubmitting ? t(locale, 'saving') : t(locale, 'save')}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
