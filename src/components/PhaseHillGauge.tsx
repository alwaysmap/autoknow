'use client';

import React, { useRef, useState } from 'react';
import styles from './NeedleGauge.module.css';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import { t, statusKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { HILL_PATH, hillCoordinates } from '../lib/geometry';
import { hillStatus, hillStatusColor, phaseColor } from '../lib/phase';
import { updatePhaseHill } from '../app/actions/hill';

// The hill-chart analogue of the needle: task progress for a SINGLE phase. A display-only
// SVG (the bell curve + a dot at progress, plus a ghost dot for the previous update) and
// an editable card whose UPDATE dialog just moves the dot + an optional note. Status is
// inferred from the dot position (0 Not Started, 100 Done, between In Progress) — there is
// no picker. 0..100 is internal only — no number is ever shown.

const VIEWBOX = '0 0 200 104';

// UI strings, overridable for i18n (see lib/i18n). Defaults preserve the
// original English so existing call sites are untouched.
export interface HillGaugeStrings {
  figuringItOut: string;
  makingItHappen: string;
  update: string;
  dialogTitle: string;
  dragHint: string;
  noteFieldLabel: string;
  notePlaceholder: string;
  cancel: string;
  save: string;
  saving: string;
  statusText?: (progress: number) => string;
}



export function PhaseHillSvg({
  progress,
  previousProgress,
  color,
  label,
  className,
  axisLabels,
}: {
  progress: number; // 0..100
  previousProgress?: number | null;
  color: string; // the phase's own color
  label?: string; // tooltip on hover (e.g. the phase name + status)
  className?: string;
  axisLabels?: { left: string; right: string } | null; // null hides the axis text
}) {
  const locale = useLocale();
  const labels = axisLabels === null ? null
    : axisLabels ?? { left: t(locale, 'figuringItOut'), right: t(locale, 'makingItHappen') };
  const cur = hillCoordinates(progress);
  const prev = previousProgress != null ? hillCoordinates(previousProgress) : null;
  return (
    <svg viewBox={VIEWBOX} className={className} style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }} role="img" aria-label="Phase progress on the hill">
      <path d={HILL_PATH} fill="none" stroke="var(--border, #d9d5c8)" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border, #e3e0d6)" strokeDasharray="3 3" />
      {prev && <circle cx={prev.x} cy={prev.y} r={4.5} fill="#fff" stroke={color} strokeWidth={2} />}
      <circle cx={cur.x} cy={cur.y} r={6} fill={color} stroke="#fff" strokeWidth={1.6}>
        {label && <title>{label}</title>}
      </circle>
      {labels && (
        <>
          <text x={50} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">{labels.left}</text>
          <text x={150} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">{labels.right}</text>
        </>
      )}
    </svg>
  );
}

interface PhaseHillGaugeProps {
  phaseId: number;
  projectId: number;
  progress: number; // 0..100
  previousProgress?: number | null;
  updatedAt?: string | null;
  phaseName?: string;
  editable?: boolean;
  showStatus?: boolean; // hide when the surrounding row already states it
  color?: string; // override the phase palette (e.g. neutral ink on the track view)
  strings?: HillGaugeStrings; // i18n overrides; defaults to English
}

