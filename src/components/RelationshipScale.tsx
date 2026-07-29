'use client';

import { useEffect, useRef, useState } from 'react';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import NeedleHistoryList from './NeedleHistoryList';
import OverlayDialog from './OverlayDialog';
import RelativeTime from './RelativeTime';
import { RelationshipFace, RelationshipNoValue } from './RelationshipFace';
import { t } from '../lib/i18n';
import { tNodes } from './tNodes';
import { useLocale } from './LocaleProvider';
import { useHashAddressablePopover } from '../lib/useHashAddressablePopover';
import { updatePartnerRelationship } from '../app/actions/relationship';
import {
  REL_SCORES, REL_KEY, RELATIONSHIP_HISTORY_HASH, clampScore, isRelationshipHash,
  parseRelUpdateHash, type RelScore,
} from '../lib/relationship';
import type { NeedleChange } from '../lib/history';
import styles from './RelationshipScale.module.css';

// Partner relationship health on a 5-point scale — deliberately NOT a needle and
// deliberately colorless. Health is read as POSITION on a common 1..5 axis. Because
// every partner renders the same fixed axis, stacking these (the /partners list)
// makes relative health across all relationships legible at a glance.
//
// The two glyphs live in ./RelationshipFace and are imported FROM THERE by every call
// site — re-exporting them here would keep the very import cycle the move removed.

// Compact readout for list rows. Sorting the column and scanning face positions are
// the two ways to compare partners; both need no color.
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

/**
 * The partner page's health unit: the faces, the date, and DETAIL — a hash-addressable
 * view / update / history popover (#111).
 *
 * It is the third member of a family, not a new shape: Program Status & Health
 * (`NeedleGauge`) and Phase Progress (`PhaseTrack`) already put an entity's updates
 * behind a fragment, and every reference to one carries the fragment that opens it.
 * This mirrors `NeedleGauge` deliberately — same `OverlayDialog`, same in-place update
 * mode rather than a stacked second `<dialog>` (#34/#35), same `subscribeLocationChange`
 * opener (#40) — and adds the one thing neither had: a fragment that addresses a SINGLE
 * update, so a feed row or a briefing citation lands on the entry it cites.
 *
 * The fragment never reaches the server, so resolution is necessarily client-side.
 */
