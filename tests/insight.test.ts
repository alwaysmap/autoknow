import { compareInsights, type Insight } from '../src/lib/insight';
import { t } from '../src/lib/i18n';

// The Insight envelope (lib/insight, ADR an-insight-separates-symptom-from-action).
// This file pins the four things the shape ASSERTS, because each of them is a claim
// that a producer could quietly break while still compiling:
//   - `action: null` is a first-class answer, not a gap to fill;
//   - `since` may be null and must never be fabricated;
//   - `basis` keeps measured / estimated / asserted apart;
//   - `symptom` carries an i18n KEY, never prose.
//
// The `@ts-expect-error` cases are assertions too: `npm run typecheck` covers
// tests/** (tsconfig includes `**/*.ts`), so a line that STOPS erroring fails the
// build. They are the only way to test a required-and-nullable field, which is the
// shape's main defence against a producer that simply forgets.

const asInsight = (i: Insight): Insight => i;

/** A live critical-chain constraint, as /ecosystem-summary computes it today. */
const gatingConstraint: Insight = {
  id: 'chain:live-constraint:homologation',
  source: 'critical-chain',
  // dashboardData's LiveConstraint rolls up by phase NAME across programs, so there
  // is no single phase id to point at — the honest scope is the portfolio. The
  // per-program version of the same finding is what takes `{ kind: 'phase' }`.
  scope: { kind: 'ecosystem' },
  symptom: { key: 'gatingNPrograms', values: { n: 3 }, measure: 3, basis: 'measured' },
  // #148's complaint, expressed rather than papered over: this panel names WHERE,
  // and has nothing honest to say about what to do.
  action: null,
  // #148's other complaint: nothing on the surface knows when this started.
  since: null,
  severity: 'act',
  href: '/ecosystem-summary',
};

/** A phase past its own estimate — chainLedger's `forecastOverrun` Situation. */
const forecastOverrun: Insight = {
  id: 'chain:overrun:phase-91',
  source: 'critical-chain',
  scope: { kind: 'phase', id: 91, name: 'Homologation', programId: 12 },
  // `overPct` is a share of a typed-in forecastedDuration, so the number is over a
  // guess. `estimated` is what stops a surface rendering it like a measurement.
  symptom: { key: 'constraintWhyOverPlan', values: { e: '6w', p: '4w' }, measure: 50, basis: 'estimated' },
  action: null,
  since: '2026-06-01T00:00:00.000Z',
  severity: 'act',
  href: '/programs/12',
};

/** A contended calendar — /ecosystem's Possible Resource Constraints, with advice. */
const busiestPerson: Insight = {
  id: 'load:person-7',
  source: 'resource-load',
  scope: { kind: 'person', id: 7, name: 'Sam Okoye' },
  // Programs gated, NOT BusiestRow.exposure: that is days × units, two units
  // multiplied, and the envelope deliberately gives it nowhere to live.
  symptom: { key: 'gatingNPrograms', values: { n: 2 }, measure: 2, basis: 'measured' },
  action: { key: 'clConsiderPerson', values: { name: 'Sam Okoye', programs: 'Aurora, Basalt' } },
  since: null,
  severity: 'watch',
  href: '/people/7',
};

describe('Insight envelope — the contract', () => {
  test('`action: null` is a first-class answer, and stays in the list', () => {
    const list = [gatingConstraint, busiestPerson, forecastOverrun];
    expect(list.filter((i) => i.action === null)).toHaveLength(2);
    // An advice-free insight is complete, so nothing may filter it out as "empty".
    expect([...list].sort(compareInsights).map((i) => i.id)).toContain(gatingConstraint.id);
  });

  test('`action` must be STATED — omitting it is not the same as having none', () => {
    // @ts-expect-error — `action` is required; `null` is how you say "no advice".
    asInsight({
      id: 'x', source: 'ingestion', scope: { kind: 'ecosystem' },
      symptom: { key: 'noLiveConstraints', measure: null, basis: 'measured' },
      since: null, severity: 'clear', href: '/x',
    });
  });

  test('`since` may be null, and null survives untouched — nothing here invents one', () => {
    expect(gatingConstraint.since).toBeNull();
    const sorted = [...[gatingConstraint, busiestPerson]].sort(compareInsights);
    expect(sorted.map((i) => i.since)).toEqual([null, null]);
  });

  test('`since` must be STATED — "unknown" and "forgot" cannot share a spelling', () => {
    // @ts-expect-error — `since` is required-and-nullable; optional would hide a forget.
    asInsight({
      id: 'x', source: 'ingestion', scope: { kind: 'ecosystem' },
      symptom: { key: 'noLiveConstraints', measure: null, basis: 'measured' },
      action: null, severity: 'clear', href: '/x',
    });
  });

  test('`basis` distinguishes measured / estimated / asserted for the same number', () => {
    const measured = { ...forecastOverrun, symptom: { ...forecastOverrun.symptom, basis: 'measured' as const } };
    // Same measure, different trust — and the shape keeps them distinguishable.
    expect(measured.symptom.measure).toBe(forecastOverrun.symptom.measure);
    expect(measured.symptom.basis).not.toBe(forecastOverrun.symptom.basis);
    expect(new Set([gatingConstraint, forecastOverrun].map((i) => i.symptom.basis))).toEqual(
      new Set(['measured', 'estimated']),
    );
  });

  test('`basis` is not a rank — it never changes list order', () => {
    const asserted = { ...forecastOverrun, symptom: { ...forecastOverrun.symptom, basis: 'asserted' as const } };
    expect(compareInsights(forecastOverrun, asserted)).toBe(0);
  });

  test('a number cannot travel without its basis', () => {
    asInsight({
      id: 'x', source: 'critical-chain', scope: { kind: 'ecosystem' },
      // @ts-expect-error — `basis` sits inside `symptom`, beside the measure it qualifies.
      symptom: { key: 'gatingOneProgram', measure: 1 },
      action: null, since: null, severity: 'watch', href: '/x',
    });
  });

  test('`symptom` carries an i18n KEY, not prose — it localizes from the insight alone', () => {
    const en = t('en', gatingConstraint.symptom.key, gatingConstraint.symptom.values);
    const de = t('de', gatingConstraint.symptom.key, gatingConstraint.symptom.values);
    expect(en).toBe('gating 3 programs');
    expect(de).toBe('blockiert 3 Programme');
    expect(en).not.toBe(de); // no English baked into the insight
  });

  test('`action` localizes the same way, from the same catalog', () => {
    const action = busiestPerson.action;
    expect(action).not.toBeNull();
    expect(t('en', action!.key, action!.values)).toContain("Sam Okoye's movable time is in Aurora, Basalt");
    expect(t('ja', action!.key, action!.values)).toContain('Sam Okoye');
  });

  test('a free-text symptom does not compile', () => {
    asInsight({
      id: 'x', source: 'ingestion', scope: { kind: 'ecosystem' },
      // @ts-expect-error — only keys in lib/i18n's catalog are spellable.
      symptom: { key: 'Three programs are stuck on homologation', measure: null, basis: 'asserted' },
      action: null, since: null, severity: 'watch', href: '/x',
    });
  });
});

