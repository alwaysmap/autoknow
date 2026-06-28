'use client';

import React, { useRef, useState } from 'react';
import styles from './NeedleGauge.module.css';
import { updateNeedleStatus } from '../app/actions/needle';
import { parseNeedleValue, getNeedleLabel } from '../lib/needle';

interface NeedleGaugeProps {
  value: string | number; // Category string ('Low' | 'Medium' | 'High' | 'Critical') or float string/number (0.0 - 1.0)
  scope: 'project' | 'partner' | 'phase' | 'filter';
  targetId?: number;
  hillChartProgress?: number;
  notesLabel?: string;
  className?: string;
  onChange?: (val: string) => void;
}

export default function NeedleGauge({
  value,
  scope,
  targetId = 0,
  hillChartProgress = 0,
  notesLabel = 'Notes on risk status',
  className = '',
  onChange
}: NeedleGaugeProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  
  const initialValue = parseNeedleValue(value);
  const [dragValue, setDragValue] = useState<number>(initialValue);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Map values to angles for the shallow narrow-sweep gauge
  const maxSweepAngle = 51.8;
  const currentAngle = -maxSweepAngle + (initialValue * 2 * maxSweepAngle);
  const previewAngle = -maxSweepAngle + (dragValue * 2 * maxSweepAngle);

  const handleOpen = () => {
    setDragValue(initialValue);
    dialogRef.current?.showModal();
  };

  const handleClose = () => {
    dialogRef.current?.close();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  };

  // Drag calculation from screen coordinates to normalized float value (0.0 - 1.0)
  const updateValueFromCoords = (clientX: number, clientY: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    
    // The pivot point of the needle in view coordinates is at x=50% and y=105/52 of the SVG height.
    const pivotX = rect.left + rect.width / 2;
    const pivotY = rect.top + (rect.height * 105) / 52;
    
    const dx = clientX - pivotX;
    const dy = clientY - pivotY;
    
    // Calculate angle relative to vertical top (dy is negative above the pivot)
    const angleRad = Math.atan2(dx, -dy);
    const angleDeg = (angleRad * 180) / Math.PI;
    
    // Map -maxSweepAngle (0.0) to +maxSweepAngle (1.0)
    let val = (angleDeg + maxSweepAngle) / (2 * maxSweepAngle);
    val = Math.max(0.0, Math.min(1.0, val));
    setDragValue(val);
    if (scope === 'filter' && onChange) {
      onChange(getNeedleLabel(val));
    }
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateValueFromCoords(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    updateValueFromCoords(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  const currentLabel = getNeedleLabel(initialValue);

  if (scope === 'filter') {
    const filterAngle = -maxSweepAngle + (dragValue * 2 * maxSweepAngle);
    return (
      <div className={`${styles.gaugeWrapper} ${className}`} style={{ userSelect: 'none' }}>
        <div className={styles.gaugeContainer}>
          <svg
            ref={svgRef}
            className={styles.gaugeSvg}
            viewBox="0 0 200 80"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{
              cursor: 'ew-resize',
              touchAction: 'none',
              maxWidth: '240px',
              height: '78px',
              overflow: 'hidden'
            }}
          >
            <defs>
              <linearGradient id="needleGradFilter" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="33%" stopColor="#fce8e6" />
                <stop offset="66%" stopColor="#c5221f" />
                <stop offset="100%" stopColor="#a50e0d" />
              </linearGradient>
            </defs>
            <path
              d="M 20 42 A 101.789 101.789 0 0 1 180 42"
              fill="none"
              stroke="url(#needleGradFilter)"
              strokeWidth="8"
              strokeLinecap="round"
              filter="drop-shadow(0px 2px 6px rgba(0,0,0,0.6))"
            />

            <circle cx="100" cy="105" r="5" fill="#333" />
            <g style={{
              transform: `rotate(${filterAngle}deg)`,
              transformOrigin: '100px 105px',
              transition: isDragging ? 'none' : 'transform 0.2s ease-out'
            }}>
              <polygon points="98,105 100,12 102,105" fill="#333" />
              <circle cx="100" cy="12" r="3.5" fill="#333" />
            </g>
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.gaugeWrapper} ${className}`}>
      <div className={styles.gaugeContainer} style={{ pointerEvents: 'none', overflow: 'hidden' }}>
        <svg className={styles.gaugeSvg} viewBox="0 0 200 80" style={{ height: '78px', overflow: 'hidden' }}>
          <defs>
            <linearGradient id="needleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="33%" stopColor="#fce8e6" />
              <stop offset="66%" stopColor="#c5221f" />
              <stop offset="100%" stopColor="#a50e0d" />
            </linearGradient>
          </defs>

          {/* Shallow baseline arc */}
          <path
            d="M 20 42 A 101.789 101.789 0 0 1 180 42"
            fill="none"
            stroke="url(#needleGrad)"
            strokeWidth="8"
            strokeLinecap="round"
            filter="drop-shadow(0px 2px 6px rgba(0,0,0,0.6))"
          />

          {/* Pivot anchor */}
          <circle cx="100" cy="105" r="5" fill="#333" />

          {/* Dynamic sweeping needle indicator */}
          <g style={{ transform: `rotate(${currentAngle}deg)`, transformOrigin: '100px 105px', transition: 'transform 0.5s ease-out' }}>
            <polygon points="98,105 100,12 102,105" fill="#333" />
            <circle cx="100" cy="12" r="3.5" fill="#333" />
          </g>
        </svg>
      </div>

      <div className={styles.statusValue}>{currentLabel}</div>

      <button type="button" onClick={handleOpen} className={styles.updateBtn}>
        Update Needle
      </button>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClick={handleBackdropClick}
      >
        <div className={styles.dialogHeader}>
          <h3>Update Relationship Needle</h3>
        </div>

        <form
          action={async (formData) => {
            setIsSubmitting(true);
            try {
              await updateNeedleStatus(formData);
              dialogRef.current?.close();
            } catch (err) {
              console.error(err);
            } finally {
              setIsSubmitting(false);
            }
          }}
          className={styles.dialogForm}
        >
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="targetId" value={targetId} />
          <input type="hidden" name="theNeedle" value={dragValue.toFixed(2)} />
          <input type="hidden" name="hillChartProgress" value={hillChartProgress} />

          {/* Draggable Needle Visual Gauge Card */}
          <div
            className={styles.previewContainer}
            style={{ padding: '24px 16px', userSelect: 'none' }}
          >
            <span className={styles.previewLabel} style={{ marginBottom: '16px' }}>
              Drag the needle directly to adjust risk level
            </span>
            <svg
              ref={svgRef}
              className={styles.gaugeSvg}
              viewBox="0 0 200 80"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              style={{
                cursor: 'ew-resize',
                touchAction: 'none',
                maxWidth: '240px',
                height: '78px',
                overflow: 'hidden'
              }}
            >
              <path
                d="M 20 42 A 101.789 101.789 0 0 1 180 42"
                fill="none"
                stroke="url(#needleGrad)"
                strokeWidth="8"
                strokeLinecap="round"
                filter="drop-shadow(0px 2px 6px rgba(0,0,0,0.6))"
              />
              <circle cx="100" cy="105" r="5" fill="#333" />
              <g style={{
                transform: `rotate(${previewAngle}deg)`,
                transformOrigin: '100px 105px',
                transition: isDragging ? 'none' : 'transform 0.2s ease-out'
              }}>
                <polygon points="98,105 100,12 102,105" fill="#333" />
                <circle cx="100" cy="12" r="3.5" fill="#333" />
              </g>
            </svg>

            {/* Hidden range input to maintain Playwright E2E automation compatibility */}
            <input
              id="needleSlider"
              type="range"
              min="0.00"
              max="1.00"
              step="0.01"
              value={dragValue.toFixed(2)}
              onChange={(e) => setDragValue(parseFloat(e.target.value))}
              style={{
                position: 'absolute',
                left: '-9999px',
                top: '-9999px',
                width: '10px',
                height: '10px',
                opacity: 0.01
              }}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="needleNotes" className={styles.formLabel}>{notesLabel}</label>
            <textarea
              id="needleNotes"
              name="notes"
              required
              placeholder="Provide a mandatory status summary note (e.g. why is risk level changing?)"
              className={styles.textArea}
            />
          </div>

          <div className={styles.actionRow}>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className={styles.cancelBtn}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={styles.submitBtn}
            >
              {isSubmitting ? 'Saving...' : 'Save Update'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
