/** @jest-environment jsdom */
// The label-collision sweep for #161. Two halves, and both are load-bearing:
//
//  1. A MECHANICAL check on `labelPlacement` itself (AGENTS lesson 2): whatever either
//     strategy returns, no two of the boxes it endorses may intersect. Randomised inputs,
//     so the rule cannot be satisfied by memorising the cases someone thought of.
//  2. CHART-LEVEL checks driven by fixture data deliberately chosen to CROWD — because
//     the bug this sweep exists to kill is not "the de-collider is wrong", it is "nobody
//     called the de-collider, and the default dataset happened not to notice". The
//     fixtures are the datasets that notice: two adjacent thin capacity bands, the
//     healthy cycle-time distribution where p50 == p85, and (§4) the buffer flow's
//     blown-buffer and today-at-the-right-edge cases.
//
// §4 also asserts what a de-collider CANNOT see, because both bugs the flow shipped on
// its first real page load were of that kind: a label clipped by the FRAME, and a label
// struck through by the chart's own boundary LINE. Neither is a label-on-label overlap,
// so every placement pass reported clear.
//
// Boxes are reconstructed from the rendered attributes with the SAME width estimator the
// components lay out with, so this asserts the geometry that actually shipped. It cannot
// see the cascade (jsdom has no font metrics), which is why the sign-off for this issue
// is a screenshot as well — counting elements proves existence, not visibility
// (AGENTS lesson 18).
import React from 'react';
import { render } from '@testing-library/react';
import { LocaleProvider } from '../src/components/LocaleProvider';
import CapacityChart, { type CapacityChartProgram } from '../src/components/CapacityChart';
import CycleTimeScatterPlot, { type CycleTimeData, type CycleTimeStats } from '../src/components/CycleTimeScatterPlot';
import { ChainSchedule, W as CHAIN_W } from '../src/components/ChainSchedule';
import { computeChainLedger, type ChainLedgerInput, type LedgerPhaseInput } from '../src/lib/chainLedger';
import {
  keepNonOverlapping,
  dodgeLabels,
  estimateTextWidth,
  type PlacedLabel,
} from '../src/lib/labelPlacement';

// ---- shared geometry -------------------------------------------------------------

interface Box { x: number; y: number; halfW: number; halfH: number }
const intersects = (a: Box, b: Box): boolean =>
  Math.abs(a.x - b.x) < a.halfW + b.halfW && Math.abs(a.y - b.y) < a.halfH + b.halfH;

/** Every intersecting pair in the set, named — an assertion failure should say WHICH two
 *  labels landed on each other, not just that the count was wrong. */
function collidingPairs<T extends Box & { text: string }>(boxes: T[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (intersects(boxes[i], boxes[j])) bad.push(`"${boxes[i].text}" ⟷ "${boxes[j].text}"`);
  return bad;
}

/** Turn a rendered <text> into the box it occupies, honouring its anchor. `fontSize`
 *  falls back to the caller's value because a CSS-module class carries no size in jsdom. */
function boxOf(el: SVGTextElement, fallbackFs: number) {
  // Direct text nodes ONLY: several labels carry a <title> child for the tooltip, and
  // counting the tooltip's prose as rendered glyphs would invent a label three times the
  // width of the one on screen.
  const text = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent ?? '')
    .join('');
  const attrFs = Number(el.getAttribute('font-size'));
  const fs = Number.isFinite(attrFs) && attrFs > 0 ? attrFs : fallbackFs;
  const w = estimateTextWidth(text, fs);
  const anchor = el.getAttribute('text-anchor') ?? 'start';
  const left = Number(el.getAttribute('x'));
  const cx = anchor === 'middle' ? left : anchor === 'end' ? left - w / 2 : left + w / 2;
  return { text, x: cx, y: Number(el.getAttribute('y')), halfW: w / 2, halfH: fs / 2 + 1 };
}

const wrap = (ui: React.ReactNode) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

// ---- 0. the detector itself ------------------------------------------------------

