'use client';

import React, { useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { hillCoordinates, HILL_PATH } from '../lib/geometry';
import styles from './HillChartControl.module.css';

interface HillChartControlProps {
  value: number; // 0 - 100
  onChange?: (val: number) => void;
  className?: string;
}

export default function HillChartControl({ value, onChange, className = '' }: HillChartControlProps) {
  const locale = useLocale();
  const [localVal, setLocalVal] = useState<number>(value);
  const [isDragging, setIsDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Re-sync the local drag value when the parent-controlled value changes — done during
  // render (React's sanctioned prop-derived-state reset), not in an effect.
  const [lastValue, setLastValue] = useState<number>(value);
  if (value !== lastValue) {
    setLastValue(value);
    setLocalVal(value);
  }

  const updateProgressFromCoords = (clientX: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xPercent = (clientX - rect.left) / rect.width;
    let progressVal = Math.round(((xPercent * 200 - 10) / 180) * 100);
    progressVal = Math.max(0, Math.min(100, progressVal));
    setLocalVal(progressVal);
    if (onChange) {
      onChange(progressVal);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateProgressFromCoords(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    updateProgressFromCoords(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    // Guard release so pointerleave-without-capture can't throw InvalidStateError.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
  };

  const commit = (next: number) => {
    const v = Math.max(0, Math.min(100, next));
    setLocalVal(v);
    onChange?.(v);
  };
  // Keyboard operation for the slider — arrows step, Home/End jump. Without this the
  // required progress input in the update dialog is unusable without a mouse.
  const handleKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': e.preventDefault(); commit(localVal + step); break;
      case 'ArrowLeft': case 'ArrowDown': e.preventDefault(); commit(localVal - step); break;
      case 'Home': e.preventDefault(); commit(0); break;
      case 'End': e.preventDefault(); commit(100); break;
    }
  };

  const coords = hillCoordinates(localVal);

  return (
    <div className={`${styles.controlContainer} ${className}`} style={{ userSelect: 'none' }}>
      <svg
        ref={svgRef}
        className={styles.svg}
        viewBox="0 0 200 100"
        role="slider"
        tabIndex={0}
        aria-label={t(locale, 'hillProgressAria')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={localVal}
        aria-valuetext={`${localVal}%`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onKeyDown={handleKeyDown}
        style={{ cursor: 'ew-resize', touchAction: 'none' }}
      >
        <path
          d={HILL_PATH}
          className={styles.hillCurve}
        />
        <line x1="100" y1="10" x2="100" y2="80" stroke="var(--border)" strokeDasharray="3 3" />
        <circle cx={coords.x} cy={coords.y} r="6" className={styles.hillDot} />
        
        {/* Hill Chart Labels */}
        <text x="50" y="94" textAnchor="middle" fontSize="8" fill="var(--muted)" fontWeight="600" letterSpacing="0.02em">{t(locale, 'workingItOut')}</text>
        <text x="150" y="94" textAnchor="middle" fontSize="8" fill="var(--muted)" fontWeight="600" letterSpacing="0.02em">{t(locale, 'gettingItDone')}</text>
      </svg>
    </div>
  );
}
