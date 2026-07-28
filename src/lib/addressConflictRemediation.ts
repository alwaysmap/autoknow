import { normalizeAddress } from './auth';
import { prisma } from './db';
import {
  describePeriod,
  findEmailConflicts,
  type ConflictSide,
  type EmailConflict,
} from './emailConflictCheck';
import { coversDay } from './people';

// Clear the LOSING period's address on a conflict nothing in the app can reach —
// `npm run db:remediate:conflicting-addresses`, and through the dispatch runner as the
// `conflicting-addresses` arm.
//
// WHY THIS EXISTS, and why it is not the check's job. `db:check:email-conflicts` names
// every pair of periods recording one address against two different people over
// overlapping time — the gate #127 E9's exclusion constraint must pass before it can be
// applied to a database. Its report ends by telling the operator to "correct the other
// period", and for a CLOSED period that instruction had nowhere to land:
//
//   * `createPersonAt` stamps the address of a period it is opening;
//   * `db:backfill:affiliation-email` writes the period covering NOW, and only where the
//     column is still NULL;
//   * `correctPersonRecord` (#127 E14's unified editor) writes `asOfWhere(at)` — the
//     period covering today, and no other. E14 made TODAY's address correctable; it did
//     not make history editable, which is why this arm survived that epic (the case is
//     pinned by tests/uniqueAtAnInstant.test.ts, "leaves history alone").
//
// So a conflict between two closed periods was fixable by nothing in this repository, and
// docs/OPERATIONS.md had to say so. This is that gap closed on the runner rather than by
// "a hand-written statement run by someone with database access", which is the option the
// dispatch-runner ADR exists to refuse.
//
// A DATABASE HOLDING A CONFLICT IS, BY CONSTRUCTION, ONE THE CONSTRAINT HAS NOT REACHED.
// Once `PersonAffiliation_email_unique_at_an_instant` exists, Postgres refuses to write
// another, so this arm's targets can only be rows that predate it — a database restored
// from before #127 E9, or one the migration is about to be applied to. That is exactly
// when the check is run, and exactly when there is no time to invent a remedy.
//
// THE RULE, which is the only judgement in this file:
//
//   WHOEVER HOLDS THE ADDRESS NOW WINS. The person whose current `Person.email` IS the
//   conflicting address keeps it; every OTHER person's period recording that address is
//   set to NULL — "not recorded", which is the honest value for a period nobody alive can
//   vouch for. No current holder, or more than one, means the rule decides nothing, and
//   the arm writes nothing for that address.
//
// That is not a new tie-break: it is the one `matchTier` in lib/people already ranks by
// ("an address someone left in 2022 names them less strongly than it names whoever
// answers it now"). One rule, asked here as a decision and there as an ordering; a second
// spelling of it would be AGENTS lesson 7.
//
// WHAT IT WILL NOT DO, and both are the same instinct. It never writes an address, only
// NULL — the address a wrongly-recorded period SHOULD carry is a fact about 2022 that no
// query can recover. And it defers a losing period that covers TODAY to the app, because
// there a human can record what is true instead of erasing what is false (#127 E14's
// editor, on /people/:id). Erasing where somebody could have corrected is a worse trade
// than the one this arm exists to make.
//
// The bound and the exit-code contract are required of every arm in this namespace rather
// than being local taste — ADR
// docs/adr/2026-07-27-a-remediation-arm-is-bounded-and-picks-by-rule.md, which extends the
// dispatch-runner ADR this rides on. The two rules the paragraph above states — write only
// where nothing else can, report rather than refuse what the rule cannot decide — are that
// ADR's extension, docs/adr/2026-07-28-a-remediation-arm-erases-only-what-nothing-else-can-correct.md.

/** The most periods a single run may clear before it refuses, writing nothing.
 *
 *  Five, and the reasoning differs from `MAX_REPOINTED`'s: that bound came from a prod
 *  report naming exactly two rows, and no run has ever named a number here — prod's E9
 *  preflight passed with zero, which is what let the constraint land at all. So the bound
 *  encodes the REVIEW rather than a measurement (the ADR's distinction): a handful is what
 *  a person can read line by line on a summary page and recognise, and a database that
 *  produced dozens has something systematically wrong with it that clearing addresses
 *  one at a time would bury rather than fix. */
export const MAX_CLEARED = 5;

/** One period of a conflicting pair, as the report names it — the CHECK's own side type
 *  under the name this module reasons in. An alias, not a re-declaration: two identical
 *  shapes would be structurally assignable and would compile right up until a column is
 *  added to one of them. */
export type ConflictPeriod = ConflictSide;

/** A period this run WROTE (or would have), with the person the rule kept the address for
 *  — the before/after an operator checks the run by. */
export interface ResolvedPeriod {
  address: string;
  period: ConflictPeriod;
  winner: { personId: number; personName: string };
}

/** An address the rule could not decide, with every period recording it. Reported and
 *  LEFT ALONE — see `classify`. */
export interface UndecidableAddress {
  address: string;
  periods: ConflictPeriod[];
  reason: string;
}

