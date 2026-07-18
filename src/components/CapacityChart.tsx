'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import {
  buildProductCapacitySeries,
  productCarried,
  unitsAt,
  PRODUCT_KEYS,
  type CapacityProgram,
  type ProductKey,
  type ProductCapacityPoint,
} from '../lib/sop';
import { t, type Locale, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './CapacityChart.module.css';

// Cumulative capacity by product — a CFD-style stacked area chart of product units
// in consumer hands over time. AAOS (the base platform every program carries) is
// the bottom band, so its top edge alone reads as "vehicles online"; GBI / GAS /
// Digital Key / AAP stack above it as the products riding on those vehicles — a
// vehicle counts once per product it carries. Each program ramps linearly from 0
// at its SOP to its 12-month volume a year later (lib/sop); the SOP dots mark
// exactly where each ramp begins. Hover reads every band at a quarter; clicking a
// quarter opens the programs shipping in it; ⤢ opens the chart near-fullscreen.

const INK = 'hsl(0, 0%, 25%)';

// Categorical band fills — deliberately outside the health palette (amber/red/
// green judge; these classify). AAOS is the quiet base; products get one tint each.
const BAND_FILL: Record<ProductKey, string> = {
  aaos: '#dcd8cd',
  gbi: 'var(--p-200)',
  gas: 'var(--p-400)',
  digitalKey: 'var(--chain-soft, #c9b9e6)',
  aap: '#bcd2e0',
};
const BAND_CODE: Record<ProductKey, string> = {
  aaos: 'AAOS',
  gbi: 'GBI',
  gas: 'GAS',
  digitalKey: 'DK',
  aap: 'AAP',
};
const BAND_NAME_KEY: Record<ProductKey, StringKey> = {
  aaos: 'productAaos',
  gbi: 'productGbi',
  gas: 'productGas',
  digitalKey: 'productDigitalKey',
  aap: 'productAap',
};

const fmtUnits = (n: number) =>
  n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);

export interface CapacityChartProgram extends CapacityProgram {
  id: number;
  name: string;
}

interface SopDot {
  id: number;
  name: string;
  ms: number;
  when: string;
}

// ---- the chart surface (one instance per size) -----------------------------------

