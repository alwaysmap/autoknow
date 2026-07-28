import { prisma } from './db';
import { personDirectorySelect, resolvePersonCandidates } from './people';

// #127 E6 — fill `Project.ownerPersonId` from the `ownerName` text that predates it.
// Run it with `npm run db:backfill:owner-person`; it is deliberately NOT part of the
// migration (docs/CHANGE_PLAYBOOK.md: backfills are separate, idempotent scripts, never
// inside `migrate deploy`), because turning a NAME into a PERSON is a judgement whose
// leftovers a human has to look at.
//
// THE RESOLUTION RULE, which is the whole of this file:
//
//   Resolve with `resolvePersonCandidates` — the SAME three tiers the write paths use
//   (exact email, else email local-part, else exact case-insensitive full name) — and
//   write ONLY when the winning tier holds exactly one person.
//
//     * no candidate      -> `ownerPersonId` stays NULL, the row is REPORTED as unmatched
//     * two or more       -> `ownerPersonId` stays NULL, the row is REPORTED as ambiguous
//
//   Neither case guesses. `resolvePerson` guesses (first match wins) and is right to:
//   a form can be corrected by the person looking at it. A backfill has no one looking,
//   and an owner silently attached to the wrong human is worse than an owner not
//   attached at all. So NULL is a safe, re-runnable answer here and a wrong id is not.
//   (When this was written `ownerName` was still the read path, so an unlinked row at
//   least still displayed its owner. Since #127 E7 it does not: an unlinked program
//   reads as UNOWNED. That raises the stakes of a NULL, and lowers them for a wrong id —
//   but not enough to start guessing, because a wrong owner is a silent lie and a
//   missing one is a visible prompt.)
//
// THE AS-OF INSTANT: the RUN instant, and it stays that way — but what the run instant
// SEES widened at #127 E8. `name` is still a person-level column (#124 §2, latest-wins),
// and addresses are now period-scoped, so the directory below is fetched with
// `personDirectorySelect` and the matcher searches every address a person has ever held.
// There is still no date at which this would answer differently: resolution is not
// temporal (the argument is at `resolvePersonCandidates`), so the as-of resolvers and
// their lint guard remain uninvolved.
//
// This is why the script was written idempotent and re-runnable rather than one-shot.
// Before E8, a program whose `ownerName` held an address its owner had since left
// resolved to nobody — #124 Class 4 itself, and it showed up as UNMATCHED lines in the
// report. Re-running it after `db:backfill:affiliation-email` has recorded those
// addresses is what clears them, and clearing them WAS E7's gate: E7 shipped once a prod
// run reported `scanned: 0`, because a program with no `ownerPersonId` now has no
// displayed owner at all.

export interface OwnerBackfillRow {
  id: number;
  name: string;
  ownerName: string;
}

export interface OwnerBackfillReport {
  /** Projects carrying an `ownerName` but no `ownerPersonId` — the candidates for this run. */
  scanned: number;
  /** How many got an id. */
  linked: number;
  /** `ownerName` matched no person, at any tier. */
  unmatched: OwnerBackfillRow[];
  /** `ownerName` matched more than one person in the tier that won. */
  ambiguous: (OwnerBackfillRow & { candidates: { id: number; email: string }[] })[];
  /** Resolved, but gone by the time the UPDATE ran — a concurrent dual-write or delete
   *  claimed the row. The next run picks it up; it is here so the buckets always SUM to
   *  `scanned`, which is what makes "has this reached zero?" a usable gate for E7. */
  skipped: number;
}

export async function backfillProjectOwnerPerson(): Promise<OwnerBackfillReport> {
  const people = await prisma.person.findMany({ select: personDirectorySelect });
  const projects = await prisma.project.findMany({
    where: { ownerPersonId: null, ownerName: { not: null } },
    select: { id: true, name: true, ownerName: true },
    orderBy: { id: 'asc' },
  });

  const report: OwnerBackfillReport = {
    scanned: projects.length, linked: 0, unmatched: [], ambiguous: [], skipped: 0,
  };
  // One UPDATE per distinct owner rather than per project — the batching the playbook
  // asks for, and it keeps a 500-program backfill to a handful of statements.
  const byPerson = new Map<number, number[]>();

  for (const project of projects) {
    const row = { id: project.id, name: project.name, ownerName: project.ownerName ?? '' };
    const candidates = resolvePersonCandidates(people, project.ownerName);
    if (candidates.length === 1) {
      const ids = byPerson.get(candidates[0].id) ?? [];
      ids.push(project.id);
      byPerson.set(candidates[0].id, ids);
    } else if (candidates.length === 0) {
      report.unmatched.push(row);
    } else {
      report.ambiguous.push({
        ...row,
        candidates: candidates.map((c) => ({ id: c.id, email: c.email })),
      });
    }
  }

  for (const [ownerPersonId, ids] of byPerson) {
    // `ownerPersonId: null` in the WHERE is what makes a re-run a no-op AND keeps a
    // concurrent dual-write from being overwritten by this scan's stale view.
    const { count } = await prisma.project.updateMany({
      where: { id: { in: ids }, ownerPersonId: null },
      data: { ownerPersonId },
    });
    report.linked += count;
    report.skipped += ids.length - count;
  }

  return report;
}

/** The report as the operator reads it — one line per unresolved row, because those are
 *  the ones somebody has to act on before #127 E7 can move the readers onto the FK. */
export function formatOwnerBackfillReport(report: OwnerBackfillReport): string {
  const lines = [
    `Projects with an ownerName and no ownerPersonId: ${report.scanned}`,
    `  linked:    ${report.linked}`,
    `  unmatched: ${report.unmatched.length}`,
    `  ambiguous: ${report.ambiguous.length}`,
  ];
  if (report.skipped > 0) {
    lines.push(`  skipped:   ${report.skipped} (claimed by a concurrent write — re-run)`);
  }
  for (const r of report.unmatched) {
    lines.push(`  UNMATCHED  #${r.id} ${r.name} — ownerName “${r.ownerName}” matches no person`);
  }
  for (const r of report.ambiguous) {
    const who = r.candidates.map((c) => `${c.email} (#${c.id})`).join(', ');
    lines.push(`  AMBIGUOUS  #${r.id} ${r.name} — ownerName “${r.ownerName}” matches ${who}`);
  }
  if (report.unmatched.length + report.ambiguous.length > 0) {
    lines.push('', 'Left NULL on purpose — fix the owner on those programs, then re-run.');
  }
  return lines.join('\n');
}
