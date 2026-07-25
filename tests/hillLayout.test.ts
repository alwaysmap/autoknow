import {
  layoutHill,
  hillTextWidth,
  truncateToWidth,
  freeLabelCenter,
  hillStatusOf,
  type HillLabel,
  type HillLayoutOptions,
  type HillPhase,
  type HillStatus,
} from '../src/lib/hillLayout';

// The two invariants the product owner set, expressed as tests:
//   1. every dot is on the chart and VISIBLE — coincident progress values must still
//      produce distinct positions, because a hidden dot is a bug;
//   2. in-progress labels outrank not-started/done ones when space runs out.
// The rest guard the things that broke the 15-phase Ford Evos program: labels leaving
// the viewBox, ja/ko labels truncating to half a box, and non-determinism (this chart
// renders on the server and hydrates on the client).

const STATUS_WORD: Record<HillStatus, string> = {
  notStarted: 'Not Started',
  inProgress: 'In Progress',
  done: 'Done',
};

// WIDE and NARROW differ only by an ink factor, which is what proves the layout is
// scale-free: any second factor would do, so this one is not coupled to the 0.7 the
// component happens to author. `hitRadius` is NOT ink (it is a fingertip).
const SHRUNK = 0.7;
const WIDE: HillLayoutOptions = {
  width: 420, // the `wide` variant used by the program page's hill summary
  fontSize: 8 * SHRUNK,
  axisFontSize: 7 * SHRUNK,
  dotRadius: 5.5 * SHRUNK,
  hitRadius: 8,
  statusLabel: (s) => STATUS_WORD[s],
  axisLabels: { left: 'Figuring it out', right: 'Making it happen' },
};
/** The small variant — the base ink size, un-shrunk, in a 200-unit space. */
const NARROW: HillLayoutOptions = {
  ...WIDE,
  width: 200,
  fontSize: 8,
  axisFontSize: 8,
  dotRadius: 5.5,
  hitRadius: 10,
};

const phase = (id: number, name: string, progress: number): HillPhase => ({ id, name, progress });

/** The real pathological case: Ford Evos, the built-in 15-phase AAOS template. */
const FORD: HillPhase[] = [
  phase(409, 'Architecture lock', 100),
  phase(410, 'Silicon & dev environment', 100),
  phase(411, 'BSP & power-on', 100),
  phase(412, 'Display & graphics', 100),
  phase(413, 'Audio', 100),
  phase(414, 'Connectivity', 100),
  phase(415, 'Vehicle sensors & VHAL', 62),
  phase(416, 'Camera & ADAS surfaces (EVS)', 100),
  phase(417, 'Hypervisor & mixed-criticality', 88),
  phase(418, 'App platform & Google services', 38),
  phase(419, 'Rich media', 0),
  phase(420, 'OTA & A/B updates', 100),
  phase(421, 'Compliance gates', 0),
  phase(422, 'GAS / GBI certification', 0),
  phase(423, 'Launch readiness & SOP (GBI)', 0),
];

const parseViewBox = (vb: string) => {
  const [x, y, w, h] = vb.split(' ').map(Number);
  return { x, y, w, h, top: y, bottom: y + h, right: x + w };
};