export default function PhaseHillGauge({
  phaseId, projectId, progress, previousProgress, updatedAt, phaseName, editable = true, showStatus = true,
  color: colorProp, strings: stringsProp,
}: PhaseHillGaugeProps) {
  const locale = useLocale();
  // Defaults come from the app-wide catalog; explicit `strings` still override.
  const strings: HillGaugeStrings = stringsProp ?? {
    figuringItOut: t(locale, 'figuringItOut'),
    makingItHappen: t(locale, 'makingItHappen'),
    update: t(locale, 'update'),
    dialogTitle: t(locale, 'dialogTitle'),
    dragHint: t(locale, 'dragHint'),
    noteFieldLabel: t(locale, 'noteFieldLabel'),
    notePlaceholder: t(locale, 'notePlaceholder'),
    cancel: t(locale, 'cancel'),
    save: t(locale, 'save'),
    saving: t(locale, 'saving'),
    statusText: (p: number) => t(locale, statusKey(p)),
  };
  const color = colorProp ?? phaseColor(phaseId);
  const statusText = strings.statusText ?? hillStatus;
  const axisLabels = { left: strings.figuringItOut, right: strings.makingItHappen };
  const dialogRef = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState(progress);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);

  const open = () => { setDrag(progress); setNoteError(false); dialogRef.current?.showModal(); };
  const close = () => dialogRef.current?.close();
  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => { if (e.target === dialogRef.current) dialogRef.current?.close(); };

  const fromX = (clientX: number) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const xv = ((clientX - r.left) / r.width) * 200;
    setDrag(Math.round(Math.max(0, Math.min(100, ((xv - 10) / 180) * 100))));
  };

  const dot = hillCoordinates(drag);

  return (
    <div className={styles.gaugeWrapper}>
      <div className={styles.gaugeContainer} style={{ pointerEvents: 'none' }}>
        <PhaseHillSvg
          progress={progress}
          previousProgress={previousProgress}
          color={color}
          label={phaseName ? `${phaseName} — ${statusText(progress)}` : undefined}
          className={styles.gaugeSvg}
          axisLabels={axisLabels}
        />
      </div>

      {showStatus && <div className={styles.statusValue} style={{ color: hillStatusColor(progress) }}>{statusText(progress)}</div>}
      {updatedAt && <div className={styles.updatedAt}>{t(locale, 'updatedOn', { d: new Date(updatedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) })}</div>}

      {editable && <button type="button" onClick={open} className={styles.updateBtn}>{strings.update}</button>}

      <dialog ref={dialogRef} className={styles.dialog} onClick={onBackdrop}>
        <div className={styles.dialogHeader}><h3>{strings.dialogTitle}</h3></div>
        <form
          action={async (formData) => {
            // updatePhaseHill requires a note — gate client-side (hidden input has no
            // native `required`).
            if (!((formData.get('notes') as string) || '').trim()) { setNoteError(true); return; }
            setNoteError(false);
            setSubmitting(true);
            try { await updatePhaseHill(formData); dialogRef.current?.close(); }
            catch (err) { console.error(err); }
            finally { setSubmitting(false); }
          }}
          className={styles.dialogForm}
        >
          <input type="hidden" name="phaseId" value={phaseId} />
          <input type="hidden" name="projectId" value={projectId} />

          <div className={styles.previewContainer} style={{ userSelect: 'none' }}>
            <span className={styles.previewLabel}>{strings.dragHint} · {statusText(drag)}</span>
            <svg
              ref={svgRef}
              viewBox={VIEWBOX}
              className={styles.gaugeSvg}
              style={{ cursor: 'ew-resize', touchAction: 'none', maxWidth: 320 }}
              onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); fromX(e.clientX); }}
              onPointerMove={(e) => { if (dragging) fromX(e.clientX); }}
              onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
            >
              <path d={HILL_PATH} fill="none" stroke="var(--border, #d9d5c8)" strokeWidth={2.5} strokeLinecap="round" />
              <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border, #e3e0d6)" strokeDasharray="3 3" />
              <circle cx={dot.x} cy={dot.y} r={6} fill={color} stroke="#fff" strokeWidth={1.6} style={{ transition: dragging ? 'none' : 'cx 0.15s, cy 0.15s' }} />
              <text x={50} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">{axisLabels.left}</text>
              <text x={150} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">{axisLabels.right}</text>
            </svg>
            <input
              id={`phaseHillProgress-${phaseId}`}
              aria-label={strings.dialogTitle}
              type="range"
              min="0"
              max="100"
              name="hillChartProgress"
              value={drag}
              onChange={(e) => setDrag(parseInt(e.target.value))}
              style={{ position: 'absolute', left: '-9999px', width: 10, height: 10, opacity: 0.01 }}
            />
          </div>

          <div className={styles.formGroup}>
            <span className={styles.formLabel}>{strings.noteFieldLabel}</span>
            <MarkdownNoteEditor name="notes" ariaLabel={strings.noteFieldLabel}
              placeholder={strings.notePlaceholder} />
            {noteError && <div style={{ color: '#c5221f', fontSize: 12 }}>{t(locale, 'noteRequired')}</div>}
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={close} disabled={submitting} className={styles.cancelBtn}>{strings.cancel}</button>
            <button type="submit" disabled={submitting} className={styles.submitBtn}>{submitting ? strings.saving : strings.save}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
