// #21: the SOP TARGET header carries the forecast finish date, coloured by health.
// The colour rule is pure (sop.ts) so every state — including "SOP already blown",
// which no seed program currently exercises — is verified deterministically here.
//
// The tone is now a MAPPING over sopBufferClass rather than its own branch set (that
// duplication is what let the ecosystem tile and this header disagree about the 50%
// line), so the last case below pins the mapping itself: a forecast miss and a thin
// buffer share --warn, and nothing else may collapse into a neighbour.
import { sopForecastTone, sopBufferClass, DAY_MS } from '../src/lib/sop';

const NOW = Date.UTC(2026, 6, 23); // 2026-07-23

describe('sopForecastTone (#21)', () => {
  it('overshoot + SOP already passed → blown (Concerned / --bad)', () => {
    expect(sopForecastTone({ bufferDays: -30, guidelineDays: 20, sopMs: NOW - 10 * DAY_MS, now: NOW })).toBe('blown');
  });

  it('overshoot + SOP still ahead → atRisk (Some Risk / --warn) — a forecast miss, not yet a missed date', () => {
    expect(sopForecastTone({ bufferDays: -30, guidelineDays: 20, sopMs: NOW + 40 * DAY_MS, now: NOW })).toBe('atRisk');
  });

  it('positive buffer but below the 50%-rule reserve → atRisk (near the line)', () => {
    expect(sopForecastTone({ bufferDays: 5, guidelineDays: 20, sopMs: NOW + 40 * DAY_MS, now: NOW })).toBe('atRisk');
  });

  it('comfortable positive buffer → onTrack (muted)', () => {
    expect(sopForecastTone({ bufferDays: 200, guidelineDays: 20, sopMs: NOW + 300 * DAY_MS, now: NOW })).toBe('onTrack');
  });

  it('a missed SOP outranks a forecast miss — same overshoot, passed SOP is worse', () => {
    const ahead = sopForecastTone({ bufferDays: -1, guidelineDays: 10, sopMs: NOW + DAY_MS, now: NOW });
    const passed = sopForecastTone({ bufferDays: -1, guidelineDays: 10, sopMs: NOW - DAY_MS, now: NOW });
    expect(ahead).toBe('atRisk');
    expect(passed).toBe('blown');
  });

  it('no buffer data (no chain) → onTrack, never a guess', () => {
    expect(sopForecastTone({ bufferDays: null, guidelineDays: null, sopMs: NOW, now: NOW })).toBe('onTrack');
  });

  it('is exactly the class, with late and atrisk folded onto one warn tone', () => {
    // The ONLY fold sanctioned by sop.SOP_TONE_BY_CLASS. Any other collapse is a bug.
    const cases = [
      { args: { bufferDays: -30, guidelineDays: 20, sopMs: NOW - 10 * DAY_MS, now: NOW }, cls: 'blown', tone: 'blown' },
      { args: { bufferDays: -30, guidelineDays: 20, sopMs: NOW + 40 * DAY_MS, now: NOW }, cls: 'late', tone: 'atRisk' },
      { args: { bufferDays: 5, guidelineDays: 20, sopMs: NOW + 40 * DAY_MS, now: NOW }, cls: 'atrisk', tone: 'atRisk' },
      { args: { bufferDays: 200, guidelineDays: 20, sopMs: NOW + 300 * DAY_MS, now: NOW }, cls: 'ontrack', tone: 'onTrack' },
    ] as const;
    for (const { args, cls, tone } of cases) {
      expect(sopBufferClass(args)).toBe(cls);
      expect(sopForecastTone(args)).toBe(tone);
    }
  });
});
