'use client';

import React, { useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './HillChartControl.module.css';

interface HillChartControlProps {
  value: number; // 0 - 100
  onChange?: (val: number) => void;
  className?: string;
}

function getHillCoordinates(progress: number) {
  if (progress <= 50) {
    const t = progress / 50;
    const x = Math.pow(1 - t, 3) * 10 + 3 * Math.pow(1 - t, 2) * t * 50 + 3 * (1 - t) * Math.pow(t, 2) * 70 + Math.pow(t, 3) * 100;
    const y = Math.pow(1 - t, 3) * 80 + 3 * Math.pow(1 - t, 2) * t * 80 + 3 * (1 - t) * Math.pow(t, 2) * 10 + Math.pow(t, 3) * 10;
    return { x, y };
  } else {
    const t = (progress - 50) / 50;
    const x = Math.pow(1 - t, 3) * 100 + 3 * Math.pow(1 - t, 2) * t * 130 + 3 * (1 - t) * Math.pow(t, 2) * 150 + Math.pow(t, 3) * 190;
    const y = Math.pow(1 - t, 3) * 10 + 3 * Math.pow(1 - t, 2) * t * 10 + 3 * (1 - t) * Math.pow(t, 2) * 80 + Math.pow(t, 3) * 80;
    return { x, y };
  }
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

  const coords = getHillCoordinates(localVal);

  return (
    <div className={`${styles.controlContainer} ${className}`} style={{ userSelect: 'none' }}>
      <svg
        ref={svgRef}
        className={styles.svg}
        viewBox="0 0 200 100"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ cursor: 'ew-resize', touchAction: 'none' }}
      >
        <path
          d="M 10 80 C 50 80, 70 10, 100 10 C 130 10, 150 80, 190 80"
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
