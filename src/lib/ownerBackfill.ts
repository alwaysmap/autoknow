import { prisma } from './db';
import { resolvePersonCandidates } from './people';

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
//   attached at all — `ownerName` still says who it is, and stays the read path until
//   E7. So NULL is a safe, re-runnable answer here and a wrong id is not.
//
// THE AS-OF INSTANT: the RUN instant, resolved against each Person's CURRENT `email`
// and `name`. That is not a shortcut around #127's temporality — it is the only
// question the data can answer today. `email` and `name` are person-level columns
// (#124 §2: name is latest-wins; email becomes period-scoped only in Phase 3), so
// there are no historical addresses to resolve against and no date at which the
// directory would look different. Nothing here reads `PersonAffiliation`, so the
// as-of resolvers and their lint guard are not involved at all.
//
// The consequence to know: a program whose `ownerName` holds an address its owner has
// since left resolves to nobody today — that is #124 Class 4 itself, and it is why the
// script is idempotent and re-runnable rather than one-shot. When Phase 3 lands
// historical addresses, running it again picks those rows up.

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
  const people = await prisma.person.findMany({ select: { id: true, name: true, email: true } });
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
