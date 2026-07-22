'use client';

import React, { useEffect, useRef, useState } from 'react';
import styles from './NeedleGauge.module.css';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import NeedleHistoryList from './NeedleHistoryList';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { updateNeedleStatus } from '../app/actions/needle';
import { HEALTHS, healthColor, healthKey, parseHealth, type Health } from '../lib/health';
import { localDate } from '../lib/dates';
import type { NeedleChange } from '../lib/history';
import { CX, CY, A0, A1, SWEEP, VB_X, VB_Y, VB_W, VB_H, clamp01, Gauge, NeedleGaugeSvg } from './NeedleGaugeSvg';

/** Deep-link fragment: /programs/:id#status-history opens the log. */
export const STATUS_HISTORY_HASH = 'status-history';

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const historyRef = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const currentHealth = parseHealth(health);

  const [dragProgress, setDragProgress] = useState<number>(progress);
  const [pickHealth, setPickHealth] = useState<Health>(currentHealth);
  const [dragging, setDragging] = useState(false);
  const locale = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);

  const [adding, setAdding] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const resetForm = () => { setDragProgress(progress); setPickHealth(currentHealth); setNoteError(false); };
  const open = () => { resetForm(); dialogRef.current?.showModal(); };
  const close = () => dialogRef.current?.close();
  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => { if (e.target === dialogRef.current) dialogRef.current?.close(); };

  // Detail popup: the log, with UPDATE revealing the form IN PLACE. Opening a
  // second <dialog> over this one would stack scrims and trap focus in the
  // wrong layer, so the form is a mode of this popup, not another modal.
  // Opening also writes the hash, so the open popup IS a shareable URL.
  const openDetail = () => {
    resetForm();
    setAdding(false);
    setDetailOpen(true);
    historyRef.current?.showModal();
    if (window.location.hash !== `#${STATUS_HISTORY_HASH}`) {
      window.history.replaceState(null, '', `#${STATUS_HISTORY_HASH}`);
    }
  };
  const closeDetail = () => {
    setAdding(false);
    setDetailOpen(false);
    historyRef.current?.close();
    if (window.location.hash === `#${STATUS_HISTORY_HASH}`) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };
  const startAdding = () => { resetForm(); setAdding(true); };
  // A <dialog>'s own padding ring reports the dialog as the click target, so
  // "target === dialog" treats a click just inside the edge as a backdrop click
  // and closes it — losing an in-progress update. Compare against the dialog's
  // box instead, and never dismiss while the form is open: a half-typed note
  // must not vanish to a stray click.
  const onDetailBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (adding || e.target !== historyRef.current) return;
    const r = historyRef.current.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside) closeDetail();
  };

  // One submit path for both the standalone dialog and the inline form.
  const submitUpdate = async (formData: FormData) => {
    // The rich editor's hidden input can't carry native `required` — gate here.
    if (!((formData.get('notes') as string) || '').trim()) { setNoteError(true); return; }
    setNoteError(false);
    setIsSubmitting(true);
    try {
      await updateNeedleStatus(formData);
      dialogRef.current?.close();
      setAdding(false);
    } catch (err) { console.error(err); }
    finally { setIsSubmitting(false); }
  };

  // Deep link: /programs/:id#status-history opens the log directly, so the URL
  // can be shared. Runs once per mount and on in-page hash changes.
  useEffect(() => {
    if (!history) return;
    const openIfHashed = () => {
      if (window.location.hash === `#${STATUS_HISTORY_HASH}` && !historyRef.current?.open) {
        resetForm();
        setAdding(false);
        setDetailOpen(true);
        historyRef.current?.showModal();
      }
    };
    openIfHashed();
    window.addEventListener('hashchange', openIfHashed);
    return () => window.removeEventListener('hashchange', openIfHashed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  // A modal owns the viewport: the page behind must not scroll under the scrim
  // (the log scrolls inside the popup instead). Same rule as PhaseTrack's
  // details popover.
  useEffect(() => {
    if (!detailOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [detailOpen]);

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
          placeholder={t(locale, 'needleNotePlaceholder')} />
        {noteError && <div style={{ color: 'var(--bad)', fontSize: '0.75rem' }}>{t(locale, 'updateNeedsNote')}</div>}
      </div>
    </>
  );

  return (
    <div className={styles.gaugeWrapper}>
      <div className={styles.gaugeContainer} style={{ pointerEvents: 'none' }}>
        <svg className={styles.gaugeSvg} viewBox={viewBox}>
          <Gauge progress={progress / 100} color={healthColor(currentHealth)} prevProgress={previousProgress != null ? previousProgress / 100 : null} prevColor={healthColor(previousHealth ?? health)} />
        </svg>
      </div>

      {/* fact · date · action on one line (design.md §7), never a three-line stack */}
      <div className={styles.statusRow}>
        <span className={styles.statusValue} style={{ color: healthColor(currentHealth) }}>{t(locale, healthKey(currentHealth))}</span>
        {updatedAt && <span className={styles.updatedAt}>{t(locale, 'updatedOn', { d: localDate(updatedAt, locale, { month: 'short', day: 'numeric' }) })}</span>}
        {/* graphic · date · DETAIL. Updating happens inside the detail popup, so
            the resting row states the fact and offers one way in. */}
        {history
          ? <button type="button" onClick={openDetail} className={styles.updateBtn}>{t(locale, 'detail')}</button>
          : editable && <button type="button" onClick={open} className={styles.updateBtn}>{t(locale, 'update')}</button>}
      </div>

      {/* Detail: the complete log — graphic, health label, author, timestamp, and
          the written note in full (it feeds the AI briefing and is deliberately
          absent beside the gauge). UPDATE reveals the form in place rather than
          opening a second modal over this one. */}
      {history && (
        <dialog ref={historyRef} data-testid="needle-detail" className={styles.historyDialog}
          onClick={onDetailBackdrop} onClose={closeDetail}>
          <div className={styles.dialogHeader}><h3>{t(locale, 'needleDetailTitle')}</h3></div>

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

          <div className={styles.historyScroll}>
            <NeedleHistoryList changes={history} relationship={scope === 'partner'} locale={locale}
              emptyLabel={t(locale, 'noUpdatesRecorded')} />
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={closeDetail} className={styles.cancelBtn}>
              {t(locale, 'close')}
            </button>
            {editable && !adding && (
              <button type="button" onClick={startAdding} className={styles.submitBtn}>
                {t(locale, 'update')}
              </button>
            )}
          </div>
        </dialog>
      )}

      {/* Standalone update dialog — the path used where there is no history to
          show (e.g. partner scope); the detail popup owns updating otherwise. */}
      <dialog ref={dialogRef} className={styles.dialog} onClick={onBackdrop}>
        <div className={styles.dialogHeader}><h3>{t(locale, 'weeklyUpdate')}</h3></div>
        <form action={submitUpdate} className={styles.dialogForm}>
          {formFields}
          <div className={styles.actionRow}>
            <button type="button" onClick={close} disabled={isSubmitting} className={styles.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={isSubmitting} className={styles.submitBtn}>{isSubmitting ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
