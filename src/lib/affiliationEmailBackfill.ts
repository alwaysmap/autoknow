import { normalizeAddress } from './auth';
import { prisma } from './db';
import { coversDay } from './people';

// #127 E8 — fill `PersonAffiliation.email` for the careers that predate the column.
// Run it with `npm run db:backfill:affiliation-email`; it is deliberately NOT part of
// the migration (docs/CHANGE_PLAYBOOK.md: backfills are separate, idempotent scripts,
// never inside `migrate deploy`), because deciding which period an address belongs to
// is a judgement whose leftovers a human has to look at.
//
// THE RESOLUTION RULE, which is the whole of this file, and it is E6's rule (ADR
// a-name-to-fk-backfill-writes-only-the-unambiguous) in a second column:
//
//   `Person.email` is the address the person uses NOW. The only period it demonstrably
//   belongs to is the one they are IN now. So: write it to the period covering the run
//   instant, and only when there is exactly one.
//
//     * no covering period   -> nothing written, REPORTED as uncovered. Their career
//       has a gap over today, or is entirely past or entirely future — so the current
//       address belongs to none of the periods on file and picking one would be a guess.
//     * two or more covering -> nothing written, REPORTED as ambiguous, naming the
//       periods. Overlapping periods are a data bug in their own right (autoknow-2of);
//       this refuses to build on one.
//
//   EVERY OTHER PERIOD IS LEFT NULL ON PURPOSE, and that is not a failure of this
//   script — it is the truth. Nothing anywhere in this system records the address
//   somebody used at a company they left before the column existed. NULL reads as "not
//   recorded" (the matcher in lib/people skips it), which is exactly right; inventing
//   `handle@thatpartner.com` would produce a plausible address that resolves real
//   artifacts to a person on no evidence at all. The report counts them so the size of
//   that hole is a number rather than a feeling.
//
// THE AS-OF INSTANT: the RUN instant, compared AT UTC-DAY GRANULARITY via `coversDay`.
// Employment boundaries are calendar facts, which is the argument written down at
// `coversDay` itself, and this function holds the periods already — the two sanctioned
// spellings of the predicate are `coversDay` for rows in hand and `lib/profiles` for
// rows still to fetch, and a third comparison here would be the bug. (Bead autoknow-yid
// tracks that those two spellings differ for a boundary carrying a time-of-day; they
// agree here, because affiliation boundaries are dates and the run instant is not
// midnight.) Re-running later moves the target: whoever has changed jobs since gets
// their NEW period stamped, which is the same reason the E6 script re-runs.
//
// A note on what this is NOT: it never touches `Person.email`, and it never overwrites a
// period that already carries an address. `createPersonAt` stamps the period it opens,
// so people added after E8 arrive already correct and appear here as `alreadyRecorded`.

/** One person, as the report names them. */
export interface AffiliationEmailRow {
  id: number;
  name: string;
  email: string;
}

export interface AffiliationEmailBackfillReport {
  /** People holding at least one period with no address — the candidates for this run. */
  scanned: number;
  /** Periods given an address. At most one per person, so this is also a people count. */
  linked: number;
  /** No period covers today, so `Person.email` belongs to none of them. */
  uncovered: AffiliationEmailRow[];
  /** More than one period covers today — overlapping data this refuses to guess at. */
  ambiguous: (AffiliationEmailRow & { periods: { id: number; partner: string }[] })[];
  /** The covering period already carried an address: a re-run, or `createPersonAt`. */
  alreadyRecorded: number;
  /** Resolved, but claimed between the read and the UPDATE. The next run picks it up;
   *  it is here so the buckets always SUM to `scanned`, which is what makes "has this
   *  reached zero?" a usable gate. */
  skipped: number;
  /** Periods left NULL because they are not the one covering today — the permanent,
   *  honest leftover, and NOT something to act on row by row. Counted, not listed. */
  unrecordedHistory: number;
}

