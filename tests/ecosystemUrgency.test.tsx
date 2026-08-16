/** @jest-environment jsdom */
// The two 2026-08-03 user reports about /ecosystem, pinned at the level where each one
// actually went wrong — which is a PREDICATE in both cases, not a style:
//
//   • autoknow-t4t — "Possible Resource Constraints" spent most of its rows saying
//     "nothing to do here". The fix is a rule about which rows earn the space, and the
//     trap is that the obvious rule (keep only rows with a "Consider:" line) silently
//     deletes the most important row on the page: a resource gating an SOP that is
//     actively slipping with nobody free to rebalance it. That row has no recommendation
//     precisely BECAUSE there is nothing to move.
//
//   • autoknow-2o9 — escalations needed to read as urgent. The rule is that a mark goes
//     on rows that earned it, never on all of them, so the negative cases matter as much
//     as the positive ones.
//
// Neither file's LOOK is testable here (jsdom has no layout or paint) and neither is
// claimed to be: the tint, the hanging mark and both themes were signed off from live
// screenshots. What is pinned here is the decision each one encodes.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '../src/components/LocaleProvider';
import BusiestResources from '../src/components/BusiestResources';
import EscalationRows, { type EscalationRow } from '../src/components/EscalationRows';
import type { BusiestRow, BusiestProgramRef } from '../src/lib/chainLedger';

// Ids come from a counter, never from the fixture's own text: the component keys and
// looks rows up by identity, so two equal-length names deriving the same id would surface
// as a React key collision and a mislookup that reads like a component bug.
let nextId = 0;
const id = () => (nextId += 1);

const prog = (name: string, deltaDays: number | null, buffer: number | null = 40): BusiestProgramRef => ({
  programId: id(),
  programName: name,
  bufferDays: buffer,
  fourWeekDeltaDays: deltaDays,
  volumeFirstYear: 100_000,
  products: ['GAS'],
  sopDate: '2027-06-01',
});

const person = (name: string, over: Partial<BusiestRow> = {}): BusiestRow => ({
  kind: 'person',
  id: id(),
  name,
  constraintIn: [],
  alsoActiveIn: [],
  movable: [],
  gatesSingleSop: false,
  // #140: no demand windows in this fixture, so there is no overlap to report — these
  // tests are about which rows EARN THE SPACE, not about the collision computation
  // (tests/chainLedger.test.ts owns that).
  demands: [],
  peak: null,
  concurrent: 0,
  overCommitted: false,
  ...over,
});

const renderBusiest = (rows: BusiestRow[]) =>
  render(
    <LocaleProvider locale="en">
      <BusiestResources locale="en" rows={rows} />
    </LocaleProvider>,
  );

describe('BusiestResources — which rows earn the space (autoknow-t4t)', () => {
  it('keeps a row with a recommendation', () => {
    // Movable time is what produces a "Consider:" line for a person. `getAllBy` because a
    // kept row names its subject TWICE by design — once as the row and once inside the
    // recommendation — which is itself the shape being asserted.
    renderBusiest([person('Priya', { constraintIn: [prog('Gemini X', -11)], movable: [prog('Nova', 0, 73)] })]);
    expect(screen.getAllByText(/Priya/).length).toBeGreaterThan(1);
    expect(screen.queryByTestId('busiest-quiet-toggle')).not.toBeInTheDocument();
  });

  it('keeps a row that is LOSING BUFFER even though it has no recommendation', () => {
    // The regression this test exists for: gating a slipping SOP with no movable time is
    // a constraint nobody can rebalance. Filtering on the "Consider:" line alone deletes
    // exactly this row, and it is the one a reader most needs.
    renderBusiest([person('Marcus', { constraintIn: [prog('Gemini X', -11)] })]);
    expect(screen.getByText(/Marcus/)).toBeInTheDocument();
    expect(screen.queryByTestId('busiest-quiet-toggle')).not.toBeInTheDocument();
  });

  it('collapses a row that gates an SOP which is NOT slipping', () => {
    renderBusiest([
      person('Marcus', { constraintIn: [prog('Gemini X', -11)] }),
      person('Aiko', { constraintIn: [prog('Honda Accord', 0)] }),
    ]);
    expect(screen.getByText(/Marcus/)).toBeInTheDocument();
    expect(screen.queryByText(/Aiko/)).not.toBeInTheDocument();
    expect(screen.getByTestId('busiest-quiet-toggle')).toHaveTextContent('Show 1 more');
  });

  it('collapses rather than deletes — the toggle reveals the quiet rows in place', () => {
    renderBusiest([
      person('Marcus', { constraintIn: [prog('Gemini X', -11)] }),
      person('Aiko', { constraintIn: [prog('Honda Accord', 0)] }),
    ]);
    fireEvent.click(screen.getByTestId('busiest-quiet-toggle'));
    expect(screen.getByText(/Aiko/)).toBeInTheDocument();
    expect(screen.getByTestId('busiest-quiet-toggle')).toHaveTextContent('Hide 1');
  });

  it('renders NOTHING when no row has anything to act on', () => {
    // A heading over "twelve people are busy and none of it matters" is the cost this
    // change exists to remove, so the section withdraws entirely rather than shrinking.
    const { container } = renderBusiest([
      person('Aiko', { constraintIn: [prog('Honda Accord', 0)] }),
      person('Carlos', { constraintIn: [prog('GM Ultifi', 0)] }),
    ]);
    expect(container.querySelector('[data-testid="busiest-resources"]')).toBeNull();
  });
});

