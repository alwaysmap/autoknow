import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { resolveTokens } from './helpers/tokens';

// autoknow-bdw asked whether the program header's "est." date takes an alarm colour from
// something other than whether the estimate is actually late. On the seed it does not —
// probed live, Honda Accord (five months early) renders muted while Polaris EV (22 days
// late) renders warn — and `sopForecastTone` has had one caller since the ADR converged
// the header onto it. But NOTHING pinned the WIRING: `tests/sopForecastTone.test.ts`
// proves the rule and stops at the function, so the header could have gone on painting
// from a constant, a path, or a stale prop and every test would still be green. That gap
// is what made the report unfalsifiable from the code alone.
//
// So: two programs differing ONLY in the direction of their buffer, read out of a real
// page. The ink is asserted against the tokens THIS page resolves rather than against
// written-down colours — a literal ink measured against a literal ground agrees with
// itself (docs/knowledge/a-literal-ink-over-a-literal-ground-measures-fine.md) — and
// `data-tone` carries the reading, so a failure says which half broke: the decision, or
// the paint.
test.describe('the est. date takes its ink from the data (AGENTS lesson 18)', () => {
  test.describe.configure({ mode: 'serial' });

  const DAY = 86_400_000;
  let earlyId: number;
  let lateId: number;

  test.beforeAll(async () => {
    await wipeAll();
    const partner = await prisma.partner.create({
      data: {
        name: 'Rivian',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });

    // One phase each, identical in every respect except the SOP it is measured against:
    // a 30-day phase started today finishes ~30 days out either way. The EARLY program
    // puts its SOP a year past that (buffer far above any reserve), the LATE one puts it
    // in the past week (the estimate already overshoots it). Same chain, same clock —
    // only the target moves, so nothing but the buffer's sign can explain a difference
    // in ink.
    const build = async (name: string, sopOffsetDays: number) => {
      const project = await prisma.project.create({
        data: {
          name,
          partnerId: partner.id,
          ownerName: 'dylan',
          theNeedle: 'On Track',
          volumeFirstYear: 60000,
          sopDate: new Date(Date.now() + sopOffsetDays * DAY),
        },
      });
      const phase = await prisma.phase.create({
        data: { name: 'Integration', projectId: project.id, forecastedDuration: 30, startedAt: new Date() },
      });
      await prisma.phaseState.create({
        data: { phaseId: phase.id, status: 'In Progress', theNeedle: 'On Track', hillChartProgress: 10, source: 'testbot' },
      });
      return project.id;
    };

    earlyId = await build('Comfortably Early Program', 395);
    lateId = await build('Already Overshot Program', -5);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('an early program reads muted and a late one reads alarmed, in that direction', async ({ page }) => {
    const inkOf = async (projectId: number) => {
      await page.goto(`/programs/${projectId}`);
      const el = page.getByTestId('sop-forecast');
      await expect(el).toBeVisible();
      return {
        tone: await el.getAttribute('data-tone'),
        color: await el.evaluate((n) => getComputedStyle(n).color),
        text: (await el.innerText()).trim(),
      };
    };
    const early = await inkOf(earlyId);
    // The tokens as THIS page resolves them, so the comparison is against the design
    // system rather than against three colours copied into a test (helpers/tokens).
    const tokens = await resolveTokens(page, ['--muted', '--warn', '--bad']);
    expect(new Set(Object.values(tokens)).size).toBe(3); // the three must be distinguishable
    const late = await inkOf(lateId);

    // Both render the line at all — "shown ALWAYS when there is a forecast" is the rule
    // the header states, so an absent line would be a different bug wearing this one's
    // clothes.
    expect(early.text).toMatch(/^est\./);
    expect(late.text).toMatch(/^est\./);

    expect(early.tone).toBe('onTrack');
    expect(early.color).toBe(tokens['--muted']);

    // The SOP is already behind us and the estimate misses it: "blown", the loudest of
    // the three. Asserted as the token, not merely as "different from early" — a wiring
    // that painted every program `--bad` would pass that weaker test.
    expect(late.tone).toBe('blown');
    expect(late.color).toBe(tokens['--bad']);
  });
});
