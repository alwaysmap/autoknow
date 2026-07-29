import { test, expect, openCard, type Page } from './helpers/e2e';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Not an assertion suite — this captures screenshots of the phase UI surfaces
// (PhaseTrack rail + details, the /templates authoring page, and the Critical Chain
// instrument) into ./screenshots so the current state can be eyeballed. Reuses the
// deterministic seedProgram fixture.

test.describe('Phase UI screenshots', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  const row = (page: Page, name: string) =>
    page.getByTestId('phase-row').filter({ has: page.locator(`a:text-is("${name}")`) });

  test('phase rail', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await page.getByTestId('phase-row').first().waitFor();
    await page.screenshot({ path: 'screenshots/01-phase-rail.png', fullPage: true });
  });

  test('phase details', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    // hydration-resilient open (see phase_graph.spec.ts)
    await expect(async () => {
      if (!(await page.getByTestId('phase-details').isVisible())) {
        // MIN is one line, so the card opens before the zoom button exists.
        const zoom = row(page, 'Integration').getByRole('link', { name: 'Details' });
        if (!(await zoom.isVisible())) await row(page, 'Integration').locator('a[data-card-title]').click();
        await zoom.click({ timeout: 2000 });
      }
      await expect(page.getByTestId('phase-details')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await page.screenshot({ path: 'screenshots/02-phase-details.png', fullPage: true });
  });

  test('templates list', async ({ page }) => {
    await page.goto('/templates');
    await page.getByTestId('template-row').first().waitFor();
    await page.screenshot({ path: 'screenshots/03-templates-list.png', fullPage: true });
  });

  test('template editor', async ({ page }) => {
    await page.goto('/templates');
    await page.getByTestId('template-row').filter({ hasText: 'Digital Key' }).first()
      .getByRole('button', { name: 'Clone' }).click();
    await page.waitForURL(/\/templates\/\d+\/edit/);
    await page.getByTestId('phase-card').first().waitFor();
    await page.screenshot({ path: 'screenshots/04-template-editor.png', fullPage: true });
  });
});

