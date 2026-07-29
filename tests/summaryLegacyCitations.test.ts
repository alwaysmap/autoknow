/** @jest-environment node */
// Briefs are stored append-only with their citation hrefs baked in, and are only
// regenerated once their scope goes stale — which can be never. So a phase citation on
// disk may carry EITHER retired shape: `/history/phase/:id` (the standalone page,
// retired 2026-07-21) or `/programs/:id#phase-:id-detail` (the focused popover, retired
// by autoknow-crw.4). getSummary rewrites both on read, onto the phase's CARD, which is
// its home now. Both hop straight there rather than one hopping to the other — a chain
// would grow a link every time this surface moves.
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
  it('rewrites a retired phase-history PAGE href onto the phase card', () => {
    const out = summaries.rewriteLegacyPhaseCitations(
      bodyCiting('/history/phase/7') as never,
      new Map([[7, 3]]),
    );
    expect(hrefsOf(out)).toEqual(['/programs/3#phase-7']);
  });

  it('rewrites a retired POPOVER href onto the phase card, in one hop', () => {
    const out = summaries.rewriteLegacyPhaseCitations(
      bodyCiting('/programs/3#phase-7-detail') as never,
      new Map([[7, 3]]),
    );
    expect(hrefsOf(out)).toEqual(['/programs/3#phase-7']);
  });

  it('takes the project id from the MAP, not from the stale href that carries one', () => {
    // The popover shape embeds a program id, and a phase can be re-homed. Resolving it
    // from the phase → program map is what keeps a moved phase's receipt correct.
    const out = summaries.rewriteLegacyPhaseCitations(
      bodyCiting('/programs/3#phase-7-detail') as never,
      new Map([[7, 42]]),
    );
    expect(hrefsOf(out)).toEqual(['/programs/42#phase-7']);
  });

  it('leaves every other href untouched', () => {
    for (const href of [
      '/programs/3#status-history', '/programs/3', 'https://docs.example/x', '/history/phase/abc',
      '/programs/3#phase-7',           // already canonical — rewriting it again is a no-op
      '/programs/3#phase-7-progress',  // the log's own address, not a retired shape
    ]) {
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
    const modern = bodyCiting('/programs/3#phase-7') as never;
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
      `/programs/${seeded.projectId}#phase-${seeded.phases.integration}`,
    ]);
  });
});
