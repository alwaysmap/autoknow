import { test, expect, openCard, type Page } from './helpers/e2e';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Not an assertion suite — this captures screenshots of the phase UI surfaces
// (PhaseTrack rail + details, and the /templates authoring page) into ./screenshots
// so the current state can be eyeballed. Reuses the deterministic seedProgram fixture.

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
        const zoom = row(page, 'Integration').getByRole('button', { name: 'Details' });
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
        await expect(row(page, c.phase).getByRole('button', { name: 'Details' }))
          .toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 20000 });
      await page.screenshot({ path: `screenshots/${c.file}`, fullPage: true });
    });
  }
});