describe('layoutHill — every dot stays visible', () => {
  it('gives N phases at the same progress N distinct positions', () => {
    const tied = Array.from({ length: 8 }, (_, i) => phase(i + 1, `Phase ${i + 1}`, 100));
    const { dots } = layoutHill(tied, WIDE);
    expect(dots).toHaveLength(8);
    const keys = new Set(dots.map((d) => `${d.x}:${d.y}`));
    expect(keys.size).toBe(8);
  });

  it('separates tied dots by enough to read as a stack of coins, not one blob', () => {
    const tied = Array.from({ length: 8 }, (_, i) => phase(i + 1, `Phase ${i + 1}`, 100));
    // The shingle is a fraction of the COIN, not an absolute unit count, so the same
    // assertion holds at either ink scale (that is what keeps them one drawing).
    for (const opts of [WIDE, NARROW]) {
      const ys = layoutHill(tied, opts)
        .dots.map((d) => d.y)
        .sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i += 1) {
        expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(opts.dotRadius * 0.63);
      }
    }
  });

  it('drops no dot on the 15-phase program, whatever its progress', () => {
    const { dots } = layoutHill(FORD, WIDE);
    expect(dots).toHaveLength(FORD.length);
    expect(new Set(dots.map((d) => `${d.x}:${d.y}`)).size).toBe(FORD.length);
    expect(new Set(dots.map((d) => d.id))).toEqual(new Set(FORD.map((p) => p.id)));
  });

  it('keeps every dot inside the viewBox, however tall the stack', () => {
    const many = Array.from({ length: 24 }, (_, i) => phase(i + 1, `Phase ${i + 1}`, 100));
    for (const opts of [WIDE, NARROW]) {
      const { dots, viewBox } = layoutHill(many, opts);
      const vb = parseViewBox(viewBox);
      for (const d of dots) {
        expect(d.x - d.r).toBeGreaterThanOrEqual(vb.x);
        expect(d.x + d.r).toBeLessThanOrEqual(vb.right);
        expect(d.y - d.r).toBeGreaterThanOrEqual(vb.top);
        expect(d.y + d.r).toBeLessThanOrEqual(vb.bottom);
      }
    }
  });

  // #154 REWROTE this pair. The old rule was "in a stack, shrink the target to the
  // pitch" — which, once a stack is deep enough for the pitch to fall under the coin
  // radius, produced a target SMALLER than the dot on screen: a coin you can see and
  // aim at, with dead ink around its rim. The rule now has a floor.
  it('never gives a dot a touch target smaller than the dot you can see', () => {
    const sets: HillPhase[][] = [
      FORD,
      Array.from({ length: 8 }, (_, i) => phase(i + 1, `Phase ${i + 1}`, 100)),
      Array.from({ length: 24 }, (_, i) => phase(i + 1, `Phase ${i + 1}`, 100)), // pitch at its floor
      [phase(1, 'A', 0), phase(2, 'B', 50), phase(3, 'C', 100)],
    ];
    for (const opts of [WIDE, NARROW]) {
      for (const set of sets) {
        for (const d of layoutHill(set, opts).dots) expect(d.hitR).toBeGreaterThanOrEqual(d.r);
      }
    }
  });

  it('caps a target at half the gap to the nearest dot, unless the coin is bigger', () => {
    // The ceiling: half the distance to the nearest dot, so two targets never overlap.
    // Where that would go under the coin the floor above wins instead — and then the
    // targets overlap exactly as much as the visible coins already do, which is the
    // point: what you see is what you hit.
    for (const opts of [WIDE, NARROW]) {
      const { dots } = layoutHill(FORD, opts);
      for (const d of dots) {
        const nearest = Math.min(
          ...dots.filter((o) => o !== d).map((o) => Math.hypot(o.x - d.x, o.y - d.y)),
        );
        expect(d.hitR).toBeLessThanOrEqual(Math.max(d.r, nearest / 2) + 0.01);
      }
    }
  });

  it('leaves a lone dot its full-size touch target', () => {
    const spread = [phase(1, 'A', 0), phase(2, 'B', 50), phase(3, 'C', 100)];
    for (const d of layoutHill(spread, WIDE).dots) expect(d.hitR).toBe(WIDE.hitRadius);
  });

  it('holds the touch target at a fingertip size while the ink shrinks', () => {
    // hitRadius is a finger, not ink: shrinking the drawing must not shrink the target
    // an uncrowded dot gets. That inversion — `wide` magnifying every mark while
    // cutting hitRadius 10 -> 8 — was the defect behind #154.
    const spread = [phase(1, 'A', 0), phase(2, 'B', 50), phase(3, 'C', 100)];
    const wideDots = layoutHill(spread, WIDE).dots;
    const narrowDots = layoutHill(spread, NARROW).dots;
    expect(wideDots[0].r).toBeLessThan(narrowDots[0].r); // the coin shrank…
    expect(wideDots[0].hitR / wideDots[0].r).toBeGreaterThan(2); // …the target did not
  });

  it('never moves a dot off its own progress on the x axis', () => {
    const solo = layoutHill([phase(1, 'Only', 62)], WIDE).dots[0];
    for (const d of layoutHill(FORD, WIDE).dots) {
      if (d.id === 415) expect(d.x).toBe(solo.x); // same progress, same x, stack or not
    }
  });
});

