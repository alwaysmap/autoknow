'use client';

import React from 'react';
import { parseHealth, healthColor } from '../lib/health';

// The gauge PRIMITIVES, deliberately in their own module: this is imported by
// list/feed/table surfaces across the app, so it must stay free of heavy
// dependencies. NeedleGauge (the interactive one) pulls in the markdown editor
// and the history list; when those lived here, every page rendering a read-only
// gauge shipped the markdown renderer too and hydrated far slower.

// Program status drawn as a Basecamp-style gauge: a WHITE track (a thick band with a
// thin outline) whose health color fills up to the current progress, with graticules
// held inside the band. A floating NEEDLE marks the position — a flat top curved
// concentric with the gauge, reaching equally inside and outside the arc, with a thin
// surface-coloured boundary (var(--paper), so it tracks the theme rather than
// forcing white onto a dark page). The previous state is a colored marker, bordered
// the same way. The
// 0..1 scale is internal only — no numbers are shown.

export const CX = 120, CY = 138, R = 116, A0 = 127, A1 = 53;
export const SWEEP = A0 - A1; // 74° arc
// The rotation centre (CX,CY) sits far below the arc; the viewBox is cropped tightly to
// just the arc + needle so the graphic is a compact wide/short rectangle (no dead space).
export const VB_X = 38, VB_Y = 3, VB_W = 164, VB_H = 60;
const BANDH = 7;        // half the track thickness
const FILL_INSET = 2.6; // gap between the color fill and the track border
export const clamp01 = (p: number) => Math.max(0, Math.min(1, p));
const degAt = (p: number) => A0 - clamp01(p) * SWEEP; // p=0 -> left, p=1 -> right
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
};
const ptStr = (o: { x: number; y: number }) => `${o.x.toFixed(1)},${o.y.toFixed(1)}`;
// Trig differs in the last ULP between the server runtime and the browser engine,
// so raw coordinates hydrate as a mismatch (…906 vs …908) and React re-renders
// every gauge. Paths already round via ptStr; bare attributes must too.
const r2 = (v: number) => Math.round(v * 100) / 100;
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

export function Gauge({ progress, color, prevProgress, prevColor }: {
  progress: number; color: string; prevProgress?: number | null; prevColor?: string | null;
}) {
  const p = clamp01(progress);
  const deg = degAt(p);
  const fillH = Math.max(1.5, BANDH - FILL_INSET);
  const cap = { strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

  return (
    <g>
      {/* track container, the surface colour with a thin outline */}
      <path d={ribbon(0, 1, BANDH)} fill="var(--paper)" stroke="var(--border, #d6d6d6)" strokeWidth={1.4} {...cap} />
      {/* graticules held entirely inside the band */}
      {TICKS.map((t, i) => {
        const o = polar(degAt(t), R + BANDH - 1.4);
        const inn = polar(degAt(t), R + BANDH - 1.4 - BANDH * 0.72);
        return <line key={i} x1={r2(o.x)} y1={r2(o.y)} x2={r2(inn.x)} y2={r2(inn.y)} stroke="var(--muted, #9a948a)" strokeWidth={1.1} opacity={0.5} />;
      })}
      {/* health color fill, inset so a surface-coloured margin shows to the border */}
      {p > 0.01 && <path d={ribbon(0, p, fillH)} fill={color} {...cap} />}
      {/* previous-status marker, wrapped in a thin surface-coloured boundary */}
      {prevProgress != null && (() => {
        const o = polar(degAt(prevProgress), R + BANDH + 2);
        const inn = polar(degAt(prevProgress), R - BANDH - 2);
        return (
          <>
            <line x1={r2(o.x)} y1={r2(o.y)} x2={r2(inn.x)} y2={r2(inn.y)} stroke="var(--paper)" strokeWidth={5.4} strokeLinecap="round" />
            <line x1={r2(o.x)} y1={r2(o.y)} x2={r2(inn.x)} y2={r2(inn.y)} stroke={prevColor || color} strokeWidth={3} strokeLinecap="round" />
          </>
        );
      })()}
      {/* floating needle, ringed in the surface colour so it pops off the track */}
      <path d={needlePath(deg)} fill={color} stroke="var(--paper)" strokeWidth={1.8} strokeLinejoin="round" />
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