describe('the collision detector these tests rely on', () => {
  // A green "no collisions" result is worthless if the detector cannot see one. This
  // reproduces the exact pre-fix geometry of both reported bugs — two captions at one
  // point, and two band labels a few px apart in a shared column — and demands a report.
  const b = (text: string, x: number, y: number, halfW = 9) => ({ text, x, y, halfW, halfH: 6 });

  it('flags two captions printed on the same spot (CycleTimeScatterPlot, p50 === p85)', () => {
    expect(collidingPairs([b('P50', 320, 118), b('P85', 320, 118)])).toEqual(['"P50" ⟷ "P85"']);
  });

  it('flags a stacked column of band labels (CapacityChart, adjacent thin bands)', () => {
    expect(collidingPairs([b('GAS 12k', 1030, 140, 26), b('DK 12k', 1030, 146, 24)])).toHaveLength(1);
  });

  it('passes a pair that clears in either axis alone', () => {
    expect(collidingPairs([b('P50', 320, 118), b('P85', 320, 132)])).toEqual([]); // clear in y
    expect(collidingPairs([b('P50', 300, 118), b('P85', 340, 118)])).toEqual([]); // clear in x
  });
});

// ---- 1. the mechanical check on the placement passes ------------------------------

describe('labelPlacement — a placement pass never endorses two intersecting boxes', () => {
  /** Deterministic PRNG: a random-looking corpus that reproduces byte-for-byte on CI. */
  const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  const corpus = (seed: number, n: number): PlacedLabel[] => {
    const r = rng(seed);
    // Coordinates are drawn from a SMALL grid on purpose — a corpus spread over a big
    // canvas rarely collides, and a de-collision test that rarely collides tests nothing.
    return Array.from({ length: n }, () => ({
      x: Math.round(r() * 60),
      y: Math.round(r() * 40),
      halfW: 3 + Math.round(r() * 12),
      halfH: 4 + Math.round(r() * 3),
      priority: Math.round(r() * 3),
    }));
  };

  it.each([1, 7, 42, 1337, 90210])('keepNonOverlapping keeps a clean set (seed %i)', (seed) => {
    const labels = corpus(seed, 40);
    const kept = labels.filter((_, i) => keepNonOverlapping(labels)[i]);
    expect(kept.length).toBeGreaterThan(0); // it must not "succeed" by hiding everything
    for (let i = 0; i < kept.length; i++)
      for (let j = i + 1; j < kept.length; j++)
        expect(intersects(kept[i], kept[j])).toBe(false);
  });

  it.each([1, 7, 42, 1337, 90210])('dodgeLabels keeps EVERY label and still clears (seed %i)', (seed) => {
    const all = corpus(seed, 24);
    const fixed = all.slice(0, 4);
    const movable = all.slice(4);
    // Room to fan into: the natural ys span 0–40, so a band of 400 is not a full column.
    const bounds = { top: -200, bottom: 200 };
    const ys = dodgeLabels(fixed, movable, bounds);
    expect(ys).toHaveLength(movable.length); // nothing dropped, ever — that is the contract
    const placed = movable.map((l, i) => ({ ...l, y: ys[i] }));
    for (const p of placed) {
      expect(p.y).toBeGreaterThanOrEqual(bounds.top + p.halfH);
      expect(p.y).toBeLessThanOrEqual(bounds.bottom - p.halfH);
      for (const f of fixed) expect(intersects(p, f)).toBe(false);
    }
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(intersects(placed[i], placed[j])).toBe(false);
  });
});

describe('estimateTextWidth', () => {
  it('scales with the type size, so a box tracks the label it reserves room for', () => {
    expect(estimateTextWidth('P50', 20)).toBeCloseTo(estimateTextWidth('P50', 10) * 2);
  });

  it('charges a full-width glyph nearly twice a latin one — the CJK overflow case', () => {
    expect(estimateTextWidth('設計', 11)).toBeGreaterThan(estimateTextWidth('AB', 11) * 1.7);
  });

  it('is zero for an empty label and monotonic in length', () => {
    expect(estimateTextWidth('', 11)).toBe(0);
    expect(estimateTextWidth('AAOS 1.2M', 11)).toBeGreaterThan(estimateTextWidth('AAOS', 11));
  });
});