describe('layoutHill — label priority', () => {
  const labelFor = (labels: HillLabel[], id: number) => labels.find((x) => x.anchorId === id);

  it('names every in-progress phase on the 15-phase program', () => {
    const { labels } = layoutHill(FORD, WIDE);
    for (const p of FORD.filter((x) => hillStatusOf(x.progress) === 'inProgress')) {
      const l = labelFor(labels, p.id);
      expect(l).toBeDefined();
      expect(l!.kind).toBe('phase');
      expect(l!.text.replace('…', '')).toBe(p.name.slice(0, l!.text.replace('…', '').length));
    }
  });

  it('collapses the done and not-started stacks to one status word each', () => {
    const { labels } = layoutHill(FORD, WIDE);
    const groups = labels.filter((l) => l.kind === 'group');
    expect(groups.map((g) => g.text).sort()).toEqual(['Done', 'Not Started']);
    // …and no individual done/not-started phase keeps a name of its own.
    const named = labels.filter((l) => l.kind === 'phase').map((l) => l.anchorId);
    expect(named.sort()).toEqual([415, 417, 418]);
  });

  it('keeps in-progress labels when there is only room for some', () => {
    // Long names everywhere: two in-progress phases plus a crowd of done ones.
    const crowded: HillPhase[] = [
      ...Array.from({ length: 6 }, (_, i) => phase(i + 1, `A very long finished phase name ${i}`, 100)),
      phase(20, 'A very long in-flight phase name one', 30),
      phase(21, 'A very long in-flight phase name two', 55),
      ...Array.from({ length: 6 }, (_, i) => phase(i + 30, `A very long unstarted phase name ${i}`, 0)),
    ];
    const { labels } = layoutHill(crowded, WIDE);
    expect(labelFor(labels, 20)).toBeDefined();
    expect(labelFor(labels, 21)).toBeDefined();
    // the lower-priority ones are allowed to lose their labels — but never their dots
    expect(layoutHill(crowded, WIDE).dots).toHaveLength(crowded.length);
    expect(labels.length).toBeLessThan(crowded.length);
  });

  it('names all four phases of a small program individually', () => {
    const small = [
      phase(1, 'Discovery', 0),
      phase(2, 'Build', 45),
      phase(3, 'Verify', 80),
      phase(4, 'Launch', 100),
    ];
    const { labels } = layoutHill(small, WIDE);
    expect(labels).toHaveLength(4);
    expect(labels.every((l) => l.kind === 'phase')).toBe(true);
    expect(labels.map((l) => l.text).sort()).toEqual(['Build', 'Discovery', 'Launch', 'Verify']);
  });

  it('never places two labels on top of each other', () => {
    for (const set of [FORD, Array.from({ length: 12 }, (_, i) => phase(i + 1, `Phase number ${i}`, i * 9))]) {
      const { labels } = layoutHill(set, WIDE);
      const boxes = labels.map((l) => {
        const hw = hillTextWidth(l.text, WIDE.fontSize) / 2;
        // a REALISTIC ink extent (ascenders above cap height, descenders below the
        // baseline), deliberately taller than the box the layout reasons about
        return { x0: l.x - hw, x1: l.x + hw, y0: l.y - WIDE.fontSize * 0.85, y1: l.y + WIDE.fontSize * 0.28 };
      });
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i], b = boxes[j];
          const hit = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
          expect({ pair: [labels[i].text, labels[j].text], hit }).toEqual({
            pair: [labels[i].text, labels[j].text], hit: false,
          });
        }
      }
    }
  });

  it('keeps every label inside the viewBox and clear of the axis captions', () => {
    for (const opts of [WIDE, NARROW]) {
      const { labels, viewBox } = layoutHill(FORD, opts);
      const vb = parseViewBox(viewBox);
      for (const l of labels) {
        const hw = hillTextWidth(l.text, opts.fontSize) / 2;
        expect(l.x - hw).toBeGreaterThanOrEqual(vb.x);
        expect(l.x + hw).toBeLessThanOrEqual(vb.right);
        expect(l.y - opts.fontSize).toBeGreaterThanOrEqual(vb.top);
        expect(l.y).toBeLessThanOrEqual(vb.bottom);
        expect(l.y - opts.fontSize).toBeLessThan(99 - opts.axisFontSize); // above the captions
      }
    }
  });
});