// The STANDARD card's anatomy (autoknow-crw.2): Goal & DoD left, the latest update
// right, the involvement metadata pinned to the foot. Its own describe because it
// needs content the base fixture deliberately keeps short — a goal long enough to
// out-run the update column, and a note long enough that the old two-line clamp would
// have hidden most of it. Four things are being signed off from these images rather
// than from element counts (AGENTS lesson 18): the three regions, the empty-goal
// doorway, the rail's stations still landing on the cards they belong to now that one
// row is six times taller than its neighbours, and the MIN card staying one line while
// another phase is focused.
test.describe('Phase card anatomy screenshots', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  const LONG_GOAL = [
    '**Goal:** Every catalogued vehicle signal reaches Android with the units, ranges',
    'and update rates the signal catalog declares, and the certification evidence',
    'package is accepted by the OEM without a waiver.',
    '',
    '**Done when:**',
    '',
    '- every catalogued signal (speed, gear, HVAC, seat, door, tyre pressure) reads on the bench rig',
    '- units and ranges match the catalog, verified against a recorded drive trace',
    '- the property permission map is reviewed and signed off by the OEM security team',
    '- no VHAL property returns STATUS_UNAVAILABLE outside a documented degraded mode',
    '- the evidence package is filed and the OEM has accepted it',
  ].join('\n');

  const LONG_NOTE = [
    'Codec drops are still blocking the DSP path, and the recovery plan slipped a week',
    'when the supplier pulled two engineers onto a different program.',
    'The bench rig now reproduces the fault in about one run in five, which is enough to',
    'bisect against, so the next step is a bisect over the last fourteen firmware drops.',
    'Nothing downstream has moved yet; certification is still holding its dates.',
  ].join(' ');

  test.beforeAll(async () => {
    seeded = await seedProgram();
    // A goal that runs well past the update beside it, so the pinned metadata row is
    // proved to sit under BOTH columns rather than under the taller one.
    await prisma.phase.update({
      where: { id: seeded.phases.certification },
      data: { description: LONG_GOAL, googleFocus: 'Signal-catalog conformance and the GAS evidence package.' },
    });
    // A note the retired two-line clamp would have cut in half. `Audio` keeps its empty
    // description, so this one card carries the long-update case AND the empty-goal
    // doorway at once.
    await prisma.phaseState.updateMany({
      where: { phaseId: seeded.phases.audio },
      data: { notes: LONG_NOTE },
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  const row = (page: Page, name: string) =>
    page.getByTestId('phase-row').filter({ has: page.locator(`a:text-is("${name}")`) });

  /**
   * Every image this describe writes, with its filename spelled out. A literal `file`
   * rather than one computed from the loop index: a derived name has to be evaluated
   * before you know which picture you are looking at, and inserting a case in the
   * middle silently renumbers everything after it.
   *
   * `Integration` is the fixture's constraint and the only phase carrying a partner
   * and a person, so it is the one card that shows all three regions plus the evidence
   * line at once. `Certification` carries the long goal, `Audio` the empty goal beside
   * the long update. The widths are design.md §9's compliance set: 960px collapses the
   * two reading columns into one stack, so 1024 is the narrowest two-column case and
   * 768/360 are the stacked ones.
   */
  const CASES: { file: string; phase: string; width: number; dark?: boolean }[] = [
    { file: '05-phase-card-long-goal-light.png', phase: 'Certification', width: 1440 },
    { file: '06-phase-card-long-goal-dark.png', phase: 'Certification', width: 1440, dark: true },
    { file: '07-phase-card-no-goal-long-note-light.png', phase: 'Audio', width: 1440 },
    { file: '08-phase-card-no-goal-long-note-dark.png', phase: 'Audio', width: 1440, dark: true },
    { file: '09-phase-card-all-regions-light.png', phase: 'Integration', width: 1440 },
    { file: '10-phase-card-all-regions-dark.png', phase: 'Integration', width: 1440, dark: true },
    { file: '11-phase-card-1024.png', phase: 'Certification', width: 1024 },
    { file: '12-phase-card-768.png', phase: 'Certification', width: 768 },
    { file: '13-phase-card-360.png', phase: 'Certification', width: 360 },
  ];

  for (const c of CASES) {
    test(c.file.replace(/^\d+-|\.png$/g, ''), async ({ page }) => {
      if (c.dark) await page.addInitScript(() => localStorage.setItem('autoknow-theme', 'dark'));
      await page.setViewportSize({ width: c.width, height: 1200 });
      await page.goto(`/programs/${seeded.projectId}`);
      // The hydration-guarded first interaction (AGENTS lesson 8): an unguarded first
      // click after a page load is this suite's top flake source. `openCard` is a
      // no-op once the card is open, so retrying it cannot toggle the card shut.
      await expect(async () => {
        await openCard(row(page, c.phase));
        await expect(row(page, c.phase).getByRole('link', { name: 'Details' }))
          .toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 20000 });
      await page.screenshot({ path: `screenshots/${c.file}`, fullPage: true });
    });
  }
});

// The Critical Chain instrument after #161 step 3/4: the phase × week state grid is gone
// and each phase's variance rides ITS OWN bar as a length. These images are the acceptance
// evidence for that swap and for #75's close-out (bead autoknow-c3z) — AGENTS lesson 18:
// counting elements proves a mark exists, only a screenshot proves it is visible, and the
// ink here is deliberately faint (a .42-opacity done bar, a dashed --ok ghost) in two
// themes. The KEY is captured too, because this step rewrote both its copy and its glyphs.
test.describe('Critical Chain screenshots', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  const DAY = 86_400_000;
  const ago = (d: number) => new Date(Date.now() - d * DAY);

  test.beforeAll(async () => {
    seeded = await seedProgram();

    // A chain that draws EVERY Option A mark at once, which the base fixture does not:
    // it carries no real start/completion dates, so every variance is zero and no row
    // grows a tail. Dates are relative to now, because `now` is the server's clock.
    //
    //   Kickoff     15d est, ran 10  → −5d handed back  (dashed --ok ghost)
    //   Bring-up    20d est, ran 27  → +7d already lost (solid --bad tail)
    //   Integration 40d est, 45 elapsed at 70% → forecast over (dashed --bad outline)
    //   Certification                → not started      (dashed --muted outline)
    // plus two idle handoffs (5d and 8d) in the channels above Bring-up and Integration.
    const kickoff = await prisma.phase.create({
      data: { name: 'Kickoff', projectId: seeded.projectId, forecastedDuration: 15, startedAt: ago(95) },
    });
    await prisma.phaseState.create({
      data: {
        phaseId: kickoff.id, status: 'Done', theNeedle: 'On Track',
        hillChartProgress: 100, source: 'testbot', timestamp: ago(85),
      },
    });
    await prisma.phaseDependency.create({
      data: { phaseId: seeded.phases.bringUp, dependsOnPhaseId: kickoff.id },
    });

    await prisma.phase.update({ where: { id: seeded.phases.bringUp }, data: { startedAt: ago(80) } });
    await prisma.phaseState.updateMany({ where: { phaseId: seeded.phases.bringUp }, data: { timestamp: ago(53) } });

    await prisma.phase.update({ where: { id: seeded.phases.integration }, data: { startedAt: ago(45) } });
    await prisma.phaseState.updateMany({
      where: { phaseId: seeded.phases.integration },
      data: { hillChartProgress: 70, timestamp: ago(45) },
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  /** The widths design.md §9 asks a layout to comply at: both themes at the widest — the
   *  pair the faint marks have to survive — and light-only below that, where what is being
   *  looked at is the SVG scaling to a narrower column rather than the palette. */
  const CASES: { file: string; width: number; dark?: boolean; key?: boolean }[] = [
    { file: '14-critical-chain-bars-light.png', width: 1440 },
    { file: '15-critical-chain-bars-dark.png', width: 1440, dark: true },
    { file: '16-critical-chain-bars-1024.png', width: 1024 },
    { file: '17-critical-chain-bars-768.png', width: 768 },
    { file: '18-critical-chain-bars-360.png', width: 360 },
    { file: '19-critical-chain-key-light.png', width: 1440, key: true },
    { file: '20-critical-chain-key-dark.png', width: 1440, dark: true, key: true },
  ];

  for (const c of CASES) {
    test(c.file.replace(/^\d+-|\.png$/g, ''), async ({ page }) => {
      if (c.dark) await page.addInitScript(() => localStorage.setItem('autoknow-theme', 'dark'));
      await page.setViewportSize({ width: c.width, height: 1200 });
      await page.goto(`/programs/${seeded.projectId}#critical-chain`);
      const section = page.getByTestId('chain-ledger');
      await expect(section.locator('[class*="scheduleSvg"]')).toBeVisible();
      if (c.key) {
        // The hydration-guarded first interaction (AGENTS lesson 8) — an unguarded first
        // click after a page load is this suite's top flake source. Opening an already-open
        // dialog is a no-op, so a retry cannot toggle it shut.
        await expect(async () => {
          await section.getByRole('button', { name: 'How to read the schedule' }).click({ timeout: 2000 });
          await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1500 });
        }).toPass({ timeout: 20000 });
        await page.screenshot({ path: `screenshots/${c.file}` });
        return;
      }
      await section.screenshot({ path: `screenshots/${c.file}` });
    });
  }
});