// ---- 2. CapacityChart: adjacent thin bands ---------------------------------------

describe('CapacityChart — direct band labels, crowded on purpose', () => {
  // Every program ships the same day with the same tiny volume, so all five product
  // bands are the same thickness and their midpoints land within a line height of each
  // other. Before the fix the hand-rolled push-up loop walked them off the top of the
  // plot; with no de-collision at all they printed on top of each other.
  const crowded: CapacityChartProgram[] = [
    { id: 1, name: 'Alpha', sopDate: '2026-01-15', volumeFirstYear: 12_000, hasGas: true, hasGbi: true, hasDigitalKey: true, hasAap: true },
    { id: 2, name: 'Beta', sopDate: '2026-02-01', volumeFirstYear: 900_000, hasGas: false, hasGbi: false, hasDigitalKey: false, hasAap: false },
  ];
  const NOW = +new Date('2026-06-01');

  const bandBoxes = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<SVGTextElement>('[data-testid^="capacity-band-label-"]'))
      .map((el) => boxOf(el, 11));

  it('renders one label per active band and no two of them intersect', () => {
    const { container } = wrap(<CapacityChart programs={crowded} now={NOW} />);
    const boxes = bandBoxes(container);
    expect(boxes.length).toBeGreaterThanOrEqual(4); // AAOS + the products Alpha carries
    expect(collidingPairs(boxes)).toEqual([]);
  });

  it('never drops a band label — every band still names itself and its count', () => {
    const { container } = wrap(<CapacityChart programs={crowded} now={NOW} />);
    const texts = bandBoxes(container).map((b) => b.text);
    // dodgeLabels, not keepNonOverlapping: a band's final unit count appears nowhere else
    // at rest (the CFD readout is hover-only), so hiding one would delete a fact.
    for (const code of ['AAOS', 'GBI', 'GAS', 'DK', 'AAP']) {
      expect(texts.some((s) => s.startsWith(`${code} `))).toBe(true);
    }
  });

  it('keeps every dodged label inside the plot box', () => {
    const { container } = wrap(<CapacityChart programs={crowded} now={NOW} />);
    // The inline chart is authored at 340 tall with PAD_T 16 / PAD_B 30 (CapacityChart).
    for (const b of bandBoxes(container)) {
      expect(b.y).toBeGreaterThan(16);
      expect(b.y).toBeLessThan(340 - 30);
    }
  });
});

// ---- 3. CycleTimeScatterPlot: the healthy p50 == p85 -----------------------------