// #140. The section was directionally right and hard to act on: it named the people and
// partners several programs lean on, then asserted "one calendar driving many SOPs" over
// a row shape carrying no time data at all, ranked rows by a `days × units` scalar it
// never displayed, and stated concurrency only as a count of links the reader made by
// eye. The COMPUTATION lives in tests/chainLedger.test.ts; what is pinned here is that
// each of those facts actually reaches the reader.
describe('BusiestResources — the facts a resourcing decision needs (#140)', () => {
  const window = (n: number) => ({
    demands: [], // not read by the component; the peak is what it renders
    peak: { startMs: Date.UTC(2027, 1, 1), endMs: Date.UTC(2027, 3, 1), programCount: n },
    concurrent: n,
    overCommitted: true,
  });

  it('states concurrency as a NUMBER, with the window the demands actually collide in', () => {
    renderBusiest([person('Priya', {
      constraintIn: [prog('Gemini X', -11)], ...window(3),
    })]);
    expect(screen.getByText('3')).toBeInTheDocument();
    // The one fact that makes the section actionable, and the one it used to assert
    // without computing: WHEN.
    expect(screen.getAllByText(/Feb 1, 2027/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Apr 1, 2027/).length).toBeGreaterThan(0);
  });

  it('says so out loud when the windows never meet', () => {
    // Two programs, no collision. Under the old row shape this was indistinguishable
    // from two programs wanting the same person next month.
    renderBusiest([person('Priya', {
      constraintIn: [prog('Gemini X', -11)], alsoActiveIn: [prog('Nova', 0)],
      peak: null, concurrent: 1, overCommitted: false,
    })]);
    expect(screen.getByText(/their windows never meet/)).toBeInTheDocument();
  });

  it('makes the person/partner distinction STRUCTURAL, not just wording', () => {
    renderBusiest([
      person('Priya', { constraintIn: [prog('Gemini X', -11)], ...window(2) }),
      { ...person('Bosch'), kind: 'partner' as const, constraintIn: [prog('Meridian', -4)], ...window(2), overCommitted: false },
    ]);
    // A person has ONE calendar, so two at once is already the finding; a company has
    // many people, so the same two is a question about their staffing plan. Same number,
    // different claim — and it is the row's own computed verdict that decides which.
    // The CELL's verdict, not the ⓘ's explanation of the rule — both mention one
    // calendar, and matching the loose phrase would pass on the explanation alone.
    expect(screen.getByText(/at once — one calendar/)).toBeInTheDocument();
    expect(screen.getAllByText(/Person/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Company/).length).toBeGreaterThan(0);
  });

  it('says "no recommendation" out loud rather than leaving the row silent', () => {
    // A row gating a slipping SOP with nothing movable is the constraint nobody can
    // rebalance — the most important row in the section, and the one that used to say
    // nothing at all (AGENTS lesson 5: degrade honestly).
    renderBusiest([person('Marcus', { constraintIn: [prog('Gemini X', -11)] })]);
    expect(screen.getByText(/Flagged as an ecosystem risk/)).toBeInTheDocument();
  });

  it('asks rather than concludes when it does have advice', () => {
    // The advice is a heuristic over compounded estimates. It used to be phrased as a
    // finding — "shifting it protects the falling SOPs at the least cost".
    renderBusiest([person('Priya', { constraintIn: [prog('Gemini X', -11)], movable: [prog('Nova', 0, 73)] })]);
    expect(screen.getByText(/Worth asking/)).toBeInTheDocument();
    expect(screen.queryByText(/at the least cost/)).not.toBeInTheDocument();
  });
});

const esc = (over: Partial<EscalationRow> = {}): EscalationRow => ({
  id: 1,
  title: 'Certification slip was communicated late',
  status: 'open',
  severity: null,
  orgLevel: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  targetDate: null,
  owner: null,
  ...over,
});

const renderEscalations = (rows: EscalationRow[]) =>
  render(
    <LocaleProvider locale="en">
      <EscalationRows escalations={rows} locale="en" />
    </LocaleProvider>,
  );

describe('EscalationRows — the urgency mark goes where it is earned (autoknow-2o9)', () => {
  const mark = () => screen.queryByRole('img', { name: 'Needs attention now' });

  it('marks an open S1', () => {
    renderEscalations([esc({ severity: 's1' })]);
    expect(mark()).toBeInTheDocument();
  });

  it('marks an open escalation past its target, whatever its severity', () => {
    renderEscalations([esc({ severity: 's3', targetDate: '2020-01-01' })]);
    expect(mark()).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('does NOT mark an ordinary open escalation', () => {
    renderEscalations([esc({ severity: 's2', targetDate: '2099-01-01' })]);
    expect(mark()).not.toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('does NOT mark a CLOSED escalation, however severe or however late it ran', () => {
    // "Is anybody still waiting" has already been answered — the same reasoning
    // `isOverdue` applies to a terminal status.
    renderEscalations([esc({ status: 'resolved', severity: 's1', targetDate: '2020-01-01' })]);
    expect(mark()).not.toBeInTheDocument();
  });
});
