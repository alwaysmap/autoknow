'use client';

import React, { useRef, useState } from 'react';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { updatePartnerRelationship } from '../app/actions/relationship';
import { REL_SCORES, REL_KEY, clampScore, type RelScore } from '../lib/relationship';
import styles from './RelationshipScale.module.css';

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
  const W = 132, H = compact ? 14 : 18, PAD = 7;
  const x = (s: number) => PAD + ((s - 1) / 6) * (W - 2 * PAD);
  const cy = H / 2;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={score === null ? t(locale, 'relNotRated') : `${score}/7 — ${t(locale, REL_KEY[score])}`}
      className={styles.track}
    >
      <line x1={x(1)} y1={cy} x2={x(7)} y2={cy} stroke="var(--border, #d6d6d6)" strokeWidth={1.2} />
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

// Compact readout for list rows: aligned track + numeral. Sorting the column and
// scanning dot positions are the two ways to compare partners; both need no color.
export function RelationshipCell({ score, previousScore }: { score: RelScore | null; previousScore?: RelScore | null }) {
  const locale = useLocale();
  if (score === null) {
    return <span className={styles.notRated}>{t(locale, 'relNotRated')}</span>;
  }
  return (
    <span className={styles.cell} title={t(locale, REL_KEY[score])}>
      <RelationshipScaleTrack score={score} previousScore={previousScore} compact />
      <span className={styles.cellScore}>{score}<span className={styles.cellDen}>/7</span></span>
    </span>
  );
}

// Full unit for the partner page header: track, score + descriptor, updated date,
// and the update dialog (score picker + required note).
export default function RelationshipScale({
  partnerId,
  score,
  previousScore,
  updatedAt,
  editable = true,
}: {
  partnerId: number;
  score: RelScore | null;
  previousScore?: RelScore | null;
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
        <span className={styles.score}>{score ?? '–'}<span className={styles.den}>/7</span></span>
        <span className={styles.descriptor}>{score === null ? t(locale, 'relNotRated') : t(locale, REL_KEY[score])}</span>
      </div>
      <RelationshipScaleTrack score={score} previousScore={previousScore} />
      {updatedAt && (
        <div className={styles.updatedAt}>
          {t(locale, 'updatedOn', { d: new Date(updatedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) })}
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
