'use client';

import { useState } from 'react';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import OverlayDialog from './OverlayDialog';
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

/** "Was unrated" — the prior slot when health goes from nothing to its first value.
 *  A dashed empty ring with a centre dash; not a face (there was no reading). */
export function RelationshipNoValue({ size = 26, decorative = false }: { size?: number; decorative?: boolean }) {
  const locale = useLocale();
  return (
    <svg
      viewBox="-10 -10 20 20"
      width={size}
      height={size}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t(locale, 'relNotRated') })}
    >
      <circle cx={0} cy={0} r={8.6} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="2.4 2.4" />
      <line x1={-3.6} y1={0} x2={3.6} y2={0} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      {!decorative && <title>{t(locale, 'relNotRated')}</title>}
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
  previousScore,
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const locale = useLocale();
  const [pick, setPick] = useState<RelScore>(score ?? 4);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);

  const open = () => { setPick(score ?? 4); setNoteError(false); setDialogOpen(true); };

  return (
    <div className={styles.wrapper} data-testid="relationship-scale">
      <div className={styles.readout}>
        {score !== null ? (
          <span className={styles.faces}>
            {/* Prior slot: the previous face, OR a "was unrated" glyph when this is the
                first-ever rating (health went from nothing to a value). Hidden only
                when the value is unchanged. */}
            {previousScore !== score && (
              <>
                <span className={styles.priorFace}>
                  {previousScore != null
                    ? <RelationshipFace score={previousScore} size={26} decorative />
                    : <RelationshipNoValue size={26} decorative />}
                </span>
                <span className={styles.faceArrow} aria-hidden>
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8 h9 M9 5 l3 3 -3 3" />
                  </svg>
                </span>
              </>
            )}
            <span className={styles.currentFace}>
              <RelationshipFace score={score} size={34} />
            </span>
          </span>
        ) : (
          <span className={styles.descriptor}>{t(locale, 'relNotRated')}</span>
        )}
      </div>
      {updatedAt && (
        <div className={styles.updatedAt}>
          {t(locale, 'updatedOn', { d: localDate(updatedAt, locale, { month: 'short', day: 'numeric' }) })}
        </div>
      )}
      {editable && (
        <button type="button" onClick={open} className={styles.updateBtn}>{t(locale, 'update')}</button>
      )}

      <OverlayDialog open={dialogOpen} onClose={() => setDialogOpen(false)} width="28rem"
        title={t(locale, 'relUpdateTitle')} closeLabel={t(locale, 'close')}>
        <form
          action={async (formData) => {
            if (!((formData.get('notes') as string) || '').trim()) { setNoteError(true); return; }
            setNoteError(false);
            setIsSubmitting(true);
            try { await updatePartnerRelationship(formData); setDialogOpen(false); }
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
            <button type="button" onClick={() => setDialogOpen(false)} disabled={isSubmitting} className={styles.cancelBtn}>
              {t(locale, 'cancel')}
            </button>
            <button type="submit" disabled={isSubmitting} className={styles.submitBtn}>
              {isSubmitting ? t(locale, 'saving') : t(locale, 'save')}
            </button>
          </div>
        </form>
      </OverlayDialog>
    </div>
  );
}
