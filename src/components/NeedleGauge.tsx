'use client';

import React, { useRef, useState } from 'react';
import styles from './NeedleGauge.module.css';
import { updateNeedleStatus } from '../app/actions/needle';
import { HEALTHS, healthColor, parseHealth, type Health } from '../lib/health';

// Program status drawn as a Basecamp-style gauge: a WHITE track (a thick band with a
// thin outline) whose health color fills up to the current progress, with graticules
// held inside the band. A floating NEEDLE marks the position — a flat top curved
// concentric with the gauge, reaching equally inside and outside the arc, with a thin
// white boundary. The previous state is a colored marker, also white-bordered. The
// 0..1 scale is internal only — no numbers are shown.

const CX = 120, CY = 138, R = 116, A0 = 127, A1 = 53;
const SWEEP = A0 - A1; // 74° arc
// The rotation centre (CX,CY) sits far below the arc; the viewBox is cropped tightly to
// just the arc + needle so the graphic is a compact wide/short rectangle (no dead space).
const VB_X = 38, VB_Y = 3, VB_W = 164, VB_H = 60;
const BANDH = 7;        // half the track thickness
const FILL_INSET = 2.6; // gap between the color fill and the track border
const clamp01 = (p: number) => Math.max(0, Math.min(1, p));
const degAt = (p: number) => A0 - clamp01(p) * SWEEP; // p=0 -> left, p=1 -> right
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
};
const ptStr = (o: { x: number; y: number }) => `${o.x.toFixed(1)},${o.y.toFixed(1)}`;
const TICKS = Array.from({ length: 9 }, (_, i) => i / 8); // ticks every 12.5%

// A closed band (ribbon) between R±bandH over a progress range — the track and the fill.
const ribbon = (p0: number, p1: number, bandH: number, steps = 44) => {
  const outer: string[] = [], inner: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = p0 + ((p1 - p0) * i) / steps;
    const d = degAt(t);
    outer.push(ptStr(polar(d, R + bandH)));
    inner.push(ptStr(polar(d, R - bandH)));
  }
  inner.reverse();
  return 'M ' + outer.join(' L ') + ' L ' + inner.join(' L ') + ' Z';
};

// The floating needle: flat top curved concentric with the gauge, convex sides down to
// a soft point, reaching equally inside and outside the arc line R.
const needlePath = (deg: number) => {
  const perp = ((deg + 90) * Math.PI) / 180;
  const px = Math.cos(perp), py = -Math.sin(perp);
  const off = (o: { x: number; y: number }, s: number) => ({ x: o.x + px * s, y: o.y + py * s });
  const d = BANDH * 2, rTop = R + d, rBottom = R - d;
  const hw = BANDH * 1.12; // half-width of the flat top
  const da = (hw / rTop) * (180 / Math.PI); // angular half-width of the curved top
  const top: string[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = deg + da - (2 * da * i) / 12; // curved top, concentric with the gauge
    top.push(ptStr(polar(a, rTop)));
  }
  const pL = off(polar(deg, rBottom + BANDH * 0.35), hw * 0.12);
  const pR = off(polar(deg, rBottom + BANDH * 0.35), -hw * 0.12);
  const tip = polar(deg, rBottom);
  const sideL = polar(deg + da * 1.15, R + d * 0.1), sideR = polar(deg - da * 1.15, R + d * 0.1);
  return `M ${ptStr(pL)} Q ${ptStr(sideL)} ${top[0]} L ${top.slice(1).join(' L ')} Q ${ptStr(sideR)} ${ptStr(pR)} Q ${ptStr(tip)} ${ptStr(pL)} Z`;
};