export async function backfillAffiliationEmail(
  at: Date = new Date(),
): Promise<AffiliationEmailBackfillReport> {
  // Only people who have something to fill: a person whose every period already carries
  // an address is not a candidate, so a second run scans almost nobody.
  const people = await prisma.person.findMany({
    where: { affiliations: { some: { email: null } } },
    select: {
      id: true,
      name: true,
      email: true,
      affiliations: {
        select: { id: true, email: true, startDate: true, endDate: true, partner: { select: { name: true } } },
      },
    },
    orderBy: { id: 'asc' },
  });

  const report: AffiliationEmailBackfillReport = {
    scanned: people.length,
    linked: 0,
    uncovered: [],
    ambiguous: [],
    alreadyRecorded: 0,
    skipped: 0,
    unrecordedHistory: 0,
  };
  // One UPDATE per distinct address rather than per period — the batching the playbook
  // asks for. Keyed by address because that is what is written; two people never share
  // one while `Person.email` is still `@unique` (#127 E9), so in practice each entry
  // holds a single id, and the shape survives E9 dropping that.
  const byAddress = new Map<string, number[]>();

  for (const person of people) {
    const row = { id: person.id, name: person.name, email: person.email };
    const covering = person.affiliations.filter((a) => coversDay(a, at));
    const history = person.affiliations.filter((a) => a.email == null && !covering.includes(a));
    report.unrecordedHistory += history.length;

    if (covering.length === 0) {
      report.uncovered.push(row);
    } else if (covering.length > 1) {
      report.ambiguous.push({
        ...row,
        periods: covering.map((a) => ({ id: a.id, partner: a.partner.name })),
      });
    } else if (covering[0].email != null) {
      report.alreadyRecorded += 1;
    } else {
      const address = normalizeAddress(person.email);
      const ids = byAddress.get(address) ?? [];
      ids.push(covering[0].id);
      byAddress.set(address, ids);
    }
  }

  for (const [email, ids] of byAddress) {
    // `email: null` in the WHERE is what makes a re-run a no-op AND keeps a concurrent
    // write (a person edit, a move) from being overwritten by this scan's stale view.
    const { count } = await prisma.personAffiliation.updateMany({
      where: { id: { in: ids }, email: null },
      data: { email },
    });
    report.linked += count;
    report.skipped += ids.length - count;
  }

  return report;
}

/** The report as the operator reads it — one line per person this REFUSED to decide for,
 *  because those are the only rows anybody can act on. */
export function formatAffiliationEmailReport(report: AffiliationEmailBackfillReport): string {
  const lines = [
    `People with an address-less employment period: ${report.scanned}`,
    `  linked:          ${report.linked}`,
    `  already had one: ${report.alreadyRecorded}`,
    `  uncovered:       ${report.uncovered.length}`,
    `  ambiguous:       ${report.ambiguous.length}`,
  ];
  if (report.skipped > 0) {
    lines.push(`  skipped:         ${report.skipped} (claimed by a concurrent write — re-run)`);
  }
  for (const r of report.uncovered) {
    lines.push(
      `  UNCOVERED  #${r.id} ${r.name} — no period covers today, so “${r.email}” belongs to none of them`,
    );
  }
  for (const r of report.ambiguous) {
    const where = r.periods.map((p) => `${p.partner} (period #${p.id})`).join(', ');
    lines.push(`  AMBIGUOUS  #${r.id} ${r.name} — ${r.periods.length} periods cover today: ${where}`);
  }
  if (report.uncovered.length + report.ambiguous.length > 0) {
    lines.push('', 'Left NULL on purpose — fix those careers, then re-run.');
  }
  lines.push(
    '',
    `Past/future periods still with no address: ${report.unrecordedHistory}.`,
    'EXPECTED, and not a leftover to chase: nothing recorded what address those jobs',
    'used, and NULL says so honestly. They fill in as people are edited from here on.',
  );
  return lines.join('\n');
}
