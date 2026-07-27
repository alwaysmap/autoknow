import { prisma } from './db';
import { requireOwner } from './owner';
import { personDirectorySelect, resolvePersonCandidates } from './people';

// Repoint the programs whose `ownerName` names NOBODY — `npm run db:remediate:unmatched-owners`,
// and through the dispatch runner as the `unmatched-owners` arm.
//
// WHY THIS EXISTS, and why it is not the E6 backfill's job. `db:backfill:owner-person`
// turns `ownerName` into `ownerPersonId` and REFUSES to guess when the text matches no
// person — correctly, because a wrong owner is worse than no owner. Run against prod it
// reported `linked: 9 / unmatched: 2 / ambiguous: 0`, and the two leftovers are display
// names from the initial mock seed ('Alice PM', 'Clara Operations') that never named a
// Person in that database at all. Re-running the backfill cannot clear them: the strings
// still match nobody, and they never will. The matcher is fine; the DATA is stale.
//
// Those two rows are the gate for #127 E7 (retiring the `ownerName` readers), so they
// have to become real references. This is the one-shot arm that makes them so.
//
// THE OWNER-SELECTION RULE, which is the only judgement in this file:
//
//   The BUSIEST EXISTING OWNER — the Person referenced by `Project.ownerPersonId` on the
//   most programs. Ties, and the case where no program has an owner at all, break to the
//   LOWEST `Person.id`.
//
// It is deterministic because both keys come from the database and the second one is
// unique: for any given database state exactly one person wins, and running it twice on
// that state picks the same human. It is not a hardcoded id, which matters because
// nothing here can query production to check that an id it was born holding still names
// the person somebody meant — whereas "whoever already owns the most programs" is
// evaluated against whatever prod actually contains, and resolves to a real, active
// owner there by construction. Dylan's instruction was "just pick someone for that mock
// data in production, i don't care who"; a rule the reader can re-evaluate by hand is
// how that becomes reviewable rather than arbitrary.
//
// It is also self-reinforcing, and deliberately so: the winner gains the repointed
// programs and would win again. For MOCK rows being parked on a plausible owner that is
// the desired stability, not a bias to correct.
//
// The bound and the rule are both required of any arm in this namespace, not local taste
// — ADR docs/adr/2026-07-27-a-remediation-arm-is-bounded-and-picks-by-rule.md, which
// extends the dispatch-runner ADR this rides on.
//
// THE BOUND. It refuses, writing nothing, if more than MAX_REPOINTED rows qualify. Two
// is the count established from the prod run above, and it is the whole point: a
// remediation that silently rewrote fifty rows because an assumption changed under it
// would be indistinguishable, in the report, from one that worked.
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
  repointed: {
    id: number;
    name: string;
    before: { ownerName: string; ownerPersonId: null };
    after: { ownerName: string; ownerPersonId: number };
  }[];
  /** Targets a concurrent write claimed between the scan and the UPDATE. Expected zero. */
  skipped: number;
  /** Set when the run REFUSED and wrote nothing. The runner exits non-zero on it. */
  refused: string | null;
}

/** Rank every person by (programs already owned DESC, id ASC) and take the first — the
 *  rule in the header, as one function so the report and the write agree on the answer. */
async function chooseOwner(): Promise<ChosenOwner | null> {
  const people = await prisma.person.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { id: 'asc' },
  });
  if (people.length === 0) return null;

  const owned = await prisma.project.groupBy({
    by: ['ownerPersonId'],
    where: { ownerPersonId: { not: null } },
    _count: { _all: true },
  });
  const counts = new Map(owned.map((g) => [g.ownerPersonId as number, g._count._all]));

  // `people` is already id-ascending, and Array.prototype.sort is stable (spec since
  // ES2019), so comparing on the count alone leaves the id tie-break in place.
  const [winner] = [...people].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  return { ...winner, programsAlreadyOwned: counts.get(winner.id) ?? 0 };
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
    unresolvable: [],
    resolvable: 0,
    owner: null,
    repointed: [],
    skipped: 0,
    refused: null,
  };

  for (const project of projects) {
    // The SAME matcher the backfill and the write paths use (AGENTS lesson 7). Zero
    // candidates is this arm's target; one is the backfill's job and two-or-more is a
    // human's, and neither is touched here.
    if (resolvePersonCandidates(people, project.ownerName).length === 0) {
      report.unresolvable.push({
        id: project.id,
        name: project.name,
        ownerName: project.ownerName ?? '',
      });
    } else {
      report.resolvable += 1;
    }
  }

  if (report.unresolvable.length === 0) return report;

  if (report.unresolvable.length > MAX_REPOINTED) {
    report.refused = `${report.unresolvable.length} programs have an ownerName matching nobody, and this arm refuses above ${MAX_REPOINTED}. Nothing was written.`;
    return report;
  }

  const chosen = await chooseOwner();
  if (!chosen) {
    report.refused = 'There are no Person rows to choose an owner from. Nothing was written.';
    return report;
  }
  report.owner = chosen;

  // Through `requireOwner`, not by assembling the two columns here: that seam is the one
  // place a program's owner is turned into the (email, id) PAIR, and going around it is
  // exactly how a path writes one column and forgets the other.
  const owner = await requireOwner(chosen.email);
  // The chosen person's own address must resolve back to them. It cannot fail today —
  // `requireOwner` matches the exact-email tier first — but it is the assumption that the
  // id being WRITTEN is the id that was RANKED, and an assumption worth a refusal is
  // worth checking rather than commenting.
  if (owner.ownerPersonId !== chosen.id) {
    report.owner = null;
    report.refused = `“${chosen.email}” resolves to person #${owner.ownerPersonId}, not the ranked #${chosen.id}. Nothing was written.`;
    return report;
  }

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
  const lines = [
    `Programs with an ownerName and no ownerPersonId: ${report.scanned}`,
    `  unresolvable: ${report.unresolvable.length} (ownerName matches no person — this arm's targets)`,
    `  resolvable:   ${report.resolvable} (left to db:backfill:owner-person)`,
  ];

  if (report.refused) {
    for (const r of report.unresolvable) {
      lines.push(`  FOUND      #${r.id} ${r.name} — ownerName “${r.ownerName}”`);
    }
    lines.push('', `REFUSED: ${report.refused}`);
    return lines.join('\n');
  }

  if (report.unresolvable.length === 0) {
    lines.push('', 'Nothing to do — every ownerName here names a real person.');
    return lines.join('\n');
  }

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
