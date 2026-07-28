import { prisma } from './db';

// #127 E9 — READ-ONLY. Answer, for a database nobody can browse, the one question that
// decides whether the unique-at-an-instant migration can be applied to it: does anything
// in there already violate the constraint?
//
// WHY IT EXISTS AT ALL. An exclusion constraint cannot be added `NOT VALID` — Postgres
// offers that escape only for CHECK and FOREIGN KEY — so `ALTER TABLE … ADD CONSTRAINT …
// EXCLUDE` validates every existing row, synchronously, and a single offender turns it
// into a failed `prisma migrate deploy`. That failure is not confined to this change:
// deploy.yml runs `migrate` BEFORE `deploy`, so it would block the release of everything
// merged alongside it. The migration therefore has to be applied to a database somebody
// has already asked this question of, and nobody working on this repo can query
// production (prod writes and prod credentials are human-only, by policy).
//
// So this is the question in a form a human can run: `npm run db:check:email-conflicts`
// locally against any DATABASE_URL, or — for production, keylessly, with no connection
// string on anyone's laptop — the `email-conflicts` arm of the "Run DB backfill"
// workflow (scripts/db/backfill.sh). It only SELECTs. Zero conflicts is the merge gate.
//
// It is not the only line of defence, deliberately: the migration repeats the same query
// as a preflight and RAISES with the offending rows named, so a skipped check produces a
// diagnosis instead of "conflicting key value violates exclusion constraint". Two
// spellings of one predicate is normally the bug (AGENTS lesson 7) — here one of them
// has to be SQL inside a migration that must run without this module, and the test
// pins them against each other by asserting this finds exactly what that constraint
// rejects.

/**
 * One side of a conflicting pair: the period, and the person recording the address on it.
 *
 * NAMED rather than inlined into `EmailConflict` because it is what the remediation arm
 * that clears these decides ABOUT — `lib/addressConflictRemediation` aliases it as
 * `ConflictPeriod` and builds its whole report out of it. Two structurally-identical
 * declarations would compile happily and drift the first time a column is added here.
 */
export interface ConflictSide {
  personId: number;
  personName: string;
  periodId: number;
  startDate: Date;
  endDate: Date | null;
}

/** Two periods that cannot both exist once the constraint does. */
export interface EmailConflict {
  address: string;
  a: ConflictSide;
  b: ConflictSide;
}

interface ConflictRow {
  address: string;
  a_person_id: number;
  a_person_name: string;
  a_period_id: number;
  a_start: Date;
  a_end: Date | null;
  b_person_id: number;
  b_person_name: string;
  b_period_id: number;
  b_start: Date;
  b_end: Date | null;
}

/**
 * Every pair of periods that the unique-at-an-instant constraint would reject: same
 * address (case-folded, as `normalizeAddress` folds it), DIFFERENT people, overlapping
 * time.
 *
 * Raw SQL because it has to be the constraint's own predicate, operator for operator —
 * `tsrange(start, end) && tsrange(start, end)` is what Postgres will evaluate, and a
 * Prisma rendering of "overlaps" would be a paraphrase that can be right about the data
 * and wrong about the constraint. `a.id < b.id` reports each pair once.
 *
 * Periods covering no instant are excluded on both sides, exactly as the constraint's
 * WHERE excludes them: a NULL address names nobody, and a period ending at or before its
 * own start is empty — `tsrange` would not even be constructible for an inverted one.
 */
export async function findEmailConflicts(): Promise<EmailConflict[]> {
  const rows = await prisma.$queryRaw<ConflictRow[]>`
    SELECT lower(a."email")   AS address,
           a."personId"       AS a_person_id,
           pa."name"          AS a_person_name,
           a."id"             AS a_period_id,
           a."startDate"      AS a_start,
           a."endDate"        AS a_end,
           b."personId"       AS b_person_id,
           pb."name"          AS b_person_name,
           b."id"             AS b_period_id,
           b."startDate"      AS b_start,
           b."endDate"        AS b_end
      FROM "PersonAffiliation" a
      JOIN "PersonAffiliation" b
        ON a."id" < b."id"
       AND a."personId" <> b."personId"
       AND lower(a."email") = lower(b."email")
       AND tsrange(a."startDate", a."endDate") && tsrange(b."startDate", b."endDate")
      JOIN "Person" pa ON pa."id" = a."personId"
      JOIN "Person" pb ON pb."id" = b."personId"
     WHERE a."email" IS NOT NULL AND (a."endDate" IS NULL OR a."endDate" > a."startDate")
       AND b."email" IS NOT NULL AND (b."endDate" IS NULL OR b."endDate" > b."startDate")
     ORDER BY address, a_period_id, b_period_id`;

  return rows.map((r) => ({
    address: r.address,
    a: { personId: r.a_person_id, personName: r.a_person_name, periodId: r.a_period_id, startDate: r.a_start, endDate: r.a_end },
    b: { personId: r.b_person_id, personName: r.b_person_name, periodId: r.b_period_id, startDate: r.b_start, endDate: r.b_end },
  }));
}

/** ISO day, or 'open' for a period nobody has ended. */
const day = (d: Date | null): string => (d === null ? 'open' : d.toISOString().slice(0, 10));

/**
 * One conflicting period as a line: who, which period, and when it ran.
 *
 * The ONE rendering of it. `lib/addressConflictRemediation` prints the same periods in
 * its own report, and an operator reads the two in a single sitting — check first, then
 * the arm that clears what it found — so two spellings of this line would read as two
 * different facts about one row.
 */
export function describePeriod(side: ConflictSide): string {
  return `#${side.personId} ${side.personName} — period ${side.periodId}, ${day(side.startDate)} → ${day(side.endDate)}`;
}

/**
 * The report a human reads. Zero conflicts is a one-line answer on purpose — that is the
 * case it will be run in almost every time, and a wall of reassurance is how a real
 * finding gets scrolled past.
 */
export function formatEmailConflictReport(conflicts: EmailConflict[]): string {
  if (conflicts.length === 0) {
    return [
      'No conflicts. Every recorded address names at most one person at any instant.',
      'The unique-at-an-instant constraint can be applied to this database as-is.',
    ].join('\n');
  }
  const lines = [
    `${conflicts.length} conflicting period pair(s) — the migration would FAIL on this database.`,
    '',
  ];
  for (const c of conflicts) {
    lines.push(`  ${c.address}`);
    lines.push(`    ${describePeriod(c.a)}`);
    lines.push(`    ${describePeriod(c.b)}`);
  }
  lines.push(
    '',
    'Each pair is one address recorded against two people over overlapping time, so at',
    'most one of them can be right. Decide which person held it then and correct the',
    'other period (its address becomes NULL — "not recorded" — or the address they',
    'actually used), then run this again. Nothing here changes anything.',
    '',
    'A period covering TODAY is corrected on /people/<id>. A CLOSED one has no editor at',
    'all, and is what the `conflicting-addresses` remediation arm exists for: it clears',
    'the losing period to NULL, keeping the address for whoever holds it now. See',
    'docs/OPERATIONS.md, "The arms, and what their reports mean".',
  );
  return lines.join('\n');
}
