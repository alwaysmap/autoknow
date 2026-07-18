// Fail-closed guard for destructive database operations (wipe / re-seed).
//
// The threat this closes: a misconfigured DATABASE_URL (or NODE_ENV) causing a wipe
// to hit production data. The test suite already forces a `*_test` database name; this
// is the symmetric guarantee for the APP's destructive paths. A wipe is permitted only
// when EITHER:
//   - the resolved database name ends in `_test` (disposable, the suite's own DB), OR
//   - the operator has set DESTRUCTIVE_DB_ALLOWED to the EXACT resolved database name,
//     in the same environment, at call time.
// So the default (unset) refuses every non-test wipe, and a confirmation intended for
// one database can never authorize a wipe of a different, accidentally-configured one.

/** The database name from a Postgres connection string (path minus the leading slash,
 *  query string dropped). */
export function resolveDbName(url: string): string {
  const u = new URL(url);
  return u.pathname.replace(/^\//, '');
}

export function assertDestructiveDbAllowed(op: string): void {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(`Refusing ${op}: DATABASE_URL is not set, so the target database cannot be verified.`);
  }
  let dbName: string;
  try {
    dbName = resolveDbName(url);
  } catch {
    throw new Error(`Refusing ${op}: DATABASE_URL is not a valid connection string.`);
  }

  if (dbName.endsWith('_test')) return; // disposable test database — always safe

  const confirmed = process.env.DESTRUCTIVE_DB_ALLOWED;
  if (confirmed && confirmed === dbName) return;

  throw new Error(
    `Refusing ${op} against database "${dbName}". Destructive DB operations require ` +
      `DESTRUCTIVE_DB_ALLOWED="${dbName}" to be set in this environment ` +
      `(current value: ${confirmed ? `"${confirmed}"` : 'unset'}). ` +
      `This guard makes accidental production wipes impossible: a confirmation naming a ` +
      `different database will never authorize this one.`,
  );
}