describe('layoutHill — determinism and locale', () => {
  it('produces byte-identical output across calls (server render === hydration)', () => {
    expect(JSON.stringify(layoutHill(FORD, WIDE))).toBe(JSON.stringify(layoutHill(FORD, WIDE)));
  });

  it('depends on input order only through stable tie-breaks, never on identity', () => {
    const a = layoutHill(FORD, WIDE);
    const b = layoutHill([...FORD], WIDE);
    expect(b).toEqual(a);
  });

  it('lays out ja/ko names without spilling — CJK glyphs count double', () => {
    const ja = FORD.map((p, i) => phase(p.id, `フェーズ${i}の名前です`, p.progress));
    const { labels, viewBox } = layoutHill(ja, WIDE);
    const vb = parseViewBox(viewBox);
    for (const l of labels) {
      const hw = hillTextWidth(l.text, WIDE.fontSize) / 2;
      expect(l.x + hw).toBeLessThanOrEqual(vb.right);
      expect(l.x - hw).toBeGreaterThanOrEqual(vb.x);
    }
  });
});

describe('text measurement', () => {
  it('counts CJK glyphs as roughly twice a latin one', () => {
    expect(hillTextWidth('日本語', 10)).toBeGreaterThan(hillTextWidth('abc', 10) * 1.5);
  });

  it('truncates by width, so a CJK label keeps the same box as a latin one', () => {
    const max = 40;
    expect(hillTextWidth(truncateToWidth('Silicon & dev environment', 8, max), 8)).toBeLessThanOrEqual(max);
    expect(hillTextWidth(truncateToWidth('シリコンと開発環境の整備', 8, max), 8)).toBeLessThanOrEqual(max);
  });

  it('leaves a short label alone', () => {
    expect(truncateToWidth('Audio', 8, 200)).toBe('Audio');
  });
});

describe('freeLabelCenter', () => {
  const box = (x0: number, x1: number) => ({ x0, x1, y0: 0, y1: 10 });
  const GAP_X = 7; // the horizontal clearance at the base label size (8 units)

  it('returns the anchor when nothing is in the way', () => {
    expect(freeLabelCenter(100, 20, [], 400, GAP_X)).toBe(100);
  });

  it('slides the label sideways to clear an obstacle instead of dropping it', () => {
    const x = freeLabelCenter(100, 20, [box(110, 120)], 400, GAP_X);
    expect(x).not.toBeNull();
    expect(x! + 20).toBeLessThanOrEqual(110);
  });

  it('clamps to the chart rather than overhanging its edge', () => {
    expect(freeLabelCenter(400, 30, [], 400, GAP_X)).toBe(368);
    expect(freeLabelCenter(0, 30, [], 400, GAP_X)).toBe(32);
  });

  it('gives up when the label cannot fit at all', () => {
    expect(freeLabelCenter(100, 300, [], 400, GAP_X)).toBeNull();
    expect(freeLabelCenter(100, 90, [box(0, 400)], 400, GAP_X)).toBeNull();
  });

  it('scales the clearance with the label size — smaller type, tighter packing', () => {
    // At the base size the obstacle pushes the label further left than at a third of
    // it: the gap is ~3 space-widths of the label's OWN type, not an absolute count.
    const big = freeLabelCenter(100, 20, [box(110, 120)], 400, GAP_X)!;
    const small = freeLabelCenter(100, 20, [box(110, 120)], 400, GAP_X / 3)!;
    expect(small).toBeGreaterThan(big);
  });
});

describe('hillStatusOf', () => {
  it('reads status off the progress, with 0 and 100 as the boundaries', () => {
    expect(hillStatusOf(0)).toBe('notStarted');
    expect(hillStatusOf(1)).toBe('inProgress');
    expect(hillStatusOf(99)).toBe('inProgress');
    expect(hillStatusOf(100)).toBe('done');
  });
});
