/** @jest-environment node */
// The hourly summary worker's staleness pass must be set-based (the per-target
// getSummary probes were an N+1: 4-5 queries × every partner and program, hourly)
// and must agree with getSummary's own staleness verdicts.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram, SeededProgram } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));
jest.mock('../src/lib/gemini', () => ({
  geminiConfigured: true,
  SUMMARY_MODEL: 'mock-model',
  generateStructuredSummary: jest.fn(async () => ({
    tldr: 'All good',
    progress: [{ text: 'moving [0]', evidence: [0] }],
    risks: [],
    themes: [],
    actions: [],
  })),
}));

let summaries: typeof import('../src/lib/summaries');
let seeded: SeededProgram;

beforeAll(async () => {
  summaries = await import('../src/lib/summaries');
  seeded = await seedProgram();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('runSummaryCycle', () => {
  it('backfills every scope on the first pass', async () => {
    const report = await summaries.runSummaryCycle();
    // ecosystem + 2 partners (Rivian, Denso) + 1 program
    expect(report.scopes).toBe(4);
    expect(report.generated).toBeGreaterThanOrEqual(3); // Denso may have no evidence
    expect(report.errors).toBe(0);
  });

  it('a quiet second pass regenerates nothing', async () => {
    const report = await summaries.runSummaryCycle();
    expect(report.generated).toBe(0);
    expect(report.errors).toBe(0);
  });

  it('new program activity marks program, owning partner, and ecosystem stale', async () => {
    await prisma.projectState.create({
      data: {
        projectId: seeded.projectId,
        theNeedle: 'Concerned',
        hillChartProgress: 45,
        notes: 'late-breaking risk',
        source: 'testbot',
      },
    });

    // The single-view staleness must agree before the cycle regenerates.
    const view = await summaries.getSummary('program', seeded.projectId);
    expect(view?.stale).toBe(true);

    const report = await summaries.runSummaryCycle();
    // program + Rivian (owning partner roll-up) + ecosystem; Denso stays fresh
    expect(report.generated).toBe(3);

    const after = await summaries.getSummary('program', seeded.projectId);
    expect(after?.stale).toBe(false);
  });
});