export interface AddressConflictRemediationReport {
  /** Period PAIRS `findEmailConflicts` reported — the check's own count, so the two
   *  reports an operator reads back to back agree on the size of the problem. */
  conflicts: number;
  /** Distinct addresses those pairs cover. Three people sharing one address is three
   *  pairs and one address, and the rule decides per ADDRESS. */
  addresses: number;
  /** The subset this arm targets: a losing period the app cannot edit. Named separately
   *  from `cleared` so a refused run still shows what it declined to write, and so a
   *  `skipped` row is visible as the difference between the two. */
  clearable: ResolvedPeriod[];
  /** One entry per period actually cleared to NULL. */
  cleared: ResolvedPeriod[];
  /** Losing periods left to the app because they cover today, where a human can record
   *  the true address instead of erasing the false one. NOT failures. */
  deferred: ResolvedPeriod[];
  /** Addresses the rule decided nothing about. Untouched, and still conflicting. */
  undecidable: UndecidableAddress[];
  /** Targets a concurrent write changed between the scan and the UPDATE. Expected zero. */
  skipped: number;
  /** Set when the run REFUSED and wrote nothing. The runner exits non-zero on it. */
  refused: string | null;
}

/** What the rule decided about one address, before anything is written. */
interface AddressPlan {
  address: string;
  periods: ConflictPeriod[];
  clearable: ResolvedPeriod[];
  deferred: ResolvedPeriod[];
  undecidable: UndecidableAddress | null;
}

/** Group the pairs by address, keeping each period once. A pair names two periods; three
 *  people holding one address name three pairs and six sides, and the rule needs the
 *  three PERIODS. Insertion order follows `findEmailConflicts`' ORDER BY, so the report
 *  is stable run to run. */
function periodsByAddress(conflicts: EmailConflict[]): Map<string, ConflictPeriod[]> {
  const byAddress = new Map<string, ConflictPeriod[]>();
  for (const conflict of conflicts) {
    const address = normalizeAddress(conflict.address);
    const periods = byAddress.get(address) ?? [];
    for (const side of [conflict.a, conflict.b]) {
      if (!periods.some((p) => p.periodId === side.periodId)) periods.push(side);
    }
    byAddress.set(address, periods);
  }
  return byAddress;
}

/**
 * Apply the rule to one address. Pure, and separated from the write so that the whole run
 * is DECIDED before the first UPDATE — which is what makes the bound below a bound on
 * something rather than a count that arrives too late (ADR clause 1).
 *
 * An undecidable address is REPORTED AND LEFT ALONE, not refused. Leaving it is the
 * not-guessing: the arm has no opinion about who held an address nobody holds now, and
 * neither has anything else in this repository, so a refusal would only convert "this one
 * needs a human" into "and so do the four this run could have fixed", with no way for the
 * operator to unblock it. The refusal is reserved for the BOUND, which is the reviewed
 * scale of the whole run.
 */
function classify(
  address: string,
  periods: ConflictPeriod[],
  currentAddressOf: Map<number, string>,
  at: Date,
): AddressPlan {
  const plan: AddressPlan = { address, periods, clearable: [], deferred: [], undecidable: null };
  // Deduped to one PERIOD per person, not to a bare id: the winner has to be named in the
  // report, and carrying the row that names them is what makes the name unconditional.
  const holders = [...new Map(periods.map((p) => [p.personId, p])).values()].filter(
    (p) => currentAddressOf.get(p.personId) === address,
  );

  if (holders.length !== 1) {
    plan.undecidable = {
      address,
      periods,
      reason:
        holders.length === 0
          ? 'nobody records this as their current address, so the rule names no winner'
          : `${holders.length} people record this as their current address, so the rule names no single winner`,
    };
    return plan;
  }

  const winner = { personId: holders[0].personId, personName: holders[0].personName };
  for (const period of periods) {
    if (period.personId === winner.personId) continue;
    // `coversDay`, not an `endDate` test: "is this period CURRENT" has one answer in this
    // codebase and an open-period check is not it (ADR
    // currentpartnerid-is-a-cache-affiliations-are-the-truth). It is also precisely the
    // question that decides whether the app could do better than NULL, since
    // `correctPersonRecord` writes the periods covering today and no others.
    (coversDay(period, at) ? plan.deferred : plan.clearable).push({ address, period, winner });
  }
  return plan;
}

/**
 * The arm. Idempotent by construction — a cleared period has a NULL address, so it leaves
 * the check's scan and cannot be found again — and bounded: above `MAX_CLEARED` it
 * refuses before the first UPDATE and writes nothing at all.
 *
 * `at` exists so the deferral rule can be asked about a day; production always asks about
 * now.
 */
