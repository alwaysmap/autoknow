'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { buildCapacitySeries, unitsAt, type CapacityProgram } from '../lib/sop';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './CapacityChart.module.css';

// Units in consumer hands over time: two lines — WITH GAS (solid ink) and WITHOUT
// GAS (muted dashes). volumeFirstYear = units within 12 months post-SOP, so each
// program ramps linearly from 0 at its SOP to full volume a year later (lib/sop),
// which is why the SOP target is required: undated programs can't be placed and are
// called out, not silently dropped. Tufte: two lines, sparse ticks, k/M figures.
//
// Every summary is a door: clicking a quarter (the tick or the band above it) opens
// the list of programs shipping in that quarter, each linking to its program page.

const W = 520, H = 170, PAD_L = 46, PAD_R = 10, PAD_T = 12, PAD_B = 26;
const INK = 'hsl(0, 0%, 25%)';

const fmtUnits = (n: number) =>
  n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);

export interface CapacityChartProgram extends CapacityProgram {
  id: number;
  name: string;
}

export default function CapacityChart({ programs, now }: { programs: CapacityChartProgram[]; now: number }) {
  const locale = useLocale();
  const { points, excluded } = buildCapacitySeries(programs, now);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);

  const openQuarter = (i: number) => {
    setPickedIdx(i);
    dialogRef.current?.showModal();
  };
  const picked = pickedIdx != null ? points[pickedIdx] : null;
  // Programs whose SOP falls INSIDE the picked quarter (after the previous bucket end).
  const prevMs = pickedIdx != null && pickedIdx > 0 ? points[pickedIdx - 1].ms : -Infinity;
  const shipping = picked
    ? programs.filter(
        (p) => !p.isArchived && p.sopDate && +new Date(p.sopDate) > prevMs && +new Date(p.sopDate) <= picked.ms,
      )
    : [];

  if (points.length === 0) {
    return (
      <div data-testid="capacity-chart">
        <div className={styles.title}>{t(locale, 'capacityTitle')}</div>
        <p className={styles.empty}>{t(locale, 'capacityEmpty')}</p>
      </div>
    );
  }

  const maxY = Math.max(1, ...points.map((p) => Math.max(p.withGas, p.withoutGas)));
  const x = (i: number) => PAD_L + (i / Math.max(1, points.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => H - PAD_B - (v / maxY) * (H - PAD_T - PAD_B);

  // Line paths: deliveries ramp gradually across each program's first 12 months,
  // so straight segments between quarterly samples are the honest shape.
  const linePath = (get: (p: (typeof points)[number]) => number) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(get(p)).toFixed(1)}`).join(' ');

  // Sparse x labels: first, last, and every ~4th quarter between.
  const tickEvery = Math.max(1, Math.ceil(points.length / 5));
  const last = points[points.length - 1];

  // x for an arbitrary moment: linear interpolation between the quarterly samples.
  const xAtMs = (ms: number) => {
    if (ms <= points[0].ms) return x(0);
    for (let i = 1; i < points.length; i++) {
      if (ms <= points[i].ms) {
        const f = (ms - points[i - 1].ms) / (points[i].ms - points[i - 1].ms);
        return x(i - 1) + f * (x(i) - x(i - 1));
      }
    }
    return x(points.length - 1);
  };

  // A dot per ACTUAL SOP date, sitting on its own series at that moment's value —
  // the ramps are notional; the dots are the real commitments.
  const dated = programs.filter((p) => !p.isArchived && p.sopDate && p.volumeFirstYear > 0);
  const seriesValueAt = (ms: number, gas: boolean) =>
    dated.filter((p) => p.hasGas === gas).reduce((sum, p) => sum + unitsAt(+new Date(p.sopDate!), p.volumeFirstYear, ms), 0);
  const sopDots = dated.map((p) => {
    const ms = +new Date(p.sopDate!);
    return {
      id: p.id,
      name: p.name,
      gas: p.hasGas,
      cx: xAtMs(ms),
      cy: y(seriesValueAt(ms, p.hasGas)),
      when: new Date(ms).toISOString().slice(0, 7),
    };
  });

  return (
    <div data-testid="capacity-chart">
      <div className={styles.title}>{t(locale, 'capacityTitle')}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={t(locale, 'capacityTitle')}>
        {/* y guides: 0 and max only — the figures carry the scale */}
        <line x1={PAD_L} y1={y(0)} x2={W - PAD_R} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
        <line x1={PAD_L} y1={y(maxY)} x2={W - PAD_R} y2={y(maxY)} stroke="var(--border)" strokeWidth={0.6} strokeDasharray="2 4" />
        <text x={PAD_L - 6} y={y(0) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">0</text>
        <text x={PAD_L - 6} y={y(maxY) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">{fmtUnits(maxY)}</text>

        {/* without GAS: muted dashed ramp */}
        <path d={linePath((p) => p.withoutGas)} fill="none" stroke="var(--muted)" strokeWidth={1.6} strokeDasharray="4 3" />
        {/* with GAS: the headline series, solid ink */}
        <path d={linePath((p) => p.withGas)} fill="none" stroke={INK} strokeWidth={2.2} />

        {/* one dot per actual SOP date, on its own series */}
        {sopDots.map((d) => (
          <circle key={`sop${d.id}`} data-testid="sop-dot" cx={d.cx} cy={d.cy} r={3.2}
            fill={d.gas ? INK : 'var(--muted)'} stroke="#fff" strokeWidth={1.2}>
            <title>{`${d.name} — SOP ${d.when}`}</title>
          </circle>
        ))}

        {/* end-of-series figures, right where the eye lands */}
        <text x={W - PAD_R} y={y(last.withGas) - 5} textAnchor="end" fontSize={11} fontWeight={600} fill={INK}>
          {fmtUnits(last.withGas)}
        </text>
        {last.withoutGas > 0 && (
          <text x={W - PAD_R} y={y(last.withoutGas) + 12} textAnchor="end" fontSize={11} fill="var(--muted)">
            {fmtUnits(last.withoutGas)}
          </text>
        )}

        {points.map((p, i) =>
          i % tickEvery === 0 || i === points.length - 1 ? (
            <text key={p.ms} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9.5} fill="var(--muted)">
              {p.label}
            </text>
          ) : null,
        )}

        {/* invisible per-quarter hit bands: click anywhere on a column to drill in */}
        {points.map((p, i) => {
          const half = (W - PAD_L - PAD_R) / Math.max(1, points.length - 1) / 2;
          return (
            <rect
              key={`hit${p.ms}`}
              data-testid="capacity-quarter"
              x={x(i) - half}
              y={PAD_T}
              width={half * 2}
              height={H - PAD_T}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onClick={() => openQuarter(i)}
            >
              <title>{t(locale, 'shippingIn', { q: p.label })}</title>
            </rect>
          );
        })}
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}><span className={styles.swatchInk} /> {t(locale, 'capacityWithGas')}</span>
        <span className={styles.legendItem}><span className={styles.swatchMuted} /> {t(locale, 'capacityWithoutGas')}</span>
        {excluded > 0 && <span className={styles.excluded}>{t(locale, 'capacityExcluded', { n: excluded })}</span>}
      </div>

      {/* the drill-down: which programs ship in the picked quarter */}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        data-testid="capacity-dialog"
        onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close(); }}
      >
        {picked && (
          <div className={styles.dialogBody}>
            <h3 className={styles.dialogTitle}>{t(locale, 'shippingIn', { q: picked.label })}</h3>
            {shipping.length === 0 ? (
              <p className={styles.empty}>{t(locale, 'shippingNone')}</p>
            ) : (
              <ul className={styles.shipList}>
                {shipping.map((p) => (
                  <li key={p.id} className={styles.shipRow}>
                    <Link href={`/programs/${p.id}`} className={styles.shipName}
                      onClick={() => dialogRef.current?.close()}>
                      {p.name}
                    </Link>
                    <span className={styles.shipMeta}>
                      {p.volumeFirstYear.toLocaleString(locale)}
                      {' · '}
                      {p.hasGas ? t(locale, 'capacityWithGas') : t(locale, 'capacityWithoutGas')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className={styles.dialogClose} onClick={() => dialogRef.current?.close()}>
              {t(locale, 'closeEdit')}
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}
