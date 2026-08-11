'use client';

import ChartLabel from './ChartLabel';
import React, { useMemo, useRef, useState } from 'react';
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
import { centreToBaselineY, dodgeLabels, estimateTextWidth } from '../lib/labelPlacement';
import { t, type Locale, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import OverlayDialog from './OverlayDialog';
import styles from './CapacityChart.module.css';

// Cumulative capacity by product — a CFD-style stacked area chart of product units
// in consumer hands over time. AAOS (the base platform every program carries) is
// the bottom band, so its top edge alone reads as "vehicles online"; GBI / GAS /
// Digital Key / AAP stack above it as the products riding on those vehicles — a
// vehicle counts once per product it carries. Each program ramps linearly from 0
// at its SOP to its 12-month volume a year later (lib/sop); the SOP dots mark
// exactly where each ramp begins. Hover reads every band at a quarter; clicking a
// quarter opens the programs shipping in it; ⤢ opens the chart near-fullscreen.

// The vehicles line, the SOP dots and the AAOS label are all the SAME ink — the
// chart's one piece of foreground drawing — so they share one token. It was a
// literal `hsl(0, 0%, 25%)`, which is mid-grey in both themes: correct on cream,
// unreadable on the dark theme's paper. `var(--fg)` is what PhaseTrack's INK
// already is, and it flips (design.md §8b).
const INK = 'var(--fg)';

// Categorical band fills — deliberately outside the health palette (amber/red/
// green judge; these classify). AAOS is the quiet base; products get one tint each.
// The palette itself lives in globals.css, restated for dark.
const BAND_FILL: Record<ProductKey, string> = {
  aaos: 'var(--capacity-aaos)',
  gbi: 'var(--capacity-gbi)',
  gas: 'var(--capacity-gas)',
  digitalKey: 'var(--capacity-dk)',
  aap: 'var(--capacity-aap)',
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
  // Recomputed on every hover otherwise — a pure function of points+activeBands.
  const stacks = useMemo(() => points.map(stackAt), [points, activeBands]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Direct labels at the right edge: band code + final count, one per series, sitting at
  // its band's midpoint. Two thin adjacent bands put two midpoints within a line height,
  // and the count is a distinct fact that at rest appears nowhere else on the chart (the
  // CFD readout is hover-only) — so the collision is resolved by NUDGING every label into
  // a free slot (dodgeLabels), never by hiding one. This replaced a hand-rolled push-up
  // loop that (a) only ever pushed toward the top and (b) had no bounds, so a stack of
  // thin top bands walked its labels clean off the plot; dodgeLabels clamps to the box.
  const labelFs = fs(11);
  const labelLeft = w - PAD_R + 10;
  const bandLabels = activeBands.map((k) => ({ k, text: `${BAND_CODE[k]} ${fmtUnits(last.units[k])}` }));
  // One column, so every label claims the WIDEST box in it: identical x/halfW makes the
  // fan-out process strictly top-down, which keeps the labels in band order.
  const labelHalfW = Math.max(0, ...bandLabels.map((l) => estimateTextWidth(l.text, labelFs))) / 2;
  const labelYs = dodgeLabels(
    [],
    bandLabels.map(({ k }) => {
      const b = stacks[stacks.length - 1][k];
      return { x: labelLeft + labelHalfW, y: y((b.lo + b.hi) / 2), halfW: labelHalfW, halfH: labelFs / 2 + 1.5, priority: 1 };
    }),
    { top: PAD_T, bottom: h - PAD_B },
  );
  const placedBandLabels = bandLabels.map(({ k, text }, i) => ({ k, text, y: labelYs[i] }));

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
        <ChartLabel x={PAD_L - 8} y={y(0) + 4} textAnchor="end" fontSize={fs(11)} fill="var(--muted)">0</ChartLabel>
        <ChartLabel x={PAD_L - 8} y={y(maxY) + 4} textAnchor="end" fontSize={fs(11)} fill="var(--muted)">{fmtUnits(maxY)}</ChartLabel>

        {/* stacked product bands, AAOS at the base */}
        {activeBands.map((k) => (
          <path key={k} d={bandPath(k)} fill={BAND_FILL[k]} stroke="var(--paper)" strokeWidth={0.8}>
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
            fill={INK} stroke="var(--paper)" strokeWidth={1.4}>
            <title>{`${d.name} — SOP ${d.when}`}</title>
          </circle>
        ))}

        {/* direct band labels at the right edge: code + final count */}
        {placedBandLabels.map(({ k, y: cy, text }) => (
          <ChartLabel key={`lbl${k}`} data-testid={`capacity-band-label-${k}`}
            x={labelLeft} y={centreToBaselineY(cy, labelFs)} fontSize={labelFs}
            fontWeight={k === 'aaos' ? 600 : 400} fill={INK}>
            {text}
            <title>{t(locale, BAND_NAME_KEY[k])}</title>
          </ChartLabel>
        ))}

        {points.map((p, i) =>
          i % tickEvery === 0 || i === points.length - 1 ? (
            <ChartLabel key={p.ms} x={x(i)} y={h - fs(9)} textAnchor="middle" fontSize={fs(10)} fill="var(--muted)">
              {p.label}
            </ChartLabel>
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
          style={flip ? { right: `${100 - hoverLeftPct}%`, marginRight: '0.625rem' } : { left: `${hoverLeftPct}%`, marginLeft: '0.625rem' }}
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
  // Both the inline and expanded charts re-render on every hover; the series is a
  // pure function of programs+now, so compute it once.
  const { points, excluded } = useMemo(() => buildProductCapacitySeries(programs, now), [programs, now]);
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);
  const [quarterOpen, setQuarterOpen] = useState(false);
  // The big chart mounts only while its dialog is open — a hidden duplicate would
  // double every sop-dot/testid in the DOM.
  const [expandOpen, setExpandOpen] = useState(false);

  const openQuarter = (i: number) => {
    setPickedIdx(i);
    setQuarterOpen(true);
  };
  const picked = pickedIdx != null ? points[pickedIdx] : null;

  if (points.length === 0) {
    return (
      <div data-testid="capacity-chart">
        <div data-eyebrow className={styles.title}>{t(locale, 'capacityTitle')}</div>
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
        <div data-eyebrow className={styles.title}>{t(locale, 'capacityTitle')}</div>
        <button type="button" className={styles.expandBtn} title={t(locale, 'capacityExpand')}
          aria-label={t(locale, 'capacityExpand')}
          onClick={() => setExpandOpen(true)}>
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
      <OverlayDialog open={expandOpen} onClose={() => setExpandOpen(false)} width="70rem"
        title={t(locale, 'capacityTitle')} closeLabel={t(locale, 'close')}>
        {expandOpen && (
          <div className={styles.expandBody}>
            <ProductAreaChart {...chartProps} w={1380} h={560} big />
            <div className={styles.legend}>
              <span className={styles.note}>{t(locale, 'capacityProductNote')}</span>
            </div>
          </div>
        )}
      </OverlayDialog>

      {/* the drill-down: which programs ship in the picked quarter */}
      <OverlayDialog open={quarterOpen} onClose={() => setQuarterOpen(false)} width="26rem"
        dataTestId="capacity-dialog"
        title={picked ? t(locale, 'shippingIn', { q: picked.label }) : undefined} closeLabel={t(locale, 'close')}>
        {picked && (
          <div className={styles.dialogBody}>
            {shipping.length === 0 ? (
              <p className={styles.empty}>{t(locale, 'shippingNone')}</p>
            ) : (
              <ul className={styles.shipList}>
                {shipping.map((p) => (
                  <li key={p.id} className={styles.shipRow}>
                    <Link href={`/programs/${p.id}`} className={styles.shipName}
                      onClick={() => setQuarterOpen(false)}>
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
          </div>
        )}
      </OverlayDialog>
    </div>
  );
}
