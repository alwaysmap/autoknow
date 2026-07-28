import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { coversDay, jobLabel } from './people';

// The person page's Programs rows: which programs a person is named on, HOW (TEL, phase
// role, action item), and — #127 E11, spec #124 §7 — through WHICH AFFILIATION. A role
// held two years ago used to render identically to one held now (#144); each row now
// carries the company and role held at the time of the involvement, resolved from the
// person's own career, plus (#144) whether that connection is still live, when it
// ended, and which of the three routes put the row there.
//
// A lib module rather than page code because the involvement DATING below is a rule, not
// a rendering choice, and rules get tests (tests/personPrograms.test.ts). It reaches for
// prisma (the finish-time aggregate), which rules out the client table component.

/** The affiliation a program connection goes THROUGH — the job held at the time of the
 *  involvement. Null when that day falls in a career gap or before the first period:
 *  null is a real answer (#124 §2), and the cell renders a dash rather than borrowing
 *  the nearest company. */
export interface HeldThen {
  partnerId: number;
  partnerName: string;
  role: string;
}

/** How a person is connected to a program — the three routes #144 asks each row to
 *  name. */
export type ProgramRoute = 'tel' | 'phase' | 'action';

export interface PersonProgramRow {
  id: number;
  name: string;
  /** True when this person is the program's TEL. */
  tel: boolean;
  /** Distinct `PhasePerson.role` values held in this program. Often empty — the field
   *  is nullable and most rows do not set it. */
  roles: string[];
  /** TEL + roles as one string: what the Role column SORTS on, since a column cannot
   *  sort on a badge plus an array. Built server-side so SSR and client agree. */
  roleSummary: string;
  phases: { id: number; name: string; role: string | null }[];
  heldThen: HeldThen | null;
  /** What the Affiliation column SORTS on — same reason as `roleSummary`. */
  heldThenSummary: string;
  /**
   * Is this connection still live (#144)? Before this, a program someone led in 2023 and
   * one they lead now rendered identically, which is the defect the bead opens with.
   *
   * ENDED means every route into this program is finished; LIVE means at least one is
   * not. A phase with no state history at all reads LIVE and that is deliberate rather
   * than a gap papered over: nothing recorded means nothing FINISHED, and "named on it"
   * is what the row claims. The intro copy says so, because a reader cannot tell that
   * from the badge.
   */
  status: 'live' | 'ended';
  /** ISO timestamp of when the LAST route finished — the reading "until"; `DateCell`
   *  renders the day. Null while live. */
  endedOn: string | null;
  /** WHY this row is here (#144 goal 3): the routes that put it there. Previously the
   *  intro said the list mixes three provenances and no row said which it was. */
  via: ProgramRoute[];
}

interface InvolvedPhase {
  id: number;
  name: string;
  project: { id: number; name: string };
}

/** One employment period as the page already loads it — newest start first, the same
 *  ordering contract `labelWithJobHeldThen` (lib/activity) states: a career with an
 *  overlap (autoknow-2of) resolves to the same row `profileAsOf` would only because
 *  the FIRST match of a newest-first list is taken. */
interface CareerPeriod {
  role: string;
  startDate: Date;
  endDate: Date | null;
  partnerId: number;
  partner: { name: string };
}

/** First-reached-100 day for each phase whose CURRENT progress is 100, aggregated in
 *  SQL like dashboardData's cycle-time spans — never by materializing state histories.
 *  Current progress gates, not ever-reached-100: dragging the dot back RETRACTS a
 *  finish, exactly as `effectiveStartedAt` (lib/phase) retracts a premature start. */
async function phaseFinishTimes(phaseIds: number[]): Promise<Map<number, Date>> {
  if (phaseIds.length === 0) return new Map();
  const spans = await prisma.$queryRaw<
    { id: number; finishedAt: Date | null; latestProgress: number | null }[]
  >`
    SELECT s."phaseId" AS id,
           MIN(s."timestamp") FILTER (WHERE s."hillChartProgress" >= 100) AS "finishedAt",
           (ARRAY_AGG(s."hillChartProgress" ORDER BY s."timestamp" DESC))[1] AS "latestProgress"
    FROM "PhaseState" s
    WHERE s."phaseId" IN (${Prisma.join(phaseIds)})
    GROUP BY s."phaseId"`;
  const finished = new Map<number, Date>();
  for (const s of spans) {
    // `latestProgress` at 100 implies the filter matched at least that row, so
    // `finishedAt` is non-null here; the guard keeps the claim local rather than proven
    // at a distance.
    if (s.latestProgress != null && s.latestProgress >= 100 && s.finishedAt) {
      finished.set(s.id, s.finishedAt);
    }
  }
  return finished;
}