export default function RelationshipScale({
  partnerId,
  score,
  previousScore,
  updatedAt,
  editable = true,
  history,
}: {
  partnerId: number;
  score: RelScore | null;
  previousScore?: RelScore | null;
  updatedAt?: string | null;
  editable?: boolean;
  /** Every recorded update, newest first — the popover's content. Required: the
   *  popover IS this component's detail view, so there is exactly one overlay and
   *  no second, history-less path to keep in sync. */
  history: NeedleChange[];
}) {
  const locale = useLocale();
  const [pick, setPick] = useState<RelScore>(score ?? 3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);
  // The note lives inside MarkdownNoteEditor; mirror it out so a dismissal can tell
  // whether there is unsaved work to protect (#35).
  const [noteText, setNoteText] = useState('');

  const [adding, setAdding] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const resetForm = () => { setPick(score ?? 3); setNoteError(false); setNoteText(''); };

  // Has the open form changed anything worth protecting? The pick, or a typed note.
  const fieldsDirty = pick !== (score ?? 3) || noteText.trim() !== '';

  // Deep link: `#relationship-history` opens the log, `#relationship-update-:id` opens
  // it at that update (nnu — shared with NeedleGauge; the eager-ref fix here is what
  // NeedleGauge's own copy was missing before the two were unified). Opening writes
  // the hash, so the open popover IS a shareable URL.
  const { open: detailOpen, addressed, openDetail, closeDetail: closePopover, mayDismiss } = useHashAddressablePopover({
    matchesHash: isRelationshipHash,
    parseAddressed: parseRelUpdateHash,
    hashToWrite: RELATIONSHIP_HISTORY_HASH,
    onOpen: resetForm,
    fieldsDirty,
    confirmMessage: t(locale, 'discardUpdateConfirm'),
    // The server hands down a fresh array on every revalidate, so the subscription
    // rebinds and `resetForm` can never close over a `score` older than the log
    // beside it — with `[]` the handler would keep the first render's props forever,
    // and re-prefill the picker with a superseded score after the user files one.
    deps: [history],
  });
  const closeDetail = () => { setAdding(false); closePopover(); };
  const startAdding = () => { resetForm(); setAdding(true); };

  // Bring the addressed update into view. A log of near-identical cards otherwise
  // answers "here is the history" when the reader asked "show me THIS update".
  // `nearest` keeps the scroll inside the popover's single scroll region.
  useEffect(() => {
    if (!detailOpen || addressed == null) return;
    listRef.current?.querySelector(`[data-update-id="${addressed}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [detailOpen, addressed]);

  const submitUpdate = async (formData: FormData) => {
    // The rich editor's hidden input can't carry native `required` — gate here.
    if (!((formData.get('notes') as string) || '').trim()) { setNoteError(true); return; }
    setNoteError(false);
    setIsSubmitting(true);
    try {
      await updatePartnerRelationship(formData);
      setAdding(false);
    } catch (err) { console.error(err); }
    finally { setIsSubmitting(false); }
  };

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
      {/* #171: a duration, not a date the reader subtracts by hand — see NeedleGauge's
          identical conversion for why tNodes (not t()) carries the value here. */}
      {updatedAt && (
        <div className={styles.updatedAt}>
          {tNodes(locale, 'updatedOn', { d: <RelativeTime value={updatedAt} /> })}
        </div>
      )}
      {/* faces · date · DETAIL — one horizontal cluster (§7). Updating happens inside
          the popover, so the resting row states the fact and offers one way in,
          exactly as the program gauge's row does. */}
      <button type="button" onClick={openDetail} className={styles.updateBtn}>{t(locale, 'detail')}</button>

      {/* The complete log — faces, the qualitative label, author, timestamp and the
          written note in full (it feeds the AI briefing and is deliberately absent
          beside the readout). UPDATE reveals the form in place rather than opening a
          second modal over this one (§4b). */}
      <OverlayDialog
        open={detailOpen}
        onClose={closeDetail}
        width="56rem"
        dataTestId="relationship-detail"
        title={t(locale, 'relDetailTitle')}
        closeLabel={t(locale, 'close')}
        canClose={() => mayDismiss(adding)}
        // While editing, the form owns its own Cancel/Save — a second dialog-level
        // Close rail would be a duplicate action AND a silent-discard path, so the
        // footer is hidden until the edit is resolved (#35).
        footer={
          adding ? undefined : (
            <>
              <button type="button" onClick={closeDetail} className={styles.cancelBtn}>
                {t(locale, 'close')}
              </button>
              {editable && (
                <button type="button" onClick={startAdding} className={styles.submitBtn}>
                  {t(locale, 'update')}
                </button>
              )}
            </>
          )
        }
      >
        {adding && (
          <form action={submitUpdate} className={styles.inlineForm}>
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
                placeholder={t(locale, 'relNotePlaceholder')} onChange={setNoteText} />
              {noteError && <div className={styles.noteError}>{t(locale, 'updateNeedsNote')}</div>}
            </div>

            <div className={styles.actionRow}>
              <button type="button" onClick={() => setAdding(false)} disabled={isSubmitting} className={styles.cancelBtn}>
                {t(locale, 'cancel')}
              </button>
              <button type="submit" disabled={isSubmitting} className={styles.submitBtn}>
                {isSubmitting ? t(locale, 'saving') : t(locale, 'save')}
              </button>
            </div>
          </form>
        )}
        <div ref={listRef}>
          <NeedleHistoryList changes={history} relationship locale={locale}
            highlightId={addressed} emptyLabel={t(locale, 'noUpdatesRecorded')} />
        </div>
      </OverlayDialog>
    </div>
  );
}