describe('CycleTimeScatterPlot — the healthy distribution is the crowding case', () => {
  const phases = ['Concept', 'Design', 'Development', 'Certification'];
  const data: CycleTimeData[] = phases.flatMap((phaseName, i) =>
    [10, 12, 11, 13].map((cycleTimeDays, j) => ({
      phaseId: i * 10 + j,
      phaseName,
      cycleTimeDays,
      isFinished: true,
    })),
  );

  /** p50 === p85: the tight, healthy spread. This is the dataset that used to print
   *  "P50" and "P85" on the same pixel and turn both into mush. */
  const identical: Record<string, CycleTimeStats> = Object.fromEntries(
    phases.map((n) => [n, { p50: 12, p85: 12, p95: 12 }]),
  );
  /** One day apart — still inside a label width, so still a collision. */
  const nearlyIdentical: Record<string, CycleTimeStats> = Object.fromEntries(
    phases.map((n) => [n, { p50: 12, p85: 13, p95: 20 }]),
  );
  /** A wide spread: nothing to de-collide, and the captions must NOT move. */
  const wide: Record<string, CycleTimeStats> = Object.fromEntries(
    phases.map((n) => [n, { p50: 5, p85: 40, p95: 60 }]),
  );

  const captionBoxes = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<SVGTextElement>('[data-testid^="cycle-p"]'))
      .map((el) => ({ ...boxOf(el, 10), id: el.getAttribute('data-testid')! }));

  it.each([
    ['identical p50/p85', identical],
    ['one day apart', nearlyIdentical],
    ['a wide spread', wide],
  ])('never overlaps a percentile caption — %s', (_name, stats) => {
    const { container } = wrap(<CycleTimeScatterPlot data={data} stats={stats} />);
    const boxes = captionBoxes(container);
    expect(boxes).toHaveLength(phases.length * 2);
    expect(collidingPairs(boxes)).toEqual([]);
  });

  it('keeps BOTH captions when they collide — neither percentile is inferable', () => {
    const { container } = wrap(<CycleTimeScatterPlot data={data} stats={identical} />);
    const boxes = captionBoxes(container);
    expect(boxes.filter((b) => b.text === 'P50')).toHaveLength(phases.length);
    expect(boxes.filter((b) => b.text === 'P85')).toHaveLength(phases.length);
  });

  it('separates a colliding pair in y, not by moving it off its own whisker in x', () => {
    const { container } = wrap(<CycleTimeScatterPlot data={data} stats={identical} />);
    const boxes = captionBoxes(container);
    const p50 = boxes.find((b) => b.id === 'cycle-p50-0')!;
    const p85 = boxes.find((b) => b.id === 'cycle-p85-0')!;
    expect(p50.x).toBeCloseTo(p85.x); // same whisker, same x — the caption never lies about which line it names
    expect(Math.abs(p50.y - p85.y)).toBeGreaterThanOrEqual(p50.halfH + p85.halfH);
  });

  it('leaves an uncrowded pair on its natural baseline', () => {
    const { container } = wrap(<CycleTimeScatterPlot data={data} stats={wide} />);
    const ys = captionBoxes(container).filter((b) => b.id.endsWith('-0')).map((b) => b.y);
    expect(new Set(ys).size).toBe(1); // both still at rowY - 22
  });
});

// ---- 4. ChainSchedule's buffer flow: the blown buffer, and today at the edge ------