function Gauge({ progress, color, prevProgress, prevColor }: {
  progress: number; color: string; prevProgress?: number | null; prevColor?: string | null;
}) {
  const p = clamp01(progress);
  const deg = degAt(p);
  const fillH = Math.max(1.5, BANDH - FILL_INSET);
  const cap = { strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

  return (
    <g>
      {/* white track container with a thin outline */}
      <path d={ribbon(0, 1, BANDH)} fill="#ffffff" stroke="var(--border, #d6d6d6)" strokeWidth={1.4} {...cap} />
      {/* graticules held entirely inside the band */}
      {TICKS.map((t, i) => {
        const o = polar(degAt(t), R + BANDH - 1.4);
        const inn = polar(degAt(t), R + BANDH - 1.4 - BANDH * 0.72);
        return <line key={i} x1={o.x} y1={o.y} x2={inn.x} y2={inn.y} stroke="var(--muted, #9a948a)" strokeWidth={1.1} opacity={0.5} />;
      })}
      {/* health color fill, inset so a white margin shows to the border */}
      {p > 0.01 && <path d={ribbon(0, p, fillH)} fill={color} {...cap} />}
      {/* previous-status marker, wrapped in a thin white boundary */}
      {prevProgress != null && (() => {
        const o = polar(degAt(prevProgress), R + BANDH + 2);
        const inn = polar(degAt(prevProgress), R - BANDH - 2);
        return (
          <>
            <line x1={o.x} y1={o.y} x2={inn.x} y2={inn.y} stroke="#fff" strokeWidth={5.4} strokeLinecap="round" />
            <line x1={o.x} y1={o.y} x2={inn.x} y2={inn.y} stroke={prevColor || color} strokeWidth={3} strokeLinecap="round" />
          </>
        );
      })()}
      {/* floating needle with a thin white boundary so it pops off the track */}
      <path d={needlePath(deg)} fill={color} stroke="#fff" strokeWidth={1.8} strokeLinejoin="round" />
    </g>
  );
}

// Display-only gauge (no button, no editor) — used for the compact list/history cards.
// Accepts progress as 0..100 and health/previous as their stored strings.
export function NeedleGaugeSvg({
  progress, health, previousProgress, previousHealth, className,
}: {
  progress: number;
  health: string | null;
  previousProgress?: number | null;
  previousHealth?: string | null;
  className?: string;
}) {
  const h = parseHealth(health);
  return (
    <svg viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`} className={className} style={{ display: 'block', width: '100%', overflow: 'visible' }}>
      <Gauge
        progress={progress / 100}
        color={healthColor(h)}
        prevProgress={previousProgress != null ? previousProgress / 100 : null}
        prevColor={healthColor(previousHealth ?? health)}
      />
    </svg>
  );
}

interface NeedleGaugeProps {
  progress: number; // 0..100
  health: string | null;
  previousProgress?: number | null;
  previousHealth?: string | null;
  updatedAt?: string | null;
  targetId: number;
  scope?: 'project' | 'partner';
  editable?: boolean;
}

export default function NeedleGauge({
  progress, health, previousProgress, previousHealth, updatedAt, targetId, scope = 'project', editable = true,
}: NeedleGaugeProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const currentHealth = parseHealth(health);

  const [dragProgress, setDragProgress] = useState<number>(progress);
  const [pickHealth, setPickHealth] = useState<Health>(currentHealth);
  const [dragging, setDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const open = () => { setDragProgress(progress); setPickHealth(currentHealth); dialogRef.current?.showModal(); };
  const close = () => dialogRef.current?.close();
  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => { if (e.target === dialogRef.current) dialogRef.current?.close(); };

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

  return (
    <div className={styles.gaugeWrapper}>
      <div className={styles.gaugeContainer} style={{ pointerEvents: 'none' }}>
        <svg className={styles.gaugeSvg} viewBox={viewBox}>
          <Gauge progress={progress / 100} color={healthColor(currentHealth)} prevProgress={previousProgress != null ? previousProgress / 100 : null} prevColor={healthColor(previousHealth ?? health)} />
        </svg>
      </div>

      <div className={styles.statusValue} style={{ color: healthColor(currentHealth) }}>{currentHealth}</div>
      {updatedAt && <div className={styles.updatedAt}>Updated {new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>}

      {editable && <button type="button" onClick={open} className={styles.updateBtn}>Update</button>}

      <dialog ref={dialogRef} className={styles.dialog} onClick={onBackdrop}>
        <div className={styles.dialogHeader}><h3>Weekly program update</h3></div>
        <form
          action={async (formData) => {
            setIsSubmitting(true);
            try { await updateNeedleStatus(formData); dialogRef.current?.close(); }
            catch (err) { console.error(err); }
            finally { setIsSubmitting(false); }
          }}
          className={styles.dialogForm}
        >
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="targetId" value={targetId} />
          <input type="hidden" name="theNeedle" value={pickHealth} />
          <input type="hidden" name="hillChartProgress" value={dragProgress} />

          <div className={styles.previewContainer} style={{ userSelect: 'none' }}>
            <span className={styles.previewLabel}>Drag the needle to set progress</span>
            <svg
              ref={svgRef}
              className={styles.gaugeSvg}
              viewBox={viewBox}
              style={{ cursor: 'pointer', touchAction: 'none', maxWidth: 300 }}
              onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); setFromPointer(e.clientX, e.clientY); }}
              onPointerMove={(e) => { if (dragging) setFromPointer(e.clientX, e.clientY); }}
              onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
            >
              <Gauge progress={dragProgress / 100} color={healthColor(pickHealth)} />
            </svg>
            <input
              id="needleProgress"
              aria-label="Program progress"
              type="range"
              min="0"
              max="100"
              value={dragProgress}
              onChange={(e) => setDragProgress(parseInt(e.target.value))}
              style={{ position: 'absolute', left: '-9999px', width: 10, height: 10, opacity: 0.01 }}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Health</label>
            <div className={styles.healthPicker}>
              {HEALTHS.map((h) => (
                <button key={h} type="button" onClick={() => setPickHealth(h)} aria-pressed={pickHealth === h} className={styles.healthChip}
                  style={{ borderColor: healthColor(h), background: pickHealth === h ? healthColor(h) : 'transparent', color: pickHealth === h ? '#fff' : healthColor(h) }}>
                  {h}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="needleNotes" className={styles.formLabel}>Update — what changed &amp; why (markdown)</label>
            <textarea id="needleNotes" name="notes" required rows={5} placeholder={"e.g. **Deploying** first week of cooldown.\n- timesheet widget scoped to recordings\n- one blocker on export"} className={styles.textArea} />
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={close} disabled={isSubmitting} className={styles.cancelBtn}>Cancel</button>
            <button type="submit" disabled={isSubmitting} className={styles.submitBtn}>{isSubmitting ? 'Saving…' : 'Save Update'}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
