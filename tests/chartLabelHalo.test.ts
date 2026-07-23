/** @jest-environment node */
// Issue #23: SVG chart labels had no halo, so wherever a label crossed ink — a
// buffer band, a bar, a grid line, or another label — it became unreadable. The
// fix (`paint-order: stroke` + a background-token stroke) existed in ONE chart and
// was missing in five, because the `<text>` triple was hand-copied (AGENTS lesson
// 7, inverted). It now lives in exactly one place — `ChartLabel` — so it cannot
// drift. This locks the converted charts: a bare `<text>` creeping back in (which
// would silently lose the halo) fails here.
import { readFileSync } from 'node:fs';

const CHART_COMPONENTS = [
  'ChainLedger',
  'PhaseTrack',
  'PhaseHillGauge',
  'PhaseHillChart',
  'CapacityChart',
  'CycleTimeScatterPlot',
];

describe('chart labels go through ChartLabel, so the halo cannot drift (#23)', () => {
  it.each(CHART_COMPONENTS)('%s imports ChartLabel and renders no bare <text>', (name) => {
    const src = readFileSync(`src/components/${name}.tsx`, 'utf8');
    expect(src).toContain("import ChartLabel from './ChartLabel'");
    // A bare `<text` opening tag would be an unhaloed label; labels go through ChartLabel.
    expect(src.match(/<text[\s>]/g) ?? []).toEqual([]);
  });

  it('ChartLabel is the single home of the halo (paint-order lives there)', () => {
    expect(readFileSync('src/components/ChartLabel.tsx', 'utf8')).toContain('paintOrder="stroke"');
  });
});
