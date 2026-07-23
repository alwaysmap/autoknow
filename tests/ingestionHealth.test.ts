/** @jest-environment node */
// #38: recordCycle keeps exactly ONE bounded summary row (upserted, never appended — the
// ingestion-health ADR's whole point), combining the Drive + web reports and the total
// backlog the drain alarm watches; getIngestionHealth reads that row plus the live skip
// set and the budget gauge for Manage → Sources.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';

process.env.DATABASE_URL = testDatabaseUrl();
jest.mock('server-only', () => ({}));

import type { DriveSyncReport } from '../src/lib/driveSync';
import type { CycleReport } from '../src/lib/refresh';

// Dynamic import AFTER process.env.DATABASE_URL is set — a static import is hoisted above
// it, binding src/lib/db to the wrong database (the repo's standard test pattern).
let recordCycle: typeof import('../src/lib/ingestionHealth').recordCycle;
let getIngestionHealth: typeof import('../src/lib/ingestionHealth').getIngestionHealth;
beforeAll(async () => {
  ({ recordCycle, getIngestionHealth } = await import('../src/lib/ingestionHealth'));
});

const drive = (o: Partial<DriveSyncReport> = {}): DriveSyncReport => ({
  configured: true, sharedSeen: 10, discovered: 2, refreshed: 1, skippedOtherTypes: 3,
  skippedTooDeep: 1, errors: 0, demand: 5, spent: 3, backlog: 2, quotaStopped: false, ...o,
});
const web = (o: Partial<CycleReport> = {}): CycleReport => ({
  due: 8, checked: 5, changed: 2, frozen: 0, errors: 1, skippedDrive: 4, backlog: 3, quotaStopped: false, ...o,
});

beforeEach(async () => {
  await prisma.ingestionCycleSummary.deleteMany();
  await prisma.skippedSource.deleteMany();
});
afterAll(async () => { await disconnectTestDb(); });

describe('#38 ingestion health recorder', () => {
  it('keeps exactly one summary row and sums the backlog across Drive + web', async () => {
    await recordCycle(drive(), web());
    await recordCycle(drive({ backlog: 0 }), web({ backlog: 1 }));

    expect(await prisma.ingestionCycleSummary.count()).toBe(1); // upserted, never appended
    const health = await getIngestionHealth();
    expect(health.summary?.backlog).toBe(1); // 0 (drive) + 1 (web) from the latest cycle
    expect(health.summary?.discovered).toBe(2);
  });

  it('surfaces a quota stop from either half', async () => {
    await recordCycle(drive({ quotaStopped: false }), web({ quotaStopped: true }));
    const health = await getIngestionHealth();
    expect(health.summary?.quotaStopped).toBe(true);
  });

  it('reports null summary and the default budget gauge before the first run', async () => {
    const health = await getIngestionHealth();
    expect(health.summary).toBeNull();
    expect(health.budget.dailyReingestBudgetDocs).toBe(60); // schema default
    expect(health.gauge.exceedsFreeTier).toBe(false); // default 60/250 is safe
  });
});
