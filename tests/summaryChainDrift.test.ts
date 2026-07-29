/** @jest-environment node */
// Two halves of #236 that only exist against a database: the brief stores the schedule it
// was written against and goes stale when the page moves away from it, and a brief that
// breaks a mechanical rule buys exactly one retry — out of a budget denominated in
// requests, because "one summary, one request" stopped being true the moment it could.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram, SeededProgram } from './helpers/fixtures';
import { parseChainFingerprint } from '../src/lib/chainFingerprint';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

import type { RawSummary } from '../src/lib/gemini';

const clean: RawSummary = {
  tldr: 'Integration is the constraint; the March 2027 SOP still has buffer.',
  progress: [{ text: 'Bring-up finished.', evidence: [0] }],
  risks: [],
  themes: [],
  actions: [],
};
// Two mechanical violations at once: an ISO date in prose, and an action with no
// parenthesized affiliation (the "Sarah Jenkins must drive the partner" shape).
const dirty: RawSummary = {
  ...clean,
  tldr: 'Integration lands past the 2027-03-31 SOP.',
  actions: [{ text: 'Kenji Sato must debug the deadlock.', evidence: [0] }],
};

const generateStructuredSummary = jest.fn(async (_prompt: string): Promise<RawSummary | null> => clean);
jest.mock('../src/lib/gemini', () => ({
  geminiConfigured: true,
  SUMMARY_MODEL: 'mock-model',
  generateStructuredSummary: (prompt: string) => generateStructuredSummary(prompt),
}));

let summaries: typeof import('../src/lib/summaries');
let seeded: SeededProgram;

beforeAll(async () => {
  summaries = await import('../src/lib/summaries');
});

beforeEach(async () => {
  seeded = await seedProgram();
  generateStructuredSummary.mockReset();
  generateStructuredSummary.mockResolvedValue(clean);
});

afterAll(async () => {
  await disconnectTestDb();
});

const storedPrint = async (projectId: number) => {
  const row = await prisma.summary.findFirst({
    where: { scope: 'program', targetId: projectId },
    orderBy: { generatedAt: 'desc' },
  });
  return parseChainFingerprint(row?.chainFingerprint);
};

describe('a program brief records the schedule it was written against', () => {
  it('stores a fingerprint naming the constraint the page shows', async () => {
    const { id } = await summaries.createSummary('program', seeded.projectId, 'manual');
    expect(id).not.toBeNull();
    const print = await storedPrint(seeded.projectId);
    // The fixture's chain is bringUp → integration → certification, and integration is
    // the first unfinished phase on it.
    expect(print).toMatchObject({ constraintPhaseId: seeded.phases.integration });
    expect(print!.projectedFinishMs).toEqual(expect.any(Number));
  });

  it('a partner or ecosystem brief stores none — one chain cannot stand for many', async () => {
    await summaries.createSummary('partner', seeded.oemId, 'manual');
    const row = await prisma.summary.findFirst({ where: { scope: 'partner', targetId: seeded.oemId } });
    expect(row?.chainFingerprint ?? null).toBeNull();
  });
});

describe('a brief goes stale when the schedule drifts out from under it', () => {
  it('is fresh immediately after generation', async () => {
    await summaries.createSummary('program', seeded.projectId, 'manual');
    const view = await summaries.getSummary('program', seeded.projectId);
    expect(view?.stale).toBe(false);
  });

  it('a replan that files NO new state row still marks it stale', async () => {
    // This is the case the old staleness could not see: nothing was ingested and no
    // update was filed, so the "newer content" probes all say no — but the chain the
    // page draws now lands months later than the one the brief describes. A brief
    // sitting beside a ledger computing different numbers is the defect (#236 finding 6).
    await summaries.createSummary('program', seeded.projectId, 'manual');
    const before = await summaries.getSummary('program', seeded.projectId);
    expect(before?.stale).toBe(false);

    await prisma.phase.update({
      where: { id: seeded.phases.certification },
      data: { forecastedDuration: 200 },
    });
    // Prove no new row appeared — otherwise this would pass for the old reason.
    const newer = await prisma.phaseState.findFirst({
      where: { phase: { projectId: seeded.projectId }, timestamp: { gt: new Date(before!.generatedAt) } },
    });
    expect(newer).toBeNull();

    const after = await summaries.getSummary('program', seeded.projectId);
    expect(after?.stale).toBe(true);
  });

  it('the cron sweep sees the same drift, set-based', async () => {
    await summaries.createSummary('program', seeded.projectId, 'manual');
    // Everything else is already covered, so a quiet cycle would regenerate nothing.
    await summaries.createSummary('partner', seeded.oemId, 'manual');
    await summaries.createSummary('partner', seeded.supplierId, 'manual');
    await summaries.createSummary('ecosystem', 0, 'manual');

    await prisma.phase.update({ where: { id: seeded.phases.certification }, data: { forecastedDuration: 200 } });

    const report = await summaries.runSummaryCycle();
    expect(report.generated).toBeGreaterThanOrEqual(1);
  });
});

describe('a mechanical violation buys one retry, spent from a REQUEST allowance', () => {
  it('re-asks once and keeps the cleaner answer', async () => {
    generateStructuredSummary.mockResolvedValueOnce(dirty).mockResolvedValueOnce(clean);
    const { id, requests } = await summaries.createSummary('program', seeded.projectId, 'manual');
    expect(requests).toBe(2);
    const row = await prisma.summary.findUnique({ where: { id: id! } });
    expect(row?.tldr).toBe(clean.tldr);
    // The retry prompt states what was broken, so the model has something to fix.
    const retryPrompt = generateStructuredSummary.mock.calls[1][0] as unknown as string;
    expect(retryPrompt).toContain('ISO');
    expect(retryPrompt).toContain('actions[0]');
  });

  it('keeps the FIRST answer when the retry is no better, rather than trading down', async () => {
    generateStructuredSummary.mockResolvedValueOnce(dirty).mockResolvedValueOnce(dirty);
    const { id, requests } = await summaries.createSummary('program', seeded.projectId, 'manual');
    expect(requests).toBe(2);
    const row = await prisma.summary.findUnique({ where: { id: id! } });
    expect(row?.tldr).toBe(dirty.tldr);
  });

  it('never retries when the allowance only buys one call', async () => {
    generateStructuredSummary.mockResolvedValue(dirty);
    const { requests } = await summaries.createSummary('program', seeded.projectId, 'manual', { maxRequests: 1 });
    expect(requests).toBe(1);
    expect(generateStructuredSummary).toHaveBeenCalledTimes(1);
  });

  it('a clean answer costs one request', async () => {
    const { requests } = await summaries.createSummary('program', seeded.projectId, 'manual');
    expect(requests).toBe(1);
  });

  it('the cycle spends requests, so retries cannot push it past its ceiling', async () => {
    // Every brief here breaks a rule, so each attempt wants two calls. The allowance is
    // three REQUESTS: that must buy one-and-a-bit briefs, not three of them.
    generateStructuredSummary.mockResolvedValue(dirty);
    const report = await summaries.runSummaryCycle({ maxRequests: 3 });
    expect(report.requests).toBeLessThanOrEqual(3);
    expect(generateStructuredSummary.mock.calls.length).toBeLessThanOrEqual(3);
    expect(report.hitCap).toBe(true);
  });
});
