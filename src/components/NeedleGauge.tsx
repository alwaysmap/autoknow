'use client';

import { useHashAddressablePopover } from '../lib/useHashAddressablePopover';
import Link from 'next/link';
import { useRef, useState } from 'react';
import styles from './NeedleGauge.module.css';
import Markdown from './Markdown';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import NeedleHistoryList from './NeedleHistoryList';
import OverlayDialog from './OverlayDialog';
import RelativeTime from './RelativeTime';
import { t } from '../lib/i18n';
import { tNodes } from './tNodes';
import { useLocale } from './LocaleProvider';
import { updateNeedleStatus } from '../app/actions/needle';
import { HEALTHS, healthColor, healthKey, parseHealth, type Health } from '../lib/health';
// The fragment vocabulary is owned by `lib/needle` (the domain module), the way
// `#phase-:id` is owned by `lib/phase`: a server module building a citation href
// cannot import a client component for it.
import { STATUS_HISTORY_HASH, isStatusHash, parseStatusUpdateHash } from '../lib/needle';
import type { NeedleChange } from '../lib/history';
import { CX, CY, A0, A1, SWEEP, VB_X, VB_Y, VB_W, VB_H, clamp01, Gauge, NeedleGaugeSvg } from './NeedleGaugeSvg';

// Re-exported so existing imports of the read-only gauge keep working; new
// call sites should import it from './NeedleGaugeSvg' directly.
export { NeedleGaugeSvg };

interface NeedleGaugeProps {
  progress: number; // 0..100
  health: string | null;
  previousProgress?: number | null;
  previousHealth?: string | null;
  updatedAt?: string | null;
  targetId: number;
  scope?: 'project' | 'partner';
  editable?: boolean;
  /** Every recorded update, newest first — the History popup's content. */
  history?: NeedleChange[];
}

