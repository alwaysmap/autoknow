import { prisma } from './db';
import { requireOwner } from './owner';
import { personDirectorySelect, resolvePersonCandidates, type PersonLike } from './people';

// Repoint the programs whose `ownerName` names NOBODY — `npm run db:remediate:unmatched-owners`,
// and through the dispatch runner as the `unmatched-owners` arm.
//
// STATUS: written for a prod fix that has NOT been dispatched yet. Once it has, this file
// stays as the record and every later run is a no-op — the rows it targets no longer
// exist, and it reports exactly that.
//
// WHY THIS EXISTS, and why it is not the E6 backfill's job. `db:backfill:owner-person`
// turns `ownerName` into `ownerPersonId` and REFUSES to guess when the text matches no
// person — correctly, because a wrong owner is worse than no owner. Its prod run
// (workflow run 30230033333, before this arm existed) reported
// `linked: 9 / unmatched: 2 / ambiguous: 0`, and both leftovers are display names shipped
// in the initial commit (`4ded811:src/lib/seed.ts` — 'Alice PM', 'Clara Operations') that
// named no Person in that database. Re-running the backfill cannot clear them: the
// strings still match nobody, and they never will. The matcher is fine; the DATA is
// stale. Those rows were the gate for #127 E7 (retiring the `ownerName` readers): with
// the readers on the FK, a program left unlinked here shows no owner at all. This arm
// cleared them, and E7 shipped behind a prod run reporting `scanned: 0`.
//
// THE OWNER-SELECTION RULE, which is the only judgement in this file:
//
//   The BUSIEST EXISTING OWNER — the Person referenced by `Project.ownerPersonId` on the
//   most programs. Ties, and the case where no program has an owner at all, break to the
//   LOWEST `Person.id`.
//
// THE BOUND: it refuses, writing nothing, above MAX_REPOINTED rows.
//
// Both are required of any arm in this namespace rather than being local taste, and WHY
// a rule beats a hardcoded id here is argued once, in ADR
// docs/adr/2026-07-27-a-remediation-arm-is-bounded-and-picks-by-rule.md — which extends
// the dispatch-runner ADR this rides on. The short version: nothing on this path can
// query prod, so an id in the diff is a claim neither the reviewer nor the run can check.
//
// Everything it writes goes through `requireOwner`, so `ownerName` and `ownerPersonId`
// are set as the PAIR that #127 E6 made structural — there is no path here that produces
// half of it.

/** The most rows a single run may repoint before it refuses. See the header: prod's E6
 *  run named exactly two, and a third row is by definition something nobody reviewed. */
export const MAX_REPOINTED = 2;

export interface UnresolvableOwnerRow {
  id: number;
  name: string;
  /** The free text that names nobody — printed verbatim, since it is what a human will
   *  recognise the row by. */
  ownerName: string;
}

/** Who the rule chose, with the count it was chosen ON — so the report shows its work
 *  and a reader can re-run the ranking by eye. */
export interface ChosenOwner {
  id: number;
  name: string;
  email: string;
  programsAlreadyOwned: number;
}

/** A row this run WROTE, carrying both owner columns on each side of the write — the
 *  before/after an operator checks the run by, and the shape the tests build. */
export interface RepointedRow {
  id: number;
  name: string;
  before: { ownerName: string; ownerPersonId: null };
  after: { ownerName: string; ownerPersonId: number };
}

export interface OwnerRemediationReport {
  /** Programs carrying an `ownerName` but no `ownerPersonId` — the E6 backfill's scan. */
  scanned: number;
  /** The subset this arm targets: `ownerName` resolves to no person at all. */
  unresolvable: UnresolvableOwnerRow[];
  /** Rows the E6 backfill can still handle (one match, or an ambiguity to resolve at
   *  source). Never touched here; they are counted so the two arms' numbers reconcile. */
  resolvable: number;
  /** Null when nothing needed doing, or when the run refused. */
  owner: ChosenOwner | null;
  /** One entry per row actually written, with both columns before and after. */
  repointed: RepointedRow[];
  /** Targets a concurrent write claimed between the scan and the UPDATE. Expected zero. */
  skipped: number;
  /** Set when the run REFUSED and wrote nothing. The runner exits non-zero on it. */
  refused: string | null;
}

/** Split the scan into this arm's targets and the E6 backfill's, using the SAME matcher
 *  the backfill and the write paths use (AGENTS lesson 7). Zero candidates is a target;
 *  one is the backfill's job and two-or-more is a human's, and neither is touched here. */
function partitionUnresolvable(
  people: PersonLike[],
  projects: { id: number; name: string; ownerName: string | null }[],
): { unresolvable: UnresolvableOwnerRow[]; resolvable: number } {
  const unresolvable: UnresolvableOwnerRow[] = [];
  let resolvable = 0;
  for (const project of projects) {
    if (resolvePersonCandidates(people, project.ownerName).length === 0) {
      unresolvable.push({ id: project.id, name: project.name, ownerName: project.ownerName ?? '' });
    } else {
      resolvable += 1;
    }
  }
  return { unresolvable, resolvable };
}

/** Rank every person by (programs already owned DESC, id ASC) and take the first — the
 *  rule in the header, as one function so the report and the write agree on the answer.
 *  Takes the directory the caller already fetched rather than re-reading `Person` under a
 *  second, hand-written select; that drift is what `personDirectorySelect` exists to stop. */