/**
 * Assemble the Programs rows from what the person page already fetched. The three
 * connection routes are unchanged (#144 documents them); E11 adds `heldThen`: the
 * career period covering the row's anchor day, compared with `coversDay` against the
 * career ALREADY IN HAND — the many-instants division `lib/profiles`' header draws,
 * the same as `labelWithJobHeldThen` and for the same reason: rows must not become
 * round trips.
 */
export async function personProgramRows(input: {
  owned: { id: number; name: string }[];
  phaseInvolvements: { role: string | null; phase: InvolvedPhase }[];
  actionItems: { phase: InvolvedPhase }[];
  /** Newest start first — see `CareerPeriod`. */
  career: CareerPeriod[];
}): Promise<PersonProgramRow[]> {
  const { owned, phaseInvolvements, actionItems, career } = input;

  type Draft = Omit<PersonProgramRow, 'heldThen' | 'heldThenSummary' | 'status' | 'endedOn' | 'via'>
    & { via: Set<ProgramRoute> };
  const programs = new Map<number, Draft>();
  const rowFor = (project: { id: number; name: string }): Draft => {
    const row = programs.get(project.id)
      ?? { id: project.id, name: project.name, tel: false, roles: [], roleSummary: '',
           phases: [], via: new Set<ProgramRoute>() };
    programs.set(project.id, row);
    return row;
  };
  for (const p of owned) {
    const row = rowFor(p);
    row.tel = true;
    row.via.add('tel');
  }
  for (const inv of phaseInvolvements) {
    const row = rowFor(inv.phase.project);
    if (!row.phases.some((ph) => ph.id === inv.phase.id)) {
      row.phases.push({ id: inv.phase.id, name: inv.phase.name, role: inv.role });
    }
    // `PhasePerson.role` is nullable and repeats across a program's phases; the Role
    // column wants the distinct set, not one per phase.
    if (inv.role && !row.roles.includes(inv.role)) row.roles.push(inv.role);
    row.via.add('phase');
  }
  for (const a of actionItems) {
    const row = rowFor(a.phase.project);
    if (!row.phases.some((ph) => ph.id === a.phase.id)) {
      row.phases.push({ id: a.phase.id, name: a.phase.name, role: null });
    }
    row.via.add('action');
  }

  const finished = await phaseFinishTimes(
    [...new Set([...programs.values()].flatMap((r) => r.phases.map((ph) => ph.id)))],
  );
  const today = new Date();
  /**
   * The day a row's involvement is ANCHORED on — ADR
   * a-dated-row-is-labelled-as-of-its-own-date: a surface passes the date of the thing
   * it is rendering, and a programme involvement's date is its phase's window, not the
   * day the page loads. Per route:
   *
   *  - TEL ownership is a live FK with no history, so it is a fact about TODAY.
   *  - A phase involvement (or an action item riding a phase) is anchored on the phase:
   *    FINISHED anchors on the day it first reached 100 (`phaseFinishTimes` above);
   *    anything else — in flight, not started, never updated — is live, so today.
   *  - A row aggregates routes; it takes the LATEST of their days — the same tie-break
   *    `chainDay` argues for: the fact worth surfacing is the recent one. Any live
   *    route therefore makes the whole connection current.
   *
   * It returns the STATUS with the day, in one walk: "when" and "is it over" are the
   * same question asked twice, and answering them separately is how they come to
   * disagree (#144). An involvement the model cannot date — a phase with no state
   * history at all — reads live, because nothing recorded means nothing finished; the
   * intro copy discloses that, since the badge cannot.
   */
  const anchorOf = (row: Draft): { at: Date; endedOn: Date | null } => {
    if (row.tel) return { at: today, endedOn: null };
    let latest: Date | null = null;
    for (const ph of row.phases) {
      const fin = finished.get(ph.id);
      if (!fin) return { at: today, endedOn: null }; // one live route makes the row live
      if (!latest || fin > latest) latest = fin;
    }
    return latest ? { at: latest, endedOn: latest } : { at: today, endedOn: null };
  };

  return [...programs.values()].map((row) => {
    const { at: anchor, endedOn } = anchorOf(row);
    const heldPeriod = career.find((period) => coversDay(period, anchor));
    return {
      ...row,
      via: [...row.via],
      status: endedOn ? ('ended' as const) : ('live' as const),
      endedOn: endedOn ? endedOn.toISOString() : null,
      // The Role column's sort key. 'TEL' unlocalized on purpose: this is a sort value,
      // never rendered — the cell renders the badge and `telRole` carries the expansion.
      roleSummary: [row.tel ? 'TEL' : '', ...row.roles].filter(Boolean).join(', '),
      heldThen: heldPeriod
        ? { partnerId: heldPeriod.partnerId, partnerName: heldPeriod.partner.name, role: heldPeriod.role }
        : null,
      heldThenSummary: heldPeriod ? jobLabel(heldPeriod) : '',
    };
  });
}
