/** @jest-environment node */
// Partner health in the AI briefing (#111). Two defects, one mechanism: the brief
// printed "3/5" because the EVIDENCE we handed the model was itself numeric, and the
// receipt under the bullet pointed at the bare partner page — so a reader who clicked
// the update they were reading about landed on the page they were already on.
//
// Both are decided here, at the boundary, before a single token reaches the model: the
// evidence carries the qualitative WORD, and the citation carries the fragment that
// opens that update's popover (AGENTS lesson 15 — a URL is data, resolved by us).
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

// Captures the prompt (evidence and all) instead of calling Gemini, and cites the
// CURRENT relationship update — evidence record 0 for partner scope.
const generateStructuredSummary = jest.fn(async (_prompt: string) => ({
  tldr: 'The relationship holds.',
  progress: [{ text: 'Cadence is unchanged. [0]', evidence: [0] }],
  risks: [],
  themes: [],
  actions: [],
}));

jest.mock('../src/lib/gemini', () => ({
  geminiConfigured: true,
  SUMMARY_MODEL: 'mock-model',
  generateStructuredSummary: (prompt: string) => generateStructuredSummary(prompt),
}));

let summaries: typeof import('../src/lib/summaries');
let partnerId: number;
let currentStateId: number;

beforeAll(async () => {
  summaries = await import('../src/lib/summaries');
  await wipeAll();

  const partner = await prisma.partner.create({
    data: {
      name: 'Rivian',
      type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
      region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
    },
  });
  partnerId = partner.id;

  // Two readings, so "current" and "prior" are distinguishable — and a mid-scale 3,
  // the exact value that used to print as "3/5".
  await prisma.partnerState.create({
    data: {
      partnerId,
      relationshipScore: 2,
      theNeedle: 'Some Risk',
      notes: 'Escalation over the codec drop.',
      source: 'testbot',
      timestamp: new Date(Date.now() - 14 * 24 * 3600 * 1000),
    },
  });
  const current = await prisma.partnerState.create({
    data: {
      partnerId,
      relationshipScore: 3,
      theNeedle: 'Some Risk',
      notes: 'Weekly cadence restored.',
      source: 'testbot',
      timestamp: new Date(),
    },
  });
  currentStateId = current.id;

  await summaries.createSummary('partner', partnerId, 'manual');
});

afterAll(async () => {
  await disconnectTestDb();
});

const promptText = () => generateStructuredSummary.mock.calls[0][0];
const relationshipLines = () =>
  promptText().split('\n').filter((l) => l.includes('relationship update'));

describe('the evidence handed to the model', () => {
  it('names the qualitative word', () => {
    const lines = relationshipLines();
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('relationship health is Steady');
    expect(lines[1]).toContain('relationship health is Strained');
  });

  it('carries no score, fraction or scale legend for the model to echo', () => {
    for (const line of relationshipLines()) {
      expect(line).not.toMatch(/\b\d\s*\/\s*5\b/);
      expect(line).not.toMatch(/1=critical/);
      expect(line).not.toMatch(/\bscore\b/i);
    }
  });

  it('still carries the note and the author — the words are the payload', () => {
    expect(relationshipLines()[0]).toContain('Weekly cadence restored.');
    expect(relationshipLines()[0]).toContain('by testbot');
  });

  it('forbids the numeral in the partner prompt too, so a regeneration cannot reintroduce it', () => {
    expect(promptText()).toContain('Relationship health is a WORD, never a number');
  });
});

describe('the citation under the bullet', () => {
  it('opens the popover AT the update it cites, not the bare partner page', async () => {
    const view = await summaries.getSummary('partner', partnerId);
    const hrefs = (view!.body.sections ?? []).flatMap((s) =>
      (s.bullets ?? []).flatMap((b) => (b.citations ?? []).map((c) => c.href)),
    );
    expect(hrefs).toEqual([`/partners/${partnerId}#relationship-update-${currentStateId}`]);
    // The superseded fragment-less href is gone, not sitting beside the new one.
    expect(hrefs).not.toContain(`/partners/${partnerId}`);
  });
});
