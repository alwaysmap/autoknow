import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { coversDay, jobLabel } from './people';

// The person page's Programs rows: which programs a person is named on, HOW (TEL, phase
// role, action item), and — #127 E11, spec #124 §7 — through WHICH AFFILIATION. A role
// held two years ago used to render identically to one held now (#144); each row now
// carries the company and role held at the time of the involvement, resolved from the
// person's own career.
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

  type Draft = Omit<PersonProgramRow, 'heldThen' | 'heldThenSummary'>;
  const programs = new Map<number, Draft>();
  const rowFor = (project: { id: number; name: string }): Draft => {
    const row = programs.get(project.id)
      ?? { id: project.id, name: project.name, tel: false, roles: [], roleSummary: '', phases: [] };
    programs.set(project.id, row);
    return row;
  };
  for (const p of owned) rowFor(p).tel = true;
  for (const inv of phaseInvolvements) {
    const row = rowFor(inv.phase.project);
    if (!row.phases.some((ph) => ph.id === inv.phase.id)) {
      row.phases.push({ id: inv.phase.id, name: inv.phase.name, role: inv.role });
    }
    // `PhasePerson.role` is nullable and repeats across a program's phases; the Role
    // column wants the distinct set, not one per phase.
    if (inv.role && !row.roles.includes(inv.role)) row.roles.push(inv.role);
  }
  for (const a of actionItems) {
    const row = rowFor(a.phase.project);
    if (!row.phases.some((ph) => ph.id === a.phase.id)) {
      row.phases.push({ id: a.phase.id, name: a.phase.name, role: null });
    }
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
   * What this deliberately does NOT do (#144, autoknow-fxk): mark rows live vs ended,
   * or say "cannot be dated" for a phase with no record — an involvement the model
   * cannot date is treated as current, which is what "is named on it" claims today.
   */
  const anchorOf = (row: Draft): Date => {
    if (row.tel) return today;
    let latest: Date | null = null;
    for (const ph of row.phases) {
      const fin = finished.get(ph.id);
      if (!fin) return today;
      if (!latest || fin > latest) latest = fin;
    }
    return latest ?? today;
  };

  return [...programs.values()].map((row) => {
    const anchor = anchorOf(row);
    const heldPeriod = career.find((period) => coversDay(period, anchor));
    return {
      ...row,
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
