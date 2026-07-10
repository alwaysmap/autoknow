// The single source of truth for which database tests may touch. It derives a
// dedicated `<name>_test` database from DATABASE_URL (or TEST_DATABASE_URL), so even a
// misconfigured environment can NEVER point the test suite at the real database — the
// name is forced to end in `_test`, and we fail hard if that somehow isn't true.

export function testDatabaseUrl(): string {
  const base =
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/autoknow';

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '') || 'autoknow';
  if (!name.endsWith('_test')) {
    url.pathname = `/${name}_test`;
  }

  if (!url.pathname.endsWith('_test')) {
    throw new Error(`Refusing to run tests: database name must end in "_test" (got ${url.pathname})`);
  }
  return url.toString();
}