function ProductAreaChart({
  points,
  activeBands,
  maxY,
  sops,
  vehiclesAt,
  locale,
  w,
  h,
  big = false,
  onQuarterClick,
}: {
  points: ProductCapacityPoint[];
  activeBands: ProductKey[];
  maxY: number;
  sops: SopDot[];
  vehiclesAt: (ms: number) => number;
  locale: Locale;
  w: number;
  h: number;
  big?: boolean;
  onQuarterClick: (i: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const PAD_L = big ? 64 : 56;
  const PAD_R = big ? 126 : 104; // room for direct band labels
  const PAD_T = big ? 20 : 16;
  const PAD_B = big ? 36 : 30;
  const fs = (n: number) => (big ? n * 1.25 : n);

  const x = (i: number) => PAD_L + (i / Math.max(1, points.length - 1)) * (w - PAD_L - PAD_R);
  const y = (v: number) => h - PAD_B - (v / maxY) * (h - PAD_T - PAD_B);

  // Cumulative stack boundaries per point: lower/upper edge of each band.
  const stackAt = (p: ProductCapacityPoint) => {
    const bounds = {} as Record<ProductKey, { lo: number; hi: number }>;
    let acc = 0;
    for (const k of activeBands) {
      bounds[k] = { lo: acc, hi: acc + p.units[k] };
      acc += p.units[k];
    }
    return bounds;
  };
  const stacks = points.map(stackAt);

  const bandPath = (k: ProductKey) => {
    const up = points.map((_, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(stacks[i][k].hi).toFixed(1)}`).join(' ');
    const down = [...points.keys()].reverse().map((i) => `L ${x(i).toFixed(1)} ${y(stacks[i][k].lo).toFixed(1)}`).join(' ');
    return `${up} ${down} Z`;
  };

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

  // Sparse x labels.
  const tickEvery = Math.max(1, Math.ceil(points.length / (big ? 10 : 7)));
  const last = points[points.length - 1];

  // Direct labels at the right edge: band code + final count, nudged apart.
  const ordered = activeBands
    .map((k) => {
      const b = stacks[stacks.length - 1][k];
      return { k, midY: y((b.lo + b.hi) / 2), value: last.units[k] };
    })
    .sort((a, b) => b.midY - a.midY);
  const minGap = fs(13);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i - 1].midY - ordered[i].midY < minGap) ordered[i].midY = ordered[i - 1].midY - minGap;
  }

  // Hover → nearest quarterly sample (CFD-style crosshair + readout).
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * w;
    if (vx < PAD_L - 8 || vx > w - PAD_R + 8) { setHoverIdx(null); return; }
    const step = (w - PAD_L - PAD_R) / Math.max(1, points.length - 1);
    setHoverIdx(Math.max(0, Math.min(points.length - 1, Math.round((vx - PAD_L) / step))));
  };

  const hover = hoverIdx != null ? points[hoverIdx] : null;
  const hoverLeftPct = hoverIdx != null ? (x(hoverIdx) / w) * 100 : 0;
  const flip = hoverIdx != null && hoverIdx > points.length / 2;

  return (
    <div ref={wrapRef} className={styles.chartWrap}>
      <svg viewBox={`0 0 ${w} ${h}`} className={styles.svg} role="img" aria-label={t(locale, 'capacityTitle')}
        onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}>
        {/* y guides: 0 and max only — the figures carry the scale */}
        <line x1={PAD_L} y1={y(0)} x2={w - PAD_R} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
        <line x1={PAD_L} y1={y(maxY)} x2={w - PAD_R} y2={y(maxY)} stroke="var(--border)" strokeWidth={0.6} strokeDasharray="2 4" />
        <text x={PAD_L - 8} y={y(0) + 4} textAnchor="end" fontSize={fs(11)} fill="var(--muted)">0</text>
        <text x={PAD_L - 8} y={y(maxY) + 4} textAnchor="end" fontSize={fs(11)} fill="var(--muted)">{fmtUnits(maxY)}</text>

        {/* stacked product bands, AAOS at the base */}
        {activeBands.map((k) => (
          <path key={k} d={bandPath(k)} fill={BAND_FILL[k]} stroke="#fff" strokeWidth={0.8}>
            <title>{t(locale, BAND_NAME_KEY[k])}</title>
          </path>
        ))}

        {/* the vehicles line: AAOS band's top edge, drawn in ink */}
        <path
          d={points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(stacks[i].aaos.hi).toFixed(1)}`).join(' ')}
          fill="none" stroke={INK} strokeWidth={fs(1.5)}
        />

        {/* one dot per actual SOP date, on the vehicles line — where each program's
            12-month ramp of shipping units begins */}
        {sops.map((d) => (
          <circle key={`sop${d.id}`} data-testid="sop-dot" cx={xAtMs(d.ms)} cy={y(vehiclesAt(d.ms))} r={fs(3.4)}
            fill={INK} stroke="#fff" strokeWidth={1.4}>
            <title>{`${d.name} — SOP ${d.when}`}</title>
          </circle>
        ))}

        {/* direct band labels at the right edge: code + final count */}
        {ordered.map(({ k, midY, value }) => (
          <text key={`lbl${k}`} x={w - PAD_R + 10} y={midY + fs(3.5)} fontSize={fs(11)}
            fontWeight={k === 'aaos' ? 600 : 400} fill={k === 'aaos' ? INK : 'var(--fg)'}>
            {BAND_CODE[k]} {fmtUnits(value)}
            <title>{t(locale, BAND_NAME_KEY[k])}</title>
          </text>
        ))}

        {points.map((p, i) =>
          i % tickEvery === 0 || i === points.length - 1 ? (
            <text key={p.ms} x={x(i)} y={h - fs(9)} textAnchor="middle" fontSize={fs(10)} fill="var(--muted)">
              {p.label}
            </text>
          ) : null,
        )}

        {/* crosshair on the hovered quarter */}
        {hoverIdx != null && (
          <line x1={x(hoverIdx)} y1={PAD_T} x2={x(hoverIdx)} y2={h - PAD_B}
            stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />
        )}

        {/* invisible per-quarter hit bands: click anywhere on a column to drill in */}
        {points.map((p, i) => {
          const half = (w - PAD_L - PAD_R) / Math.max(1, points.length - 1) / 2;
          return (
            <rect
              key={`hit${p.ms}`}
              data-testid="capacity-quarter"
              x={x(i) - half}
              y={PAD_T}
              width={half * 2}
              height={h - PAD_T}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onClick={() => onQuarterClick(i)}
            >
              <title>{t(locale, 'shippingIn', { q: p.label })}</title>
            </rect>
          );
        })}
      </svg>

      {/* CFD-style readout: every band's value at the hovered quarter */}
      {hover && (
        <div
          className={styles.hoverCard}
          style={flip ? { right: `${100 - hoverLeftPct}%`, marginRight: 10 } : { left: `${hoverLeftPct}%`, marginLeft: 10 }}
        >
          <div className={styles.hoverQuarter}>{hover.label}</div>
          {[...activeBands].reverse().map((k) => (
            <div key={k} className={styles.hoverRow}>
              <span className={styles.hoverSwatch} style={{ background: BAND_FILL[k] }} />
              <span className={styles.hoverCode}>{BAND_CODE[k]}</span>
              <span className={styles.hoverVal}>{hover.units[k].toLocaleString(locale)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- the component ---------------------------------------------------------------

export default function CapacityChart({ programs, now }: { programs: CapacityChartProgram[]; now: number }) {
  const locale = useLocale();
  const { points, excluded } = buildProductCapacitySeries(programs, now);
  const quarterRef = useRef<HTMLDialogElement>(null);
  const expandRef = useRef<HTMLDialogElement>(null);
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);

  const openQuarter = (i: number) => {
    setPickedIdx(i);
    quarterRef.current?.showModal();
  };
  const picked = pickedIdx != null ? points[pickedIdx] : null;

  if (points.length === 0) {
    return (
      <div data-testid="capacity-chart">
        <div className={styles.title}>{t(locale, 'capacityTitle')}</div>
        <p className={styles.empty}>{t(locale, 'capacityEmpty')}</p>
      </div>
    );
  }

  // same boundary as the series builder: cancelled out, archived IN
  const dated = programs.filter((p) => p.lifecycle !== 'cancelled' && p.sopDate && p.volumeFirstYear > 0);
  const last = points[points.length - 1];
  // Only bands that ever carry units earn ink.
  const activeBands = PRODUCT_KEYS.filter((k) => last.units[k] > 0);
  // Stack ceiling: the sum of all product bands at the final (largest) point.
  const maxY = activeBands.reduce((sum, k) => sum + last.units[k], 0);

  const vehiclesAt = (ms: number) =>
    dated.reduce((sum, p) => sum + unitsAt(+new Date(p.sopDate!), p.volumeFirstYear, ms), 0);
  const sops: SopDot[] = dated.map((p) => {
    const ms = +new Date(p.sopDate!);
    return { id: p.id, name: p.name, ms, when: new Date(ms).toISOString().slice(0, 7) };
  });

  // Programs shipping (SOP falling) inside the picked quarter.
  const bucketStartMs = (i: number) => (i === 0 ? -Infinity : points[i - 1].ms);
  const shipping =
    pickedIdx == null
      ? []
      : dated
          .filter((p) => {
            const ms = +new Date(p.sopDate!);
            return ms > bucketStartMs(pickedIdx) && ms <= points[pickedIdx].ms;
          })
          .sort((a, b) => b.volumeFirstYear - a.volumeFirstYear);

  const productCodes = (p: CapacityProgram) =>
    PRODUCT_KEYS.filter((k) => k !== 'aaos' && productCarried[k](p)).map((k) => BAND_CODE[k]);

  const chartProps = { points, activeBands, maxY, sops, vehiclesAt, locale, onQuarterClick: openQuarter };

  return (
    <div data-testid="capacity-chart">
      <div className={styles.headRow}>
        <div className={styles.title}>{t(locale, 'capacityTitle')}</div>
        <button type="button" className={styles.expandBtn} title={t(locale, 'capacityExpand')}
          aria-label={t(locale, 'capacityExpand')} onClick={() => expandRef.current?.showModal()}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
            <path d="M 7 1 H 11 V 5 M 11 1 L 6.6 5.4 M 5 11 H 1 V 7 M 1 11 L 5.4 6.6"
              fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <ProductAreaChart {...chartProps} w={1120} h={340} />
      <div className={styles.legend}>
        <span className={styles.note}>{t(locale, 'capacityProductNote')}</span>
        {excluded > 0 && <span className={styles.excluded}>{t(locale, 'capacityExcluded', { n: excluded })}</span>}
      </div>

      {/* the same chart near-fullscreen */}
      <dialog ref={expandRef} className={styles.expandDialog}
        onClick={(e) => { if (e.target === expandRef.current) expandRef.current?.close(); }}>
        <div className={styles.expandBody}>
          <div className={styles.title}>{t(locale, 'capacityTitle')}</div>
          <ProductAreaChart {...chartProps} w={1380} h={560} big />
          <div className={styles.legend}>
            <span className={styles.note}>{t(locale, 'capacityProductNote')}</span>
          </div>
          <button type="button" className={styles.dialogClose} onClick={() => expandRef.current?.close()}>
            {t(locale, 'closeEdit')}
          </button>
        </div>
      </dialog>

      {/* the drill-down: which programs ship in the picked quarter */}
      <dialog
        ref={quarterRef}
        className={styles.dialog}
        data-testid="capacity-dialog"
        onClick={(e) => { if (e.target === quarterRef.current) quarterRef.current?.close(); }}
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
                      onClick={() => quarterRef.current?.close()}>
                      {p.name}
                    </Link>
                    <span className={styles.shipMeta}>
                      {p.volumeFirstYear.toLocaleString(locale)}
                      {productCodes(p).length > 0 && <>{' · '}{productCodes(p).join(' · ')}</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className={styles.dialogClose} onClick={() => quarterRef.current?.close()}>
              {t(locale, 'closeEdit')}
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}
