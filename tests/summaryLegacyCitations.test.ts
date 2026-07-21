/** @jest-environment node */
// Briefs are stored append-only with their citation hrefs baked in, so every brief
// written before /history/phase/:id was retired (2026-07-21) still cites a page that
// now 404s — and a brief is only regenerated once its scope goes stale, which can be
// never. getSummary therefore rewrites those citations on read, onto the DETAILS
// popover that replaced the page.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram, SeededProgram } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

let summaries: typeof import('../src/lib/summaries');
let seeded: SeededProgram;

beforeAll(async () => {
  summaries = await import('../src/lib/summaries');
  seeded = await seedProgram();
});

afterAll(async () => {
  await disconnectTestDb();
});

const bodyCiting = (href: string) => ({
  sections: [
    {
      key: 'risks',
      bullets: [{ text: 'Codec drops are blocking the DSP path.', citations: [{ label: 'Integration', href, external: false }] }],
    },
  ],
});

const hrefsOf = (body: { sections: { bullets: { citations: { href: string }[] }[] }[] }) =>
  body.sections.flatMap((s) => s.bullets.flatMap((b) => b.citations.map((c) => c.href)));

describe('rewriteLegacyPhaseCitations (pure)', () => {
  it('rewrites a retired phase-history href onto the program-page deep link', () => {
    const out = summaries.rewriteLegacyPhaseCitations(
      bodyCiting('/history/phase/7') as never,
      new Map([[7, 3]]),
    );
    expect(hrefsOf(out)).toEqual(['/programs/3#phase-7-detail']);
  });

  it('leaves every other href untouched', () => {
    for (const href of ['/programs/3#status-history', '/programs/3', 'https://docs.example/x', '/history/phase/abc']) {
      const out = summaries.rewriteLegacyPhaseCitations(bodyCiting(href) as never, new Map([[7, 3]]));
      expect(hrefsOf(out)).toEqual([href]);
    }
  });

  it('DROPS the citation when the phase no longer exists — a dead link is worse than one fewer receipt', () => {
    const out = summaries.rewriteLegacyPhaseCitations(bodyCiting('/history/phase/999') as never, new Map());
    expect(hrefsOf(out)).toEqual([]);
    // The bullet itself survives; only its receipt is gone.
    expect(out.sections[0].bullets[0].text).toContain('Codec drops');
  });

  it('collects the ids to resolve, deduplicated, and nothing for a modern brief', () => {
    const modern = bodyCiting('/programs/3#phase-7-detail') as never;
    expect(summaries.legacyPhaseCitationIds(modern)).toEqual([]);
    const legacy = {
      sections: [
        {
          key: 'risks',
          bullets: [
            { text: 'a', citations: [{ label: 'x', href: '/history/phase/7', external: false }] },
            { text: 'b', citations: [{ label: 'y', href: '/history/phase/7', external: false }] },
            { text: 'c', citations: [{ label: 'z', href: '/history/phase/9', external: false }] },
          ],
        },
      ],
    } as never;
    expect(summaries.legacyPhaseCitationIds(legacy)).toEqual([7, 9]);
  });
});

describe('getSummary', () => {
  it('serves a pre-retirement brief with its citations already migrated', async () => {
    await prisma.summary.create({
      data: {
        scope: 'program',
        targetId: seeded.projectId,
        trigger: 'manual',
        model: 'test-model',
        windowStart: new Date(Date.now() - 7 * 86_400_000),
        windowEnd: new Date(),
        tldr: 'Integration is the constraint.',
        body: bodyCiting(`/history/phase/${seeded.phases.integration}`),
        sourceCounts: { hill: 1 },
      },
    });

    const view = await summaries.getSummary('program', seeded.projectId);
    expect(hrefsOf(view!.body)).toEqual([
      `/programs/${seeded.projectId}#phase-${seeded.phases.integration}-detail`,
    ]);
  });
});
