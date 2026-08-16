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
import { DateLabelsProvider } from '../src/components/DateLabelsProvider';
import type { DateLabelMode } from '../src/lib/dates';
import CapacityChart, { type CapacityChartProgram } from '../src/components/CapacityChart';
import CycleTimeScatterPlot, { type CycleTimeData, type CycleTimeStats } from '../src/components/CycleTimeScatterPlot';
import { ChainSchedule, W as CHAIN_W } from '../src/components/ChainSchedule';
import { computeChainLedger, type ChainLedgerInput, type LedgerPhaseInput } from '../src/lib/chainLedger';
import {
  keepNonOverlapping,
  dodgeLabels,
  estimateTextWidth,
  baselineToCentreY,
  halfHFor,
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
  // ONE y convention in this file, and it is the CENTRE, because that is what every box
  // here means. An SVG <text> carries its BASELINE instead, and mixing the two is
  // invisible in label-on-label checks (same size ⇒ same shift, so it cancels) and wrong
  // in every label-on-INK check, by about a third of a cap height.
  const cy = baselineToCentreY(Number(el.getAttribute('y')), fs);
  return { text, x: cx, y: cy, halfW: w / 2, halfH: halfHFor(fs) };
}

const isHorizontal = (el: SVGLineElement) => Number(el.getAttribute('y1')) === Number(el.getAttribute('y2'));

/** A rendered <line> as the box of ink it lays down, stroke included. */
const lineBox = (el: SVGLineElement) => {
  const n = (a: string) => Number(el.getAttribute(a));
  const w = Number(el.getAttribute('stroke-width')) || 1;
  const horizontal = isHorizontal(el);
  return {
    text: `${horizontal ? 'rule' : 'vertical'} @ ${horizontal ? `y${n('y1')}` : `x${n('x1')}`}`,
    x: (n('x1') + n('x2')) / 2, y: (n('y1') + n('y2')) / 2,
    halfW: Math.abs(n('x2') - n('x1')) / 2 + w / 2,
    halfH: Math.abs(n('y2') - n('y1')) / 2 + w / 2,
  };
};

/** Every HORIZONTAL rule painted inside `scope`. A gridline, threshold or axis rule is ink
 *  a label must clear, and it is NOT the box the placement pass was handed: the pass got
 *  the rule's tick CAPTION, off in the gutter, which nothing in the plot can overlap in x.
 *  That is the whole bug §4 exists for, so every chart here is now asked the question. */
const rulesIn = (scope: Element) =>
  Array.from(scope.querySelectorAll<SVGLineElement>('line')).filter(isHorizontal).map(lineBox);

/** No label in `boxes` may sit on any horizontal rule painted in `scope`. */
function expectOffTheRules(boxes: (Box & { text: string })[], scope: Element) {
  const rules = rulesIn(scope);
  expect(rules.length).toBeGreaterThan(0); // a chart with no rules proves nothing here
  expect(boxes.flatMap((l) => rules.filter((r) => intersects(l, r)).map((r) => `"${l.text}" on ${r.text}`)))
    .toEqual([]);
}

const wrap = (ui: React.ReactNode, dateLabels: DateLabelMode = 'date') =>
  render(
    <LocaleProvider locale="en">
      {/* charts read `modes.prose`; `modes.table` is irrelevant here and pinned to the
          default so a table preference can never move a chart's geometry. */}
      <DateLabelsProvider modes={{ prose: dateLabels, table: 'date' }}>{ui}</DateLabelsProvider>
    </LocaleProvider>,
  );

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
    // `y` is a box centre here (see boxOf), so this is a loose containment check, not the
    // exact clamp — dodgeLabels' own bounds are asserted mechanically in §1.
    for (const b of bandBoxes(container)) {
      expect(b.y).toBeGreaterThan(16);
      expect(b.y).toBeLessThan(340 - 30);
    }
  });

  it('keeps every band label off the chart\'s own horizontal rules', () => {
    // This chart does NOT pass its rules into its placement pass — it clears them by
    // arithmetic (labels sit outside the plot's right edge). Asserted as an OUTCOME, so a
    // failure here means "start passing the ink", not "the test is wrong".
    const { container } = wrap(<CapacityChart programs={crowded} now={NOW} />);
    expectOffTheRules(bandBoxes(container), container);
  });
});

