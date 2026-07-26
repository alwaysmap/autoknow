// The budget functions resolve the cadence from REFRESH_CRON_SCHEDULE on every call, so
// any assertion about the DEFAULT has to be made with the variable genuinely absent —
// otherwise a developer's .env (or a future one) silently rewrites what the test proves.
// Two suites need exactly this, so they share it rather than keeping two copies free to
// drift: `beforeEach` clears it, and each test sets its own override afterwards.
export function clearCronScheduleAroundEachTest(): void {
  const inherited = process.env.REFRESH_CRON_SCHEDULE;

  beforeEach(() => {
    delete process.env.REFRESH_CRON_SCHEDULE;
  });

  afterAll(() => {
    if (inherited === undefined) delete process.env.REFRESH_CRON_SCHEDULE;
    else process.env.REFRESH_CRON_SCHEDULE = inherited;
  });
}