export async function clearConflictingAddresses(
  at: Date = new Date(),
): Promise<AddressConflictRemediationReport> {
  // The CHECK's query, imported rather than re-spelled: what this clears must be exactly
  // what that reports and what the constraint would reject, and there are already two
  // renderings of that predicate (this module's and the migration's SQL) held against
  // each other by tests/uniqueAtAnInstant.test.ts. A third would be the bug.
  const conflicts = await findEmailConflicts();
  const byAddress = periodsByAddress(conflicts);

  const report: AddressConflictRemediationReport = {
    conflicts: conflicts.length,
    addresses: byAddress.size,
    clearable: [],
    cleared: [],
    deferred: [],
    undecidable: [],
    skipped: 0,
    refused: null,
  };
  if (conflicts.length === 0) return report;

  // Who holds what TODAY, read once for everyone named in a conflict. `Person.email` is
  // the current canonical address (it is what `matchTier` calls the holder's), and it is
  // no longer `@unique` since #127 E9 — so "two people hold it" is a state this has to
  // handle, not one it may assume away.
  const personIds = [...new Set([...byAddress.values()].flat().map((p) => p.personId))];
  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, email: true },
  });
  const currentAddressOf = new Map(people.map((p) => [p.id, normalizeAddress(p.email)]));

  const plans = [...byAddress].map(([address, periods]) =>
    classify(address, periods, currentAddressOf, at),
  );
  report.clearable = plans.flatMap((p) => p.clearable);
  report.deferred = plans.flatMap((p) => p.deferred);
  report.undecidable = plans.map((p) => p.undecidable).filter((u) => u !== null);

  if (report.clearable.length > MAX_CLEARED) {
    report.refused = `${report.clearable.length} periods would have their address cleared, and this arm refuses above ${MAX_CLEARED}. Nothing was written.`;
    return report;
  }

  // The exact stored address, read now, so the UPDATE can pin the row to what THIS run
  // saw. Not cosmetic: a period whose address somebody corrected between the scan and the
  // write must survive, and `id` alone would overwrite it.
  const rows = await prisma.personAffiliation.findMany({
    where: { id: { in: report.clearable.map((c) => c.period.periodId) } },
    select: { id: true, email: true },
  });
  const stored = new Map(rows.map((row) => [row.id, row.email]));

  // Row by row rather than one `updateMany`, which the bound is what makes affordable:
  // with at most five statements the report can say which period was cleared and which
  // was claimed by somebody else, instead of a count that covers both.
  for (const target of report.clearable) {
    const address = stored.get(target.period.periodId);
    if (address == null || normalizeAddress(address) !== target.address) {
      report.skipped += 1;
      continue;
    }
    const { count } = await prisma.personAffiliation.updateMany({
      where: { id: target.period.periodId, email: address },
      data: { email: null },
    });
    if (count === 0) {
      report.skipped += 1;
      continue;
    }
    report.cleared.push(target);
  }

  return report;
}

/** The report as the operator reads it on the run's summary page — counts first, then one
 *  line per period that matters, like every other arm's. */
export function formatAddressConflictRemediationReport(
  report: AddressConflictRemediationReport,
): string {
  if (report.conflicts === 0) {
    return 'Nothing to do — no address in this database is recorded against two people at once.';
  }

  const lines = [
    `Conflicting period pairs: ${report.conflicts}, across ${report.addresses} address(es)`,
    `  clearable:   ${report.clearable.length} (the losing period is closed — this arm's targets)`,
    `  deferred:    ${report.deferred.length} (the losing period covers today — correct it in the app instead)`,
    `  undecidable: ${report.undecidable.length} (the rule names no winner — left untouched)`,
  ];

  if (report.refused) {
    for (const c of report.clearable) {
      lines.push(`  CLEARABLE    ${c.address}`, `                 ${describePeriod(c.period)}`);
    }
    lines.push('', `REFUSED: ${report.refused}`);
    return lines.join('\n');
  }

  lines.push(
    '',
    'RULE: whoever holds the address NOW keeps it; every other person’s period recording',
    'it becomes NULL — “not recorded”, the honest value for a period nobody can vouch for.',
    '',
  );

  for (const c of report.cleared) {
    lines.push(
      `  CLEARED      ${c.address}`,
      `                 ${describePeriod(c.period)}`,
      `                 address set to NULL; kept by #${c.winner.personId} ${c.winner.personName}, who holds it today`,
    );
  }
  for (const d of report.deferred) {
    lines.push(
      `  DEFERRED     ${d.address}`,
      `                 ${describePeriod(d.period)}`,
      `                 covers today, so edit #${d.period.personId} ${d.period.personName} on /people/${d.period.personId} — this arm wrote nothing here`,
    );
  }
  for (const u of report.undecidable) {
    lines.push(`  UNDECIDABLE  ${u.address} — ${u.reason}; nothing was written`);
    for (const period of u.periods) lines.push(`                 ${describePeriod(period)}`);
  }

  lines.push('', `  cleared: ${report.cleared.length}`);
  if (report.skipped > 0) {
    lines.push(`  skipped: ${report.skipped} (claimed by a concurrent write — re-run and compare)`);
  }
  if (report.deferred.length > 0 || report.undecidable.length > 0) {
    lines.push(
      '',
      'Conflicts remain: db:check:email-conflicts will still report the DEFERRED and',
      'UNDECIDABLE rows above, and the constraint would still fail on them.',
    );
  }
  return lines.join('\n');
}
