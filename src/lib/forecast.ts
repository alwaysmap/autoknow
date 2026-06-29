import { percentile } from './stats';

// Monte Carlo completion forecast, shared by the home and programs dashboards
// (previously duplicated verbatim in both). Deterministic given the seed so server
// renders are stable.

export interface Forecast {
  p50: number;
  p85: number;
  p95: number;
}

/** Seeded linear congruential generator → deterministic pseudo-random in [0, 1). */
function lcg(seed: number) {
  let val = seed;
  return function () {
    val = (val * 1664525 + 1013904223) % 4294967296;
    return val / 4294967296;
  };
}

/**
 * Simulate total remaining duration across `remainingPhasesCount` phases, each drawn
 * from a normal(12, 4) distribution (floored at 3 days), and return p50/p85/p95.
 */
export function runMonteCarlo(remainingPhasesCount: number, seed: number): Forecast {
  if (remainingPhasesCount === 0) {
    return { p50: 0, p85: 0, p95: 0 };
  }

  const rand = lcg(seed);
  const runs = 1000;
  const durations: number[] = [];

  for (let r = 0; r < runs; r++) {
    let projectDuration = 0;
    for (let p = 0; p < remainingPhasesCount; p++) {
      const u1 = rand() || 0.0001;
      const u2 = rand() || 0.0001;
      const normalRand = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const phaseDuration = Math.max(3, 12 + normalRand * 4);
      projectDuration += phaseDuration;
    }
    durations.push(projectDuration);
  }

  return {
    p50: Math.round(percentile(durations, 0.5)),
    p85: Math.round(percentile(durations, 0.85)),
    p95: Math.round(percentile(durations, 0.95)),
  };
}
