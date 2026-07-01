'use client';

import { useRef, useState } from 'react';
import { HILL_PATH, hillCoordinates } from '../lib/geometry';

// Drag-to-set phase progress on the hill. The value is submitted via an off-screen
// range input (also keeps E2E automation working); no number is ever shown to the user.

export default function PhaseHillInput({
  name = 'hillChartProgress',
  defaultProgress = 0,
}: {
  name?: string;
  defaultProgress?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [p, setP] = useState(defaultProgress);
  const [dragging, setDragging] = useState(false);

  const fromX = (clientX: number) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const xv = ((clientX - r.left) / r.width) * 200;
    setP(Math.round(Math.max(0, Math.min(100, ((xv - 10) / 180) * 100))));
  };

  const { x, y } = hillCoordinates(p);

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox="0 0 200 104"
        style={{ width: '100%', maxWidth: 240, height: 'auto', cursor: 'ew-resize', touchAction: 'none' }}
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); fromX(e.clientX); }}
        onPointerMove={(e) => { if (dragging) fromX(e.clientX); }}
        onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
      >
        <path d={HILL_PATH} fill="none" stroke="var(--border, #d9d5c8)" strokeWidth={2.5} strokeLinecap="round" />
        <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border, #e3e0d6)" strokeDasharray="3 3" />
        <circle cx={x} cy={y} r={6} fill="var(--p-600, #1a4d8f)" stroke="#fff" strokeWidth={1.5} style={{ transition: dragging ? 'none' : 'cx 0.15s, cy 0.15s' }} />
        <text x={50} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">Figuring it out</text>
        <text x={150} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">Making it happen</text>
      </svg>
      {/* Off-screen field: carries the value to the form and stays fillable for E2E. */}
      <input
        type="range"
        name={name}
        min="0"
        max="100"
        value={p}
        onChange={(e) => setP(parseInt(e.target.value))}
        aria-hidden
        style={{ position: 'absolute', left: '-9999px', width: 10, height: 10, opacity: 0.01 }}
      />
    </div>
  );
}