async function chooseOwner(
  people: { id: number; name: string; email: string }[],
): Promise<ChosenOwner | null> {
  if (people.length === 0) return null;

  const owned = await prisma.project.groupBy({
    by: ['ownerPersonId'],
    // The `where` is what makes the non-null assertion below true: a group key can only
    // be an id here, never the NULL bucket.
    where: { ownerPersonId: { not: null } },
    _count: { _all: true },
  });
  const counts = new Map(owned.map((g) => [g.ownerPersonId as number, g._count._all]));

  // Both halves of the rule, spelled out — the `|| a.id - b.id` is the documented
  // tie-break, and stating it here means the comparator can be read against the header
  // without also knowing how the rows were ordered on the way in.
  const [winner] = [...people].sort(
    (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.id - b.id,
  );
  return {
    id: winner.id,
    name: winner.name,
    email: winner.email,
    programsAlreadyOwned: counts.get(winner.id) ?? 0,
  };
}

export async function repointUnresolvableOwners(): Promise<OwnerRemediationReport> {
  const people = await prisma.person.findMany({ select: personDirectorySelect });
  const projects = await prisma.project.findMany({
    where: { ownerPersonId: null, ownerName: { not: null } },
    select: { id: true, name: true, ownerName: true },
    orderBy: { id: 'asc' },
  });

  const report: OwnerRemediationReport = {
    scanned: projects.length,
    ...partitionUnresolvable(people, projects),
    owner: null,
    repointed: [],
    skipped: 0,
    refused: null,
  };

  if (report.unresolvable.length === 0) return report;

  if (report.unresolvable.length > MAX_REPOINTED) {
    report.refused = `${report.unresolvable.length} projects have an ownerName matching nobody, and this arm refuses above ${MAX_REPOINTED}. Nothing was written.`;
    return report;
  }

  const chosen = await chooseOwner(people);
  if (!chosen) {
    report.refused = 'There are no Person rows to choose an owner from. Nothing was written.';
    return report;
  }

  // Through `requireOwner`, not by assembling the two columns here: that seam is the one
  // place a program's owner is turned into the (email, id) PAIR, and going around it is
  // exactly how a path writes one column and forgets the other.
  const owner = await requireOwner(chosen.email);
  // The chosen person's own address must resolve back to them. It cannot fail today —
  // `requireOwner` matches the exact-email tier first — but it is the assumption that the
  // id being WRITTEN is the id that was RANKED, and an assumption worth a refusal is
  // worth checking rather than commenting. Verified BEFORE `report.owner` is set, so the
  // report never shows an owner the run then declined to use.
  if (owner.ownerPersonId !== chosen.id) {
    report.refused = `“${chosen.email}” resolves to person #${owner.ownerPersonId}, not the ranked #${chosen.id}. Nothing was written.`;
    return report;
  }
  report.owner = chosen;

  // Row by row rather than one `updateMany`, which the bound above is what makes
  // affordable: with at most two statements, the report can say which row was written and
  // which was claimed by someone else, instead of a count that covers both.
  for (const row of report.unresolvable) {
    // `ownerPersonId: null` in the WHERE is the guarantee no non-NULL owner is ever
    // overwritten — including by a re-run — and `ownerName` pins the row to the exact
    // stale text this run READ, so a concurrent edit that fixed the owner properly wins
    // and shows up as skipped.
    const { count } = await prisma.project.updateMany({
      where: { id: row.id, ownerPersonId: null, ownerName: row.ownerName },
      data: owner,
    });
    if (count === 0) {
      report.skipped += 1;
      continue;
    }
    report.repointed.push({
      id: row.id,
      name: row.name,
      before: { ownerName: row.ownerName, ownerPersonId: null },
      after: { ownerName: owner.ownerName, ownerPersonId: owner.ownerPersonId },
    });
  }

  return report;
}

/** The report as the operator reads it on the run's summary page — shaped like the other
 *  arms' (counts first, then one line per row that matters). */
export function formatOwnerRemediationReport(report: OwnerRemediationReport): string {
  // The first line, and the row labels, are worded exactly as `db:backfill:owner-person`
  // words them — an operator reads both reports in one sitting (docs/OPERATIONS.md sends
  // them straight from here to that arm), and two vocabularies for one predicate is how
  // they come to believe the two are counting different things.
  const lines = [
    `Projects with an ownerName and no ownerPersonId: ${report.scanned}`,
    `  unresolvable: ${report.unresolvable.length} (ownerName matches no person — this arm's targets)`,
    `  resolvable:   ${report.resolvable} (left to db:backfill:owner-person)`,
  ];

  if (report.refused) {
    for (const r of report.unresolvable) {
      lines.push(`  UNMATCHED  #${r.id} ${r.name} — ownerName “${r.ownerName}” matches no person`);
    }
    lines.push('', `REFUSED: ${report.refused}`);
    return lines.join('\n');
  }

  if (report.unresolvable.length === 0) {
    lines.push('', 'Nothing to do — every ownerName here names a real person.');
    return lines.join('\n');
  }

  // `owner` is set on every path that reaches here — the two that leave it null both
  // returned above — but the type permits null, and a report a caller hand-built (the
  // formatter tests do) must not crash the runner over a header line.
  const owner = report.owner;
  if (owner) {
    lines.push(
      '',
      `Owner chosen by rule: ${owner.name} <${owner.email}> (person #${owner.id}), who already owns ${owner.programsAlreadyOwned} program(s).`,
      'RULE: the person owning the most programs; ties and an all-zero field break to the lowest Person.id.',
      '',
    );
  }
  for (const r of report.repointed) {
    lines.push(
      `  REPOINTED  #${r.id} ${r.name}`,
      `               before: ownerName “${r.before.ownerName}”, ownerPersonId NULL`,
      `               after:  ownerName “${r.after.ownerName}”, ownerPersonId #${r.after.ownerPersonId}`,
    );
  }
  lines.push(`  repointed: ${report.repointed.length}`);
  if (report.skipped > 0) {
    lines.push(`  skipped:   ${report.skipped} (claimed by a concurrent write — re-run and compare)`);
  }
  return lines.join('\n');
}