// ---- 3. CycleTimeScatterPlot: the healthy tight spread is the crowding case ------
//
// The chart is ONE population now, not one row per phase name, so there are exactly three
// captions instead of two per phase. The crowding case did not go away with the rows — it
// got sharper: p50/p85/p95 sit at their own line heights, so the TIGHTER the distribution
// the closer the three captions get, and a tight distribution is the healthy one.

describe('CycleTimeScatterPlot — the healthy tight spread is the crowding case', () => {
  const data: CycleTimeData[] = [10, 12, 11, 13, 12, 11].map((cycleTimeDays, j) => ({
    phaseId: j,
    phaseName: `Phase ${j}`,
    projectId: 1,
    programName: 'Demo program',
    finishedAt: new Date(Date.UTC(2026, 0, 1 + j)).toISOString(),
    cycleTimeDays,
  }));

  /** All three equal: the tightest possible spread, and the one that used to print three
   *  captions on one pixel. `sampleSize` is over MIN_SAMPLE so the lines actually draw. */
  const identical: CycleTimeStats = { p50: 12, p85: 12, p95: 12, sampleSize: 6 };
  /** A day apart each — still inside a caption's height, so still a collision. */
  const nearlyIdentical: CycleTimeStats = { p50: 12, p85: 13, p95: 14, sampleSize: 6 };
  /** A wide spread: nothing to de-collide, and the captions must NOT move. */
  const wide: CycleTimeStats = { p50: 5, p85: 40, p95: 60, sampleSize: 6 };

  const captionBoxes = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<SVGTextElement>('[data-testid^="cycle-p"]'))
      .map((el) => ({ ...boxOf(el, 10), id: el.getAttribute('data-testid')! }));

  it.each([
    ['all three identical', identical],
    ['one day apart', nearlyIdentical],
    ['a wide spread', wide],
  ])('never overlaps a percentile caption — %s', (_name, stats) => {
    const { container } = wrap(<CycleTimeScatterPlot data={data} stats={stats} />);
    const boxes = captionBoxes(container);
    expect(boxes).toHaveLength(3);
    expect(collidingPairs(boxes)).toEqual([]);
  });

  it('keeps ALL THREE captions when they collide — no scale here recovers a hidden one', () => {
    // dodgeLabels, not keepNonOverlapping: the y axis reads in days, but nothing on the
    // chart tells you WHICH percentile a line is except its caption, so hiding one destroys
    // the fact rather than making the reader work for it.
    const { container } = wrap(<CycleTimeScatterPlot data={data} stats={identical} />);
    const ids = captionBoxes(container).map((b) => b.id).sort();
    expect(ids).toEqual(['cycle-p50', 'cycle-p85', 'cycle-p95']);
  });

  it('moves only the caption — the reference LINE stays on its true value', () => {
    const { container } = wrap(<CycleTimeScatterPlot data={data} stats={identical} />);
    // All three lines are the same value here, so all three must be drawn at one y even
    // though their captions were dodged apart. A caption that dragged its line with it
    // would be the chart lying about the number.
    const refLineYs = new Set(
      Array.from(container.querySelectorAll<SVGLineElement>('[data-testid^="cycle-line-"]'))
        .map((l) => l.getAttribute('y1')),
    );
    expect(refLineYs.size).toBe(1);
    expect(new Set(captionBoxes(container).map((b) => b.y)).size).toBe(3); // dodged apart
  });

  it('leaves an uncrowded set on its own lines, not merely at three distinct heights', () => {
    // "Three distinct ys" is what a DODGED set produces too, so it cannot tell the two
    // apart. This asserts the stronger thing: every caption sits on the line it names.
    //
    // The fixture carries a 100-day point on purpose. `maxDays` is driven by the largest of
    // the data and p95, so a p95 at the top of the range lands on `marginTop` and
    // `dodgeLabels` clamps its caption inward to keep it from clipping — correct, but it is
    // a CLAMP, not a dodge, and it would make this assertion fail for a reason the test is
    // not about.
    const roomy: CycleTimeData[] = [...data, {
      phaseId: 99, phaseName: 'Long one', projectId: 1, programName: 'Demo program',
      finishedAt: new Date(Date.UTC(2026, 0, 9)).toISOString(), cycleTimeDays: 100,
    }];
    const { container } = wrap(<CycleTimeScatterPlot data={roomy} stats={wide} />);
    // Raw `y` attributes on both sides. `boxOf` returns a label's CENTRE, and the caption's
    // y is a BASELINE, so comparing those two would be off by the baseline-to-centre delta
    // for every caption — a constant that has nothing to do with dodging.
    const attrYs = (sel: string) =>
      Array.from(container.querySelectorAll<SVGElement>(sel))
        .map((el) => Number(el.getAttribute(sel.includes('line') ? 'y1' : 'y')))
        .sort((a, b) => a - b);
    const captionYs = attrYs('[data-testid^="cycle-p"]');
    const lineYs = attrYs('[data-testid^="cycle-line-"]');
    expect(captionYs).toHaveLength(3);
    captionYs.forEach((y, i) => expect(y).toBeCloseTo(lineYs[i], 0));
  });

  it('draws no percentile lines at all when the sample is too thin to support them', () => {
    const { container } = wrap(
      <CycleTimeScatterPlot data={data} stats={{ p50: 12, p85: 12, p95: 12, sampleSize: 2 }} />,
    );
    expect(captionBoxes(container)).toHaveLength(0);
  });

  it("keeps every percentile caption off the chart's own horizontal rules", () => {
    const { container } = wrap(<CycleTimeScatterPlot data={data} stats={identical} />);
    expectOffTheRules(captionBoxes(container), container);
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

  const drawChain = (input: ChainLedgerInput, dateLabels: DateLabelMode = 'date') => wrap(
    <ChainSchedule
      ledger={computeChainLedger(input)}
      sopMs={input.sopDate ? +new Date(input.sopDate) : null}
      now={input.now}
      locale="en"
      onDay={() => {}}
      onJump={() => {}}
    />,
    dateLabels,
  ).container;

  /** Two phases hand days BACK and the live one is on time, so the program carries MORE
   *  buffer than it started with. The boundary then rides in the frame's top pad, where
   *  there is no plot above it — the shape the screenshot caught, with "115% left · 157d"
   *  printed straight through the 100% gridline and "spent" pinned onto the boundary by
   *  the dodge's own bounds clamp. NOT the leftPct === 100 case: any value at or above
   *  the top gridline reproduces it, and a fix predicated on 100 misses this fixture. */
  const aboveStart: ChainLedgerInput = {
    phases: [
      phase(1, 'Design', 30, 100, [], iso(0), iso(23)),
      phase(2, 'Build', 40, 100, [1], iso(23), iso(56)),
      phase(3, 'Certification', 30, 10, [2], iso(56)),
    ],
    sopDate: iso(150),
    now: day(60),
  };

  const flowEl = (container: HTMLElement) => {
    const flow = container.querySelector('[data-testid="chain-buffer-flow"]');
    if (!flow) throw new Error('the buffer flow did not render for this fixture');
    return flow;
  };

  const flowBoxes = (container: HTMLElement) =>
    Array.from(flowEl(container).querySelectorAll<SVGTextElement>('text')).map((el) => boxOf(el, 10));

  /** Every VERTICAL rule in the whole instrument: today, the SOP, the break seams. */
  const verticals = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<SVGLineElement>('svg line'))
      .filter((el) => !isHorizontal(el))
      .map(lineBox);

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

  it('reads clean when the buffer is ABOVE the level it started at', () => {
    expectReadable(drawChain(aboveStart));
  });

  /** guidelineDays is remainingTotal/2 — a LONG remaining chain against a SHORT gap
   *  between the original plan and the SOP puts the reserve marker well above 100% of
   *  B₀ (autoknow-4dr.2's bug: B₀=62d, reserve=~150d, seeded demo). Design finishes
   *  exactly on plan (no buffer moved by it), so B₀ is set purely by how tight the SOP
   *  sits against the 430-day planned chain; Build and Certification carry the long
   *  remaining work the 50%-rule halves. */
  const bigReserve: ChainLedgerInput = {
    phases: [
      phase(1, 'Design', 30, 100, [], iso(0), iso(30)),
      phase(2, 'Build', 200, 20, [1], iso(30)),
      phase(3, 'Certification', 200, 0, [2]),
    ],
    sopDate: iso(450), // 430-day planned chain + 20-day B₀
    now: day(40),
  };

  it('draws the reserve OFF the frame\'s top, in words, rather than dropping it (autoknow-4dr.2)', () => {
    const container = drawChain(bigReserve);
    const boxes = expectReadable(container);
    const offScale = boxes.filter((b) => /reserve — above frame/.test(b.text));
    expect(offScale).toHaveLength(1);
    // Not the in-frame marker too — the two are mutually exclusive readings of the
    // same value, and printing both would say it twice, differently.
    expect(boxes.filter((b) => /^\d+d reserve$/.test(b.text))).toHaveLength(0);
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

  it.each([
    ['a blown buffer', chain(105)],
    ['a buffer ABOVE the level it started at', aboveStart],
  ])('keeps the readings off the boundary line, which slopes under them — %s', (_name, input) => {
    // The flow's own polyline is ink a placement pass cannot see. Each reading clears
    // the line across ITS OWN width — so assert against the drawn points, not a fixed
    // offset from the value at today.
    const container = drawChain(input);
    const boxes = flowBoxes(container).filter((b) => /spent|left|past SOP/.test(b.text));
    // BOTH halves: the boundary is drawn as a solid past and a dashed forecast, and the
    // reading at today sits to today's RIGHT — i.e. over the forecast half. Sampling only
    // the first polyline read the ink on the wrong side of the label and reported clear.
    const pts = Array.from(container.querySelectorAll('[data-testid="chain-buffer-flow"] polyline'))
      .flatMap((line) => (line.getAttribute('points') ?? '').split(' '))
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

  it.each([
    ['a healthy program', chain(200)],
    ['a blown buffer', chain(105)],
    ['a buffer ABOVE the level it started at', aboveStart],
  ])('keeps every flow label off every gridline — %s', (_name, input) => {
    // The regression this file exists for, one level down: `dodgeLabels` was handed the
    // gridlines' CAPTIONS and not the gridlines, so it reported clear while the reading
    // sat on the rule. Assert against the rendered ink itself, which cannot lie about it.
    const container = drawChain(input);
    expectOffTheRules(flowBoxes(container), flowEl(container));
  });

  it('reproduces the top-pad case at all — the fixture must actually hold >100%', () => {
    // A fixture that quietly stopped reproducing would turn the check above green for the
    // wrong reason, so it states the condition it is there to exercise.
    const reading = flowBoxes(drawChain(aboveStart)).find((b) => /left · /.test(b.text));
    expect(reading?.text).toMatch(/^1[0-9]{2}% left · /);
  });

  it('never runs a vertical rule through the flow caption', () => {
    // today / the SOP / a break seam all reach down into the flow, and the caption sits in
    // the gutter they cross. Vertical ink is the one collision no placement pass can fix
    // (they nudge in y), so the rules are cut around the caption instead.
    const container = drawChain(aboveStart);
    const title = container.querySelector<SVGTextElement>('[data-testid="chain-flow-title"]');
    expect(title).not.toBeNull();
    const box = boxOf(title!, 10);
    const hits = verticals(container).filter((v) => intersects(box, v)).map((v) => v.text);
    expect(hits).toEqual([]);
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

  // ---- 5. Option A's row area: the per-bar variance numbers and the idle counts ------
  //
  // The row area places its labels by ARITHMETIC — a flip at the frame's right edge and a
  // halo — rather than through a y-nudging pass, because a row is 34 tall around a 19-tall
  // bar and a nudge that cleared the bar would leave the row, putting a variance number on
  // a phase that did not run over. That is a claim about geometry, so it is asserted from
  // the rendered geometry here rather than trusted from the comment that makes it.
  describe('Option A bars — the numbers beside the tails', () => {
    const rowBoxes = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<SVGTextElement>('svg > g text'))
        // The flow is its own <g> with its own §4 coverage above; this is the row area.
        .filter((el) => !el.closest('[data-testid="chain-buffer-flow"]'))
        .map((el) => boxOf(el, 10));

    const varianceBoxes = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<SVGTextElement>('[data-testid^="chain-bar-variance-"]'))
        .map((el) => boxOf(el, 10));

    /** Every phase in the chain moves the buffer, in every direction the encoding has a
     *  mark for: A hands 7 days back, B sat idle 6 days then ran 9 over, C is live and
     *  forecast well over, D is queued behind it. The crowding case for this area is a
     *  chain where EVERY row wants a number. */
    const everyRowMoves: ChainLedgerInput = {
      phases: [
        phase(1, 'Design', 30, 100, [], iso(0), iso(23)),
        phase(2, 'Build', 40, 100, [1], iso(29), iso(78)),
        phase(3, 'Certification', 30, 20, [2], iso(78)),
        phase(4, 'Launch prep', 20, 0, [3]),
      ],
      sopDate: iso(200),
      now: day(100),
    };

    it('gives every row that moved the buffer a number, and no two of them collide', () => {
      const container = drawChain(everyRowMoves);
      const v = varianceBoxes(container);
      // A −7d underrun, a +9d realized overrun and a forecast overrun on the live phase.
      expect(v.map((b) => b.text).filter((s) => /^[+−]\d+d$/.test(s))).toHaveLength(3);
      expect(collidingPairs(rowBoxes(container))).toEqual([]);
    });

    it('signs the numbers from the data: a phase that finished early reads −, one that ran over reads +', () => {
      const texts = varianceBoxes(drawChain(everyRowMoves)).map((b) => b.text);
      expect(texts).toContain('−7d');  // Design: 23 days against a 30-day estimate
      expect(texts.filter((s) => s.startsWith('+'))).toHaveLength(2);
    });

    it('never lets a number run off the frame, however close to the SOP its tail ends', () => {
      // The live phase's forecast tail is what reaches furthest right, and the axis reaches
      // the SOP — so a number anchored to the tail's right is the one that clips. Three
      // fixtures, because the flip must not trade a clip for an overlap.
      //
      // Scoped to the labels the ROW AREA places (the numbers and the idle counts), not to
      // every <text> in it: the phase NAMES are clamped by a gutter ChainSchedule sizes
      // with its own narrower width estimator (6.5px/char against this module's 0.59em),
      // so measured here a long name reads a few px wider than the gutter reserved for it.
      // That gap is bead autoknow-9xf and is called out in labelPlacement.ts's own header;
      // asserting it from here would fail on a discrepancy this step neither caused nor
      // can close, and would say nothing about the marks it added.
      for (const input of [everyRowMoves, chain(105), chain(200)]) {
        const container = drawChain(input);
        const placed = [...varianceBoxes(container), ...rowBoxes(container).filter((b) => /idle$/.test(b.text))];
        expect(placed.length).toBeGreaterThan(0);
        for (const b of placed) {
          expect(b.x - b.halfW).toBeGreaterThanOrEqual(0);
          expect(b.x + b.halfW).toBeLessThanOrEqual(CHAIN_W);
        }
      }
    });

    it('gives no number to a phase that moved no buffer — the mark and the number agree', () => {
      // Every phase lands on its estimate, so no row draws a tail and no row carries a
      // number. The two are chosen from ONE set of predicates; a number with no tail (or
      // the reverse) is the +1-day-phase bug that rule exists to prevent.
      const onPlan: ChainLedgerInput = {
        phases: [
          phase(1, 'Design', 30, 100, [], iso(0), iso(30)),
          phase(2, 'Build', 20, 100, [1], iso(30), iso(50)),
        ],
        sopDate: iso(200),
        now: day(60),
      };
      expect(varianceBoxes(drawChain(onPlan))).toEqual([]);
    });

    it('keeps the idle count clear of the numbers around it', () => {
      const container = drawChain(everyRowMoves);
      const idle = rowBoxes(container).filter((b) => /idle$/.test(b.text));
      expect(idle).toHaveLength(1); // Build sat idle 6 days after Design finished
      const others = rowBoxes(container).filter((b) => !/idle$/.test(b.text));
      expect(idle.flatMap((i) => others.filter((o) => intersects(i, o)).map((o) => `"${i.text}" ⟷ "${o.text}"`)))
        .toEqual([]);
    });

    /** The shape that produced the defect: a phase over-runs, and the SHORT gap that opens
     *  because of it starts at the end of the tail the number sits beside. Before the fix
     *  the two labels landed 12.8px apart — 0.8px of clearance against the 12px their
     *  boxes reserve — in the same column. That is why this is its own fixture: on a chain
     *  whose gaps follow UNDER-runs the pair never meets, and the sweep is green for a
     *  reason that has nothing to do with the placement. */
    const overrunThenGap: ChainLedgerInput = {
      phases: [
        phase(1, 'Design', 30, 100, [], iso(0), iso(39)),
        phase(2, 'Build', 40, 50, [1], iso(46)),
        phase(3, 'Certification', 30, 0, [2]),
      ],
      sopDate: iso(200),
      now: day(60),
    };

    /** Vertical air demanded BEYOND the two boxes. Deliberately close to what the layout
     *  achieves: separation is `ROW_H / 2 + IDLE_DY` = 19 against the 18 this asks for. The
     *  slack is tight on purpose — the pre-fix 12.8px passed every intersection test, so a
     *  threshold chosen to sit comfortably under the achieved value would not have caught
     *  that either. It is 1px of headroom, not 1px of sensitivity: the guard is strict, so
     *  it takes IDLE_DY 2 → 0, or ROW_H 34 → 31, to fire. Shrinking either by ONE pixel
     *  still passes here, and this test is not what would catch it. */
    const REQUIRED_AIR = 6;

    it('separates an idle count from the variance number above it in X, not by a hair in Y', () => {
      // Not intersecting is deliberately NOT the bar here. Two boxes that merely fail to
      // intersect can be zero pixels apart — `overlaps()` is a strict test — and at that
      // distance, in one column, they read as a single stacked pair of numbers about two
      // different phases. No overlap test can say so, so this one asks for air: clear in x,
      // or clear in y by MORE than the two boxes.
      for (const input of [overrunThenGap, everyRowMoves]) {
        const boxes = rowBoxes(drawChain(input));
        const idle = boxes.filter((b) => /idle$/.test(b.text));
        const numbers = boxes.filter((b) => /^[+−]\d+d$/.test(b.text));
        expect(idle.length).toBeGreaterThan(0);
        expect(numbers.length).toBeGreaterThan(0);
        expect(idle.flatMap((i) => numbers
          .filter((n) => Math.abs(i.x - n.x) < i.halfW + n.halfW
            && Math.abs(i.y - n.y) < i.halfH + n.halfH + REQUIRED_AIR)
          .map((n) => `"${i.text}" crowds "${n.text}" (Δy ${Math.abs(i.y - n.y).toFixed(1)})`)))
          .toEqual([]);
      }
    });

    it('reproduces the crowding shape at all — the gap must follow the OVER-run', () => {
      // A fixture that quietly stopped reproducing would turn the check above green for the
      // wrong reason, so it states the two conditions it exists to exercise: the two labels
      // are inside one row pitch of each other (so the pitch gives no relief), and the gap
      // they describe is too short to hold the count (so the count cannot centre away).
      const boxes = rowBoxes(drawChain(overrunThenGap));
      const over = boxes.find((b) => b.text === '+9d');
      const idle = boxes.find((b) => /idle$/.test(b.text));
      expect(over).toBeDefined();
      expect(idle).toBeDefined();
      expect(Math.abs(idle!.y - over!.y)).toBeLessThan(34); // ChainSchedule's ROW_H
      // The gap runs from the end of Design's tail to the start of Build's bar; the count is
      // wider than it, which is why it steps beside the rule instead of centring on it.
      const rule = Array.from(drawChain(overrunThenGap).querySelectorAll<SVGLineElement>('line'))
        .filter(isHorizontal)
        .map(lineBox)
        .find((l) => Math.abs(l.y - idle!.y) < 2);
      expect(rule).toBeDefined();
      // 16 restates ChainSchedule's IDLE_CENTRE_AIR. Deliberately a literal: this asserts
      // the FIXTURE is on the short side of the threshold, and reading the threshold from
      // the component would make the assertion move with it and stop reproducing.
      expect(rule!.halfW * 2).toBeLessThan(idle!.halfW * 2 + 16);
    });

    it('never swallows the idle rule into the label that names it', () => {
      // The count rides its rule's line and is haloed, which knocks the dashes out behind
      // it. On a gap shorter than the label that is the whole mark, so the count steps
      // beside the rule instead of centring on it — otherwise the amber dashes vanish and
      // the chart says nothing happened between the two phases (AGENTS lesson 18).
      const container = drawChain(overrunThenGap);
      const idle = rowBoxes(container).find((b) => /idle$/.test(b.text))!;
      const rule = Array.from(container.querySelectorAll<SVGLineElement>('line'))
        .filter(isHorizontal).map(lineBox).find((l) => Math.abs(l.y - idle.y) < 2)!;
      const covered = Math.max(0,
        Math.min(idle.x + idle.halfW, rule.x + rule.halfW) - Math.max(idle.x - idle.halfW, rule.x - rule.halfW));
      expect(covered).toBeLessThan(rule.halfW); // less than half the rule knocked out
    });
  });

  // ---- 6. the axis under every DATE_LABELS mode -------------------------------------
  //
  // The calendar-week preference is the only thing in this app that changes chart
  // GEOMETRY from a user setting: the week tier adds a second axis line, which moves the
  // buffer flow, the crosshair caption and the viewBox height below it. So the crowding
  // fixtures above are re-run in all three modes rather than only the default — the point
  // being that "no labels collide" was asserted for a layout no reader may ever see.
  //
  // The crowding case is the WIDE chain: ~29 weeks of columns a few px apart, where the
  // week numbers cannot all fit and the pass has to thin them. A narrow chain fits nearly
  // all of them and would prove nothing (AGENTS lesson 19 — the healthy dataset is the
  // one that crowds).
  describe('the week tier — one axis, three modes, no collisions in any of them', () => {
    const MODES: DateLabelMode[] = ['date', 'date-week', 'week'];

    /** Every <text> the AXIS band draws: week numbers, month letters, break durations.
     *  Identified by y rather than by a testid so a label added to the band later is
     *  swept in automatically instead of being invisible to this check. */
    const axisBoxes = (container: HTMLElement) => {
      const all = Array.from(container.querySelectorAll<SVGTextElement>('svg text'))
        .filter((el) => !el.closest('[data-testid="chain-buffer-flow"]'))
        .map((el) => boxOf(el, 11));
      const weekLike = all.filter((b) => /^W\d+$/.test(b.text));
      // The band runs from the topmost axis label down; anchor it on the axis rule's own
      // labels rather than a literal y, which would drift with ROW_H or the row count.
      const bandTop = Math.min(...all.filter((b) => /^W\d+$|^\d+ days$/.test(b.text)).map((b) => b.y), Infinity);
      return {
        weeks: weekLike,
        band: Number.isFinite(bandTop) ? all.filter((b) => b.y >= bandTop - 2) : [],
      };
    };

    const wide = chain(200); // 29 weeks of columns — the axis is genuinely crowded

    it.each(MODES)('places every axis label clear of every other one (%s)', (mode) => {
      const { band } = axisBoxes(drawChain(wide, mode));
      expect(band.length).toBeGreaterThan(0);
      expect(collidingPairs(band)).toEqual([]);
    });

    it('draws the tier only for the modes that asked for weeks', () => {
      expect(axisBoxes(drawChain(wide, 'date')).weeks).toEqual([]);
      // Both week-bearing modes get the SAME tier: it labels COLUMNS, not days, so
      // "date and week" has nothing extra to add here — the modes diverge on the labels
      // that name a DAY, which the next test covers.
      const dw = axisBoxes(drawChain(wide, 'date-week')).weeks.map((b) => b.text);
      const wk = axisBoxes(drawChain(wide, 'week')).weeks.map((b) => b.text);
      expect(dw.length).toBeGreaterThan(2);
      expect(wk).toEqual(dw);
    });

    it("keeps the week numbers ASCENDING left to right — the thinning drops labels, never reorders columns", () => {
      const kept = axisBoxes(drawChain(wide, 'week')).weeks
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((b) => Number(b.text.slice(1)));
      // A chain inside one year: strictly increasing. (Across a year boundary the numbers
      // restart, which is what `isoWeekYearLabel` exists for elsewhere — not on this axis,
      // where the month letters below carry the frame.)
      for (let i = 1; i < kept.length; i++) expect(kept[i]).toBeGreaterThan(kept[i - 1]);
    });

    it('writes the DAY markers in the mode the reader chose', () => {
      const marker = (mode: DateLabelMode) =>
        Array.from(drawChain(wide, mode).querySelectorAll<SVGTextElement>('svg text'))
          .map((el) => el.textContent ?? '')
          .find((s) => s.startsWith('today ·'))!;
      expect(marker('date')).toMatch(/^today · \w+ \d+$/);              // today · Mar 2
      expect(marker('date-week')).toMatch(/^today · \w+ \d+ \(W\d+\)$/); // today · Mar 2 (W10)
      expect(marker('week')).toMatch(/^today · W\d+$/);                  // today · W10
    });

    it('grows the drawing rather than overprinting it — the tier costs real height', () => {
      const heightOf = (mode: DateLabelMode) => {
        const svg = drawChain(wide, mode).querySelector('svg')!;
        return Number(svg.getAttribute('viewBox')!.split(' ')[3]);
      };
      // The flow, the crosshair caption and the viewBox all derive from the axis height,
      // so a tier that did NOT change this would be a tier drawn on top of the months.
      expect(heightOf('week')).toBeGreaterThan(heightOf('date'));
      expect(heightOf('week')).toBe(heightOf('date-week'));
    });
  });
});