export default function NeedleGauge({
  progress, health, previousProgress, previousHealth, updatedAt, targetId, scope = 'project', editable = true,
  history,
}: NeedleGaugeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const currentHealth = parseHealth(health);

  const [dragProgress, setDragProgress] = useState<number>(progress);
  const [pickHealth, setPickHealth] = useState<Health>(currentHealth);
  const [dragging, setDragging] = useState(false);
  const locale = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);

  const [adding, setAdding] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  // The note lives inside MarkdownNoteEditor; mirror it out so a dismissal can tell
  // whether there is unsaved work to protect (#35).
  const [noteText, setNoteText] = useState('');

  const resetForm = () => { setDragProgress(progress); setPickHealth(currentHealth); setNoteError(false); setNoteText(''); };
  const openUpdate = () => { resetForm(); setUpdateOpen(true); };
  const closeUpdate = () => setUpdateOpen(false);

  // Has the open form actually changed anything worth protecting? The needle, the health
  // pick, or a typed note.
  const fieldsDirty = pickHealth !== currentHealth || dragProgress !== progress || noteText.trim() !== '';

  // Detail popup: the log, with UPDATE revealing the form IN PLACE. Opening a second
  // <dialog> over this one would stack scrims and trap focus in the wrong layer, so
  // the form is a mode of this popup, not another modal (§4b). Opening is just
  // navigating DETAIL (a <Link> to `#status-history`, #168) — the hook's hash-listen
  // effect is what actually reacts and opens the popup, the same path a shared/
  // bookmarked URL or browser back/forward already took (nnu — shared with
  // RelationshipScale, which is why `openDetail` below goes unused here but the hook
  // still returns it uniformly). The OverlayDialog owns the body-scroll lock and the
  // box-based light-dismiss now; `canClose` (via `mayDismiss`) makes every dismissal
  // — × / Escape / backdrop — confirm before dropping an in-progress edit (#35).
  //
  // `parseAddressed` is what makes `#status-update-:id` land on ONE entry rather than on
  // the log's top (autoknow-51j) — the same two-member family the partner side already
  // had, now filled in on this side of it.
  const { open: detailOpen, addressed, closeDetail: closePopover, mayDismiss } = useHashAddressablePopover({
    matchesHash: (hash) => !!history && isStatusHash(hash),
    parseAddressed: parseStatusUpdateHash,
    hashToWrite: STATUS_HISTORY_HASH,
    onOpen: resetForm,
    fieldsDirty,
    confirmMessage: t(locale, 'discardUpdateConfirm'),
    deps: [history],
  });
  const closeDetail = () => { setAdding(false); closePopover(); };
  const startAdding = () => { resetForm(); setAdding(true); };

  // One submit path for both the standalone dialog and the inline form.
  const submitUpdate = async (formData: FormData) => {
    // The rich editor's hidden input can't carry native `required` — gate here.
    if (!((formData.get('notes') as string) || '').trim()) { setNoteError(true); return; }
    setNoteError(false);
    setIsSubmitting(true);
    try {
      await updateNeedleStatus(formData);
      setUpdateOpen(false);
      setAdding(false);
    } catch (err) { console.error(err); }
    finally { setIsSubmitting(false); }
  };

  const setFromPointer = (clientX: number, clientY: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const vx = VB_X + ((clientX - rect.left) / rect.width) * VB_W;
    const vy = VB_Y + ((clientY - rect.top) / rect.height) * VB_H;
    let deg = (Math.atan2(CY - vy, vx - CX) * 180) / Math.PI;
    deg = Math.max(A1, Math.min(A0, deg));
    setDragProgress(Math.round(clamp01((A0 - deg) / SWEEP) * 100));
  };

  const viewBox = `${VB_X} ${VB_Y} ${VB_W} ${VB_H}`;

  // The update form's fields, shared verbatim by the standalone dialog and the
  // detail popup's inline mode — one definition, so the two can't drift.
  const formFields = (
    <>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="theNeedle" value={pickHealth} />
      <input type="hidden" name="hillChartProgress" value={dragProgress} />

      <div className={styles.previewContainer} style={{ userSelect: 'none' }}>
        <span className={styles.previewLabel}>{t(locale, 'dragNeedleHint')}</span>
        <svg
          ref={svgRef}
          className={styles.gaugeSvg}
          viewBox={viewBox}
          style={{ cursor: 'pointer', touchAction: 'none', maxWidth: '18.75rem' }}
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); setFromPointer(e.clientX, e.clientY); }}
          onPointerMove={(e) => { if (dragging) setFromPointer(e.clientX, e.clientY); }}
          onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
        >
          <Gauge progress={dragProgress / 100} color={healthColor(pickHealth)} />
        </svg>
        <input
          id="needleProgress"
          aria-label={t(locale, 'programProgressAria')}
          type="range"
          min="0"
          max="100"
          value={dragProgress}
          onChange={(e) => setDragProgress(parseInt(e.target.value))}
          style={{ position: 'absolute', left: '-624.9375rem', width: 10, height: 10, opacity: 0.01 }}
        />

        {/* Health rides INSIDE the gauge's container: picking a colour repaints
            the gauge above it, so the control and its effect are one unit. */}
        <div className={styles.healthPicker}>
          {HEALTHS.map((h) => (
            <button key={h} type="button" onClick={() => setPickHealth(h)} aria-pressed={pickHealth === h} className={styles.healthChip}
              style={{ borderColor: healthColor(h), background: pickHealth === h ? healthColor(h) : 'transparent', color: pickHealth === h ? 'var(--paper)' : healthColor(h) }}>
              {t(locale, healthKey(h))}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.formGroup}>
        <span className={styles.formLabel}>{t(locale, 'updateWhatWhy')}</span>
        <MarkdownNoteEditor name="notes" ariaLabel={t(locale, 'updateWhatWhy')}
          placeholder={t(locale, 'needleNotePlaceholder')} onChange={setNoteText} />
        {noteError && <div style={{ color: 'var(--bad)', fontSize: '0.75rem' }}>{t(locale, 'updateNeedsNote')}</div>}
      </div>
    </>
  );

  // The newest entry is what `updatedAt` already refers to — the note beside the
  // gauge (§4b, #168) has to be the SAME update the gauge itself is showing.
  const newestNote = history?.[0]?.notes;

  return (
    <div className={styles.gaugeWrapper}>
      <div className={styles.gaugeColumn}>
        <div className={styles.gaugeContainer}>
          <svg className={styles.gaugeSvg} viewBox={viewBox} role="img"
            aria-label={t(locale, 'programHealthAria', { health: t(locale, healthKey(currentHealth)) })}>
            {/* The needle's angle states progress and its colour states health — the
                visible "Some Risk" word next to it was the only non-colour carrier of
                health (#168), so removing it moves that fact here instead of dropping
                it: a screen reader gets it from the accessible name, a sighted user
                from hovering (this SVG no longer sits in a pointer-events:none box). */}
            <title>{t(locale, 'programHealthAria', { health: t(locale, healthKey(currentHealth)) })}</title>
            <Gauge progress={progress / 100} color={healthColor(currentHealth)} prevProgress={previousProgress != null ? previousProgress / 100 : null} prevColor={healthColor(previousHealth ?? health)} />
          </svg>
        </div>

        {/* fact · date · action on one line (design.md §7), never a three-line stack.
            Health is now colour-only here (its word lives in the gauge's accessible
            name above, not as a second visible encoding of the same fact). */}
        <div className={styles.statusRow}>
          {/* #171: "is this current" answered as a duration, not a date the reader has
              to subtract by hand — RelativeTime owns the crossover/hydration-safe swap;
              tNodes keeps `{d}`'s slot in the LOCALE's own word order (JA/KO put it
              first) instead of always concatenating "Updated" + the value. */}
          {updatedAt && <span className={styles.updatedAt}>{tNodes(locale, 'updatedOn', { d: <RelativeTime value={updatedAt} /> })}</span>}
          {/* DETAIL only ever changes WHERE you are — it writes `#status-history` and
              nothing else — so it is a link, not a button (design.md §6, #168): a
              plain <Link>, relying on lib/locationHash's pushState patch to notify
              the hash listener below the same way a native <a> or back/forward would. */}
          {history
            ? <Link href={`#${STATUS_HISTORY_HASH}`} replace scroll={false} className={styles.updateBtn}>{t(locale, 'detail')}</Link>
            : editable && <button type="button" onClick={openUpdate} className={styles.updateBtn}>{t(locale, 'update')}</button>}
        </div>
      </div>

      {/* The newest update's note, beside the gauge once the CARD (not the
          viewport) is wide enough — NeedleGauge.module.css hides this entirely
          below that container threshold, where DETAIL remains the only way to
          read it. */}
      {newestNote && (
        <div className={styles.restingNote}><Markdown>{newestNote}</Markdown></div>
      )}

      {/* Detail: the complete log — graphic, health label, author, timestamp, and
          every written note in full. UPDATE reveals the form in place rather than
          opening a second modal over this one. */}
      {history && (
        <OverlayDialog
          open={detailOpen}
          onClose={closeDetail}
          width="56rem"
          dataTestId="needle-detail"
          title={t(locale, 'needleDetailTitle')}
          closeLabel={t(locale, 'close')}
          canClose={() => mayDismiss(adding)}
          // While editing, the form owns its own Cancel/Save — a second dialog-level Close
          // rail would be a duplicate action AND a silent-discard path, so the footer is
          // hidden until the edit is resolved (#35). Its border going with it also drops
          // the popup back to one boundary and reclaims the height a single-entry log needs.
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
              {formFields}
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
          <NeedleHistoryList changes={history} relationship={scope === 'partner'} locale={locale}
            highlightId={addressed} scrollToHighlight={detailOpen}
            emptyLabel={t(locale, 'noUpdatesRecorded')} />
        </OverlayDialog>
      )}

      {/* Standalone update dialog — the path used where there is no history to
          show (e.g. partner scope); the detail popup owns updating otherwise. */}
      <OverlayDialog
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        width="26rem"
        title={t(locale, 'weeklyUpdate')}
        closeLabel={t(locale, 'close')}
        canClose={() => mayDismiss(updateOpen)}
      >
        <form action={submitUpdate} className={styles.dialogForm}>
          {formFields}
          <div className={styles.actionRow}>
            <button type="button" onClick={closeUpdate} disabled={isSubmitting} className={styles.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={isSubmitting} className={styles.submitBtn}>{isSubmitting ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>
    </div>
  );
}