describe("ChainSchedule's buffer flow — the frame and the boundary are collisions too", () => {
  const DAY = 86_400_000;
  const D0 = Date.UTC(2026, 0, 1);
  const day = (n: number) => D0 + n * DAY;
  const iso = (n: number) => new Date(day(n)).toISOString();
  const phase = (
    id: number, name: string, forecastedDuration: number, progress: number,
    parentIds: number[] = [], startedAt: string | null = null, completedAt: string | null = null,
  ): LedgerPhaseInput => ({ id, name, forecastedDuration, progress, parentIds, startedAt, completedAt });

  /** A(30) done 3 days early · 6 idle days · B(40) live and over · C(30) queued. Moving
   *  the SOP moves B₀, which is the only thing the flow is a share OF — so one shape
   *  drives the healthy case, the blown case and everything between. */
  const chain = (sopDay: number, names = ['Design', 'Build', 'Certification']): ChainLedgerInput => ({
    phases: [
      phase(1, names[0], 30, 100, [], iso(0), iso(27)),
      phase(2, names[1], 40, 50, [1], iso(33)),
      phase(3, names[2], 30, 0, [2]),
    ],
    sopDate: iso(sopDay),
    now: day(60),
  });

  const drawChain = (input: ChainLedgerInput) => wrap(
    <ChainSchedule
      ledger={computeChainLedger(input)}
      sopMs={input.sopDate ? +new Date(input.sopDate) : null}
      now={input.now}
      locale="en"
      onRowCard={() => {}}
      onJump={() => {}}
    />,
  ).container;

  const flowBoxes = (container: HTMLElement) => {
    const flow = container.querySelector('[data-testid="chain-buffer-flow"]');
    if (!flow) throw new Error('the buffer flow did not render for this fixture');
    return Array.from(flow.querySelectorAll<SVGTextElement>('text')).map((el) => boxOf(el, 10));
  };

  /** No two labels on each other, and none half outside the frame. The second half is
   *  the one no placement pass can check for you: `dodgeLabels` reasons about labels,
   *  so a reading anchored to today's right runs off the viewBox with every pass green. */
  const expectReadable = (container: HTMLElement) => {
    const boxes = flowBoxes(container);
    expect(boxes.length).toBeGreaterThan(0);
    expect(collidingPairs(boxes)).toEqual([]);
    expect(boxes.filter((b) => b.x - b.halfW < 0 || b.x + b.halfW > CHAIN_W).map((b) => b.text)).toEqual([]);
    return boxes;
  };

  it('reads clean on a healthy program, buffer comfortably in hand', () => {
    expectReadable(drawChain(chain(200)));
  });

  it('reads clean when the buffer is BLOWN — sub-zero scale, the day it ran out, and today all in one column', () => {
    const boxes = expectReadable(drawChain(chain(105)));
    expect(boxes.some((b) => /past SOP/.test(b.text))).toBe(true);
    expect(boxes.some((b) => /buffer gone/.test(b.text))).toBe(true);
  });

  it('reads clean with a NARROW name gutter, where the axis values have least room', () => {
    expectReadable(drawChain(chain(105, ['A', 'B', 'C'])));
  });

  it('reads clean with long CJK names and a wide gutter', () => {
    expectReadable(drawChain(chain(105, ['設計フェーズ', '製造フェーズ', '認証フェーズ'])));
  });

  it('flips the reading at today rather than clipping it against the right edge', () => {
    // `now` is a Sunday and the work is done, so the week-ceiling that ends the axis is
    // one day away: today lands as far right as this axis can put it. Anchored to its
    // right, the reading ran off the frame — green tests, unreadable chart.
    const boxes = expectReadable(drawChain({
      phases: [
        phase(1, 'Design', 30, 100, [], iso(0), iso(34)),
        phase(2, 'Build', 20, 100, [1], iso(34), iso(57)),
      ],
      sopDate: iso(59),
      now: day(59),
    }));
    const reading = boxes.find((b) => /left · /.test(b.text));
    expect(reading).toBeDefined();
    expect(reading!.x + reading!.halfW).toBeLessThanOrEqual(CHAIN_W);
  });

  it('keeps the readings off the boundary line, which slopes under them', () => {
    // The flow's own polyline is ink a placement pass cannot see. Each reading clears
    // the line across ITS OWN width — so assert against the drawn points, not a fixed
    // offset from the value at today.
    const container = drawChain(chain(105));
    const boxes = flowBoxes(container).filter((b) => /spent|left|past SOP/.test(b.text));
    const line = container.querySelector('[data-testid="chain-buffer-flow"] polyline')!;
    const pts = (line.getAttribute('points') ?? '').split(' ')
      .map((p) => p.split(',').map(Number))
      .filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py));
    expect(pts.length).toBeGreaterThan(1);
    for (const b of boxes) {
      const under = pts.filter(([px]) => px >= b.x - b.halfW && px <= b.x + b.halfW);
      for (const [, py] of under) {
        expect(Math.abs(py - b.y)).toBeGreaterThan(b.halfH);
      }
    }
  });

  it('says so in words when there is no buffer to be a share of', () => {
    // The SOP lands before the chain even starts: B₀ ≤ 0, so there is no percentage
    // story — and the chart says so rather than inventing a frame (AGENTS lesson 5).
    const container = drawChain(chain(1));
    expect(container.querySelector('[data-testid="chain-buffer-flow"]')).toBeNull();
    expect(container.textContent).toContain('No buffer to divide');
  });

  it('labels the negative half in days past the SOP, never as "days left"', () => {
    const debt = flowBoxes(drawChain(chain(105))).filter((b) => /past SOP/.test(b.text));
    expect(debt.length).toBeGreaterThan(0);
    for (const b of debt) expect(b.text).toMatch(/^−\d+% · \d+d past SOP$/);
  });
});
