'use client';

import ChartLabel from './ChartLabel';
import RelativeTime from './RelativeTime';
import { useRef, useState } from 'react';
import styles from './NeedleGauge.module.css';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import OverlayDialog from './OverlayDialog';
import { t, statusKey } from '../lib/i18n';
import { tNodes } from './tNodes';
import { useLocale } from './LocaleProvider';
import { HILL_PATH, hillCoordinates } from '../lib/geometry';
import { hillStatus, hillStatusColor, phaseColor } from '../lib/phase';
import { updatePhaseHill } from '../app/actions/hill';
import { hillTextWidth, truncateToWidth } from '../lib/hillLayout';

// The top-left caption (#165): the curve starts at (10,80) and does not rise above
// y≈21 before x≈79 at ANY progress, so a caption anchored at (10,14) is clear of the
// curve itself out to this static budget regardless of which history entry it names —
// "top-left" is a well-defined position on the figure, not a guess (design.md's
// semantic-overlay ADR: a label on the FIGURE is fine here precisely because no ink
// meaning something can ever occupy this corner by construction).
//
// The curve is not the only thing that can be near there, though — the DOT is drawn
// wherever `progress` puts it, and a mid-progress dot (climbing toward the crest) sits
// well inside this same corner. `captionWidth` below clips the budget to clear the
// nearer of the current/previous dot (plus its own radius) whenever either is up in
// the caption's band, so the caption never overlaps a MARK the way #161 forbids two
// labels overlapping each other. A dot always renders; a caption that has nowhere left
// to go is dropped instead — the same trade layoutHill already makes for phase labels.
const CAPTION_X = 10;
const CAPTION_Y = 14;
// Exported so tests/hillHistoryCaption.test.tsx can pin the truncation contract to
// the same number this component actually draws against, rather than a copy.
export const CAPTION_MAX_WIDTH = 60;
// A dot below this y (further down the hill, away from the crest) can never reach the
// caption's band no matter its x — see the derivation above.
const CAPTION_THREAT_Y = 45;
const CAPTION_DOT_GAP = 3;

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
  inkScale = 1,
  caption,
}: {
  progress: number; // 0..100
  previousProgress?: number | null;
  color: string; // the phase's own color
  label?: string; // tooltip on hover (e.g. the phase name + status)
  className?: string;
  axisLabels?: { left: string; right: string } | null; // null hides the axis text
  /** Who/when this reading is, set in the structurally-empty top-left corner
   *  (#165) — a history entry's identity. Truncated here (not by the caller) to
   *  `CAPTION_MAX_WIDTH` at the current `inkScale`, so the one component that
   *  owns the safe box also owns keeping text inside it. Absent on the
   *  live/editable gauge, which states its date in the status row instead. */
  caption?: string | null;
  /** Same fix as PhaseHillChart's INK_SCALE (#164, design.md §8c): this gauge is
   *  reused at wildly different container widths (a full status card, a history
   *  thumbnail, a feed teaser), and `--status-viz-w` (≈260px) is the width the
   *  authored `1` numbers below were tuned against. A caller in a narrower box
   *  passes a larger factor so type and coins land at the same rendered size
   *  instead of shrinking with the container. Hairlines skip it (non-scaling-stroke
   *  already holds those at 1px); text and coin-shaped ink do not, so they take
   *  this multiplier the same way PhaseHillChart's do. */
  inkScale?: number;
}) {
  const locale = useLocale();
  const labels = axisLabels === null ? null
    : axisLabels ?? { left: t(locale, 'figuringItOut'), right: t(locale, 'makingItHappen') };
  const cur = hillCoordinates(progress);
  const prev = previousProgress != null ? hillCoordinates(previousProgress) : null;

  // See the constants above for the derivation: only a dot up in the caption's band
  // (CAPTION_THREAT_Y) can ever reach it, and only the nearer of the two matters.
  const threatX = [cur, ...(prev ? [prev] : [])]
    .filter((p) => p.y < CAPTION_THREAT_Y)
    .reduce((min, p) => Math.min(min, p.x), Infinity);
  const captionWidth = Math.min(CAPTION_MAX_WIDTH, threatX - (6 * inkScale + CAPTION_DOT_GAP) - CAPTION_X);
  const captionText = caption ? truncateToWidth(caption, 8 * inkScale, captionWidth) : null;
  // A caption with nowhere left to go is dropped, not squeezed to an ellipsis alone —
  // the same call layoutHill makes for a phase label that cannot find a slot.
  const showCaption = captionText && captionWidth >= hillTextWidth('…', 8 * inkScale);

  return (
    <svg viewBox={VIEWBOX} className={className} style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }} role="img" aria-label="Phase progress on the hill">
      {/* Instrument style only (revealed by CSS in globals.css — rendered by both
          styles so no hill has to read a theme in JS). Two additions, both quiet:
          a GROOVE, a wider faint stroke under the curve so the hill reads as a
          machined channel the dot travels in rather than a drawn line; and a
          BASELINE GRATICULE, ticks at each quarter of the run, which is the same
          scale the phase's progress is judged on. Nothing here moves the curve or
          the dot — only the surface they sit on. */}
      <path
        data-inst-only
        d={HILL_PATH}
        fill="none"
        stroke="var(--fg)"
        strokeOpacity={0.07}
        strokeWidth={9 * inkScale}
        strokeLinecap="round"
      />
      {/* Hairlines carry `non-scaling-stroke` here for the same reason as the wide
          summary hill (PhaseHillChart, #154): this gauge renders at --status-viz-w in
          a phase row but much narrower in a feed teaser, and a tick authored at 1 unit
          goes sub-pixel there. The pair stays one drawing. */}
      {/* non-scaling-stroke is NOT inherited — hence the repeat on every child. */}
      <g data-inst-only stroke="var(--border)" strokeWidth={1} strokeLinecap="round">
        <line x1={10} y1={84} x2={190} y2={84} strokeOpacity={0.55} vectorEffect="non-scaling-stroke" />
        {[10, 55, 100, 145, 190].map((x) => (
          <line key={x} x1={x} y1={84} x2={x} y2={x === 100 ? 78 : 80.5} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <path d={HILL_PATH} fill="none" stroke="var(--border, #d9d5c8)" strokeWidth={2.5 * inkScale} strokeLinecap="round" />
      <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border, #e3e0d6)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      {prev && <circle cx={prev.x} cy={prev.y} r={4.5 * inkScale} fill="var(--paper)" stroke={color} strokeWidth={2 * inkScale} />}
      <circle cx={cur.x} cy={cur.y} r={6 * inkScale} fill={color} stroke="var(--paper)" strokeWidth={1.6} vectorEffect="non-scaling-stroke">
        {label && <title>{label}</title>}
      </circle>
      {labels && (
        <>
          <ChartLabel x={50} y={99} textAnchor="middle" fontSize={8 * inkScale} fill="var(--muted, #888)">{labels.left}</ChartLabel>
          <ChartLabel x={150} y={99} textAnchor="middle" fontSize={8 * inkScale} fill="var(--muted, #888)">{labels.right}</ChartLabel>
        </>
      )}
      {showCaption && (
        <ChartLabel x={CAPTION_X} y={CAPTION_Y} textAnchor="start" fontSize={8 * inkScale} fill="var(--muted, #888)">
          {captionText}
        </ChartLabel>
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState(progress);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);

  const open = () => { setDrag(progress); setNoteError(false); setDialogOpen(true); };
  const close = () => setDialogOpen(false);

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

      {/* fact · date · action on one line (design.md §7), never a three-line stack */}
      {(showStatus || updatedAt || editable) && (
        <div className={styles.statusRow}>
          {showStatus && <span className={styles.statusValue} style={{ color: hillStatusColor(progress) }}>{statusText(progress)}</span>}
          {/* #171: a duration, not a date the reader subtracts by hand — see NeedleGauge's
              identical conversion for why tNodes (not t()) carries the value here. */}
          {updatedAt && <span className={styles.updatedAt}>{tNodes(locale, 'updatedOn', { d: <RelativeTime value={updatedAt} /> })}</span>}
          {editable && <button type="button" onClick={open} className={styles.updateBtn}>{strings.update}</button>}
        </div>
      )}

      <OverlayDialog open={dialogOpen} onClose={() => setDialogOpen(false)} width="26rem"
        title={strings.dialogTitle} closeLabel={t(locale, 'close')}>
        <form
          action={async (formData) => {
            // updatePhaseHill requires a note — gate client-side (hidden input has no
            // native `required`).
            if (!((formData.get('notes') as string) || '').trim()) { setNoteError(true); return; }
            setNoteError(false);
            setSubmitting(true);
            try { await updatePhaseHill(formData); setDialogOpen(false); }
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
              style={{ cursor: 'ew-resize', touchAction: 'none', maxWidth: '20rem' }}
              onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); fromX(e.clientX); }}
              onPointerMove={(e) => { if (dragging) fromX(e.clientX); }}
              onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
            >
              <path d={HILL_PATH} fill="none" stroke="var(--border, #d9d5c8)" strokeWidth={2.5} strokeLinecap="round" />
              <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border, #e3e0d6)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              <circle cx={dot.x} cy={dot.y} r={6} fill={color} stroke="var(--paper)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" style={{ transition: dragging ? 'none' : 'cx 0.15s, cy 0.15s' }} />
              <ChartLabel x={50} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">{axisLabels.left}</ChartLabel>
              <ChartLabel x={150} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">{axisLabels.right}</ChartLabel>
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
              style={{ position: 'absolute', left: '-624.9375rem', width: 10, height: 10, opacity: 0.01 }}
            />
          </div>

          <div className={styles.formGroup}>
            <span className={styles.formLabel}>{strings.noteFieldLabel}</span>
            <MarkdownNoteEditor name="notes" ariaLabel={strings.noteFieldLabel}
              placeholder={strings.notePlaceholder} />
            {noteError && <div style={{ color: 'var(--bad)', fontSize: '0.75rem' }}>{t(locale, 'noteRequired')}</div>}
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={close} disabled={submitting} className={styles.cancelBtn}>{strings.cancel}</button>
            <button type="submit" disabled={submitting} className={styles.submitBtn}>{submitting ? strings.saving : strings.save}</button>
          </div>
        </form>
      </OverlayDialog>
    </div>
  );
}
