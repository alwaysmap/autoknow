/** @jest-environment jsdom */
// The cycle-time chart's readout (autoknow-7ii). The chart dropped its per-phase-name row
// labels, so the ONLY way to learn which phase a point is, is by pointing at it — which
// makes this interaction load-bearing rather than a nicety, and makes its failure silent:
// a readout stuck on a stale point still reads like a working chart.

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import CycleTimeScatterPlot, {
  type CycleTimeData, type CycleTimeStats,
} from '../src/components/CycleTimeScatterPlot';

const data: CycleTimeData[] = [
  {
    phaseId: 1, phaseName: 'Board bring-up', projectId: 7, programName: 'Ford Evos',
    finishedAt: '2026-03-02T00:00:00.000Z', cycleTimeDays: 30,
  },
  {
    phaseId: 2, phaseName: 'Certification', projectId: 9, programName: 'Volvo EX90',
    finishedAt: '2026-05-14T00:00:00.000Z', cycleTimeDays: 90,
  },
];

const stats: CycleTimeStats = { p50: 40, p85: 80, p95: 95, sampleSize: 12 };

const point = (name: string) => screen.getByLabelText(new RegExp(`^${name}:`));
const readout = () => screen.getByTestId('cycle-readout');

describe('the cycle-time readout', () => {
  it('names the phase, its program, its duration and when it landed', () => {
    render(<CycleTimeScatterPlot data={data} stats={stats} />);
    fireEvent.mouseEnter(point('Certification'));

    const r = readout();
    expect(r).toHaveTextContent('Certification');
    expect(r).toHaveTextContent('Volvo EX90');
    expect(r).toHaveTextContent('90d');
    // The link is the way OUT to the phase — the point itself deliberately activates
    // nothing, so if this is not a link the keyboard path is a dead end.
    expect(within(r).getByRole('link')).toHaveAttribute('href', '/programs/9#phase-2');
  });

  it('RELEASES on mouse-leave rather than stranding the last point pointed at', () => {
    // The failure this exists to catch: a readout that keeps describing whatever the
    // pointer last brushed, forever, is indistinguishable from one describing a deliberate
    // selection — and the reader has no way to tell which they are looking at.
    render(<CycleTimeScatterPlot data={data} stats={stats} />);
    fireEvent.mouseEnter(point('Certification'));
    expect(readout()).toHaveTextContent('Certification');

    fireEvent.mouseLeave(point('Certification'));
    expect(readout()).not.toHaveTextContent('Certification');
    expect(readout()).toHaveTextContent(/Point at a dot/);
  });

  it('follows focus and releases on blur, so the keyboard path is the pointer path', () => {
    render(<CycleTimeScatterPlot data={data} stats={stats} />);
    fireEvent.focus(point('Board bring-up'));
    expect(readout()).toHaveTextContent('Board bring-up');

    fireEvent.blur(point('Board bring-up'));
    expect(readout()).toHaveTextContent(/Point at a dot/);
  });

  it('rings the point it is describing, and only that one', () => {
    const { container } = render(<CycleTimeScatterPlot data={data} stats={stats} />);
    fireEvent.mouseEnter(point('Certification'));

    const ringed = container.querySelectorAll('circle[class*="pointActive"]');
    expect(ringed).toHaveLength(1);
    expect(ringed[0]).toHaveAttribute('aria-label', expect.stringContaining('Certification'));
  });

  it('carries no aria-live — each point already announces itself by name', () => {
    // Announcing the panel too would say the phase twice per focus move, and would fire for
    // every point a mouse crossed on the way somewhere.
    render(<CycleTimeScatterPlot data={data} stats={stats} />);
    expect(readout()).not.toHaveAttribute('aria-live');
  });
});
