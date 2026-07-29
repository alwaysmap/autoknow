/** @jest-environment jsdom */
// #165: a hill-history entry's date + who moved from a meta row below the chart into
// a ChartLabel caption in the curve's structurally-empty top-left corner, and the
// status word was dropped in favor of recoloring the coin itself (`hillStatusColor`)
// rather than carrying status as a fourth encoding next to the curve's own position.
//
// Three things this pins down, from the acceptance criteria in #165 rather than from
// re-reading the implementation:
//  1. The caption truncates instead of overflowing its box.
//  2. It ALSO shrinks (or drops) when the entry's own dot climbs into the same corner
//     — a mid-progress update (~25-30%) puts the dot right where a long caption would
//     otherwise reach, and #161's "two labels may never overlap" is written to cover a
//     label overlapping a MARK too. This is the collision case AGENTS lesson 19 treats
//     as blocking, not the seed data's low/high progress that would pass by accident.
//  3. The coin's color is `hillStatusColor(progress)`, not a fixed per-phase identity
//     color, so the status the old word carried is not lost when the word is.
import React from 'react';
import { render } from '@testing-library/react';

// HillHistoryList pulls in PhaseHillGauge for PhaseHillSvg, which imports the
// `updatePhaseHill` action (used only by the editable default export, never by
// PhaseHillSvg itself) — that module reaches `next/cache` at import time, which
// jsdom cannot evaluate (no TextEncoder). Mocked the same way tests/phaseHill.test.ts
// mocks it for its own (node-environment) run.
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('../src/app/actions/hill', () => ({ updatePhaseHill: jest.fn() }));
// react-markdown is ESM-only and untransformed under this jest config; the note body
// it renders is not what this suite is about, so a stub stands in for it.
jest.mock('../src/components/Markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => children }));

import { LocaleProvider } from '../src/components/LocaleProvider';
import HillHistoryList from '../src/components/HillHistoryList';
import { PhaseHillSvg } from '../src/components/PhaseHillGauge';
import { hillStatusColor } from '../src/lib/phase';
import type { HillChange } from '../src/lib/history';

const LONG_SOURCE = 'Alexandria Q. Winterbourne-Fitzgerald III';

const renderList = (progress: number, source: string) => {
  const change: HillChange = { id: 1, timestamp: '2026-06-01T00:00:00.000Z', progress, previousProgress: null, notes: 'note', source };
  const { container } = render(
    <LocaleProvider locale="en">
      <HillHistoryList changes={[change]} />
    </LocaleProvider>,
  );
  return container;
};

const caption = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('text')).find((el) => el.getAttribute('text-anchor') === 'start');

describe('HillHistoryList top-left caption (#165)', () => {
  it('truncates a long source name rather than overflowing its box', () => {
    // Low progress: the dot sits far down at the curve's start, nowhere near the
    // top-left corner, so this exercises the STRING-length truncation alone.
    const cap = caption(renderList(2, LONG_SOURCE));
    expect(cap).toBeTruthy();
    const rendered = cap!.textContent ?? '';
    expect(rendered.endsWith('…')).toBe(true);
    expect(rendered).not.toContain(LONG_SOURCE);
  });

  it('passes a caption through unchanged when it actually fits', () => {
    // HillHistoryList's own caption (a date plus a name) is realistically always long
    // enough to hit some truncation at history's ink scale — this checks the
    // passthrough half of that same code path directly, at PhaseHillSvg's level.
    const { container } = render(
      <LocaleProvider locale="en">
        <PhaseHillSvg progress={2} color="var(--fg)" axisLabels={null} caption="hi" />
      </LocaleProvider>,
    );
    expect(caption(container)?.textContent).toBe('hi');
  });

  it('shrinks the caption further when the entry’s own dot climbs into the same corner', () => {
    // ~27% progress puts hillCoordinates' dot at roughly (60, 43) — inside the
    // caption's band (y < 45) and closer to it in x than the low-progress case above,
    // so the caption must yield room to the mark instead of drawing through it.
    const roomy = caption(renderList(2, LONG_SOURCE))!.textContent ?? '';
    const crowded = caption(renderList(27, LONG_SOURCE))?.textContent ?? '';
    // Either the caption is dropped outright (undefined/empty) or it survives shorter
    // than the low-progress rendering — never the same length or longer.
    expect(crowded.length).toBeLessThan(roomy.length);
  });

  it('colors the coin by status, not by a fixed per-phase identity color', () => {
    const container = renderList(30, 'dev');
    const coin = container.querySelector('circle[fill]');
    expect(coin?.getAttribute('fill')).toBe(hillStatusColor(30));
  });

  it('drops the meta row: no bare status word or date sits beside the chart any more', () => {
    const container = renderList(30, 'dev');
    expect(container.querySelector('time')).toBeNull();
  });
});
