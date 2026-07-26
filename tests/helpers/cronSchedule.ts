// The budget functions resolve the cadence from REFRESH_CRON_SCHEDULE on every call, so
// any assertion about the DEFAULT has to be made with the variable genuinely absent —
// otherwise a developer's .env (or a future one) silently rewrites what the test proves.

/** Clears REFRESH_CRON_SCHEDULE before each test in the calling suite, and puts whatever
 *  the environment had back once the suite is done. A test that wants an override sets
 *  one in its own body; the clear runs first, so it starts from a known-absent state. */
export function clearCronScheduleBeforeEachTest(): void {
  const inherited = process.env.REFRESH_CRON_SCHEDULE;

  beforeEach(() => {
    delete process.env.REFRESH_CRON_SCHEDULE;
  });

  afterAll(() => {
    if (inherited === undefined) delete process.env.REFRESH_CRON_SCHEDULE;
    else process.env.REFRESH_CRON_SCHEDULE = inherited;
  });
}