describe('compareInsights', () => {
  const at = (severity: Insight['severity'], source: Insight['source'], measure: number | null, id: string): Insight => ({
    id, source, scope: { kind: 'ecosystem' },
    symptom: { key: 'gatingOneProgram', measure, basis: 'measured' },
    action: null, since: null, severity, href: '/x',
  });

  test('severity leads, in act → watch → clear order', () => {
    const list = [at('clear', 'ingestion', 1, 'c'), at('watch', 'ingestion', 1, 'w'), at('act', 'ingestion', 1, 'a')];
    expect([...list].sort(compareInsights).map((i) => i.id)).toEqual(['a', 'w', 'c']);
  });

  test('within one source, the bigger measure comes first', () => {
    const list = [at('act', 'critical-chain', 2, 'small'), at('act', 'critical-chain', 40, 'big')];
    expect([...list].sort(compareInsights).map((i) => i.id)).toEqual(['big', 'small']);
  });

  test('ACROSS sources the measures are never compared — that would rebuild `exposure`', () => {
    // 40 percent-over vs 2 programs-gated are different units, so the ONLY thing
    // separating these two is their source. Never the measures: a smaller number
    // from an earlier-grouped source still comes first.
    const list = [at('act', 'resource-load', 40, 'load'), at('act', 'critical-chain', 2, 'chain')];
    expect([...list].sort(compareInsights).map((i) => i.id)).toEqual(['chain', 'load']);
  });

  test('the order is TOTAL: every permutation of a mixed list sorts the same', () => {
    // Regression. Returning 0 across sources made this comparator intransitive —
    // cc≡rl and rl≡cc while cc(10) < cc(5) — so `Array.sort` emitted cc(5) before
    // cc(10) for exactly one of these four input orders. Measure ascending, which
    // is the one thing compareInsights promises cannot happen.
    const cc5 = at('act', 'critical-chain', 5, 'cc-5');
    const cc10 = at('act', 'critical-chain', 10, 'cc-10');
    const rl99 = at('act', 'resource-load', 99, 'rl-99');
    const expected = ['cc-10', 'cc-5', 'rl-99'];
    for (const perm of [[cc5, rl99, cc10], [cc5, cc10, rl99], [cc10, rl99, cc5], [rl99, cc5, cc10]]) {
      expect([...perm].sort(compareInsights).map((i) => i.id)).toEqual(expected);
    }
  });

  test('a measureless insight sorts to the end of its group, and does NOT tie', () => {
    // A tie here is the same intransitivity as the cross-source case, one level
    // down: null≡5, null≡10, yet 10<5. Permutations again, because [5, null, 10]
    // was the single input order that exposed it.
    const m5 = at('act', 'ingestion', 5, 'm5');
    const m10 = at('act', 'ingestion', 10, 'm10');
    const none = at('act', 'ingestion', null, 'none');
    const expected = ['m10', 'm5', 'none'];
    for (const perm of [[m5, none, m10], [none, m5, m10], [m10, none, m5], [m5, m10, none]]) {
      expect([...perm].sort(compareInsights).map((i) => i.id)).toEqual(expected);
    }
  });

  test('two measureless insights hold their input order', () => {
    const a = at('act', 'ingestion', null, 'a');
    const b = at('act', 'ingestion', null, 'b');
    expect(compareInsights(a, b)).toBe(0);
  });
});

describe('InsightScope', () => {
  // No narrowing HELPER: `InsightScope` is a discriminated union, so `.kind === x`
  // narrows natively — a `scopeIs` wrapper was written and then deleted, because a
  // named export that only restates the language earns nothing (AGENTS lesson 12).
  test('a kind check narrows to the members that carry an id', () => {
    const scope = forecastOverrun.scope;
    expect(scope.kind).toBe('phase');
    if (scope.kind === 'phase') expect(scope.programId).toBe(12); // narrowed: programId is reachable
  });

  test('the ecosystem scope carries nothing beyond its kind', () => {
    expect(gatingConstraint.scope.kind).toBe('ecosystem');
    expect(Object.keys(gatingConstraint.scope)).toEqual(['kind']);
  });
});
