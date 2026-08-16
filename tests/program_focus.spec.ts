import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// A phase far enough past its OWN estimate is the program's constraint TODAY, and
// the SOP buffer cannot vouch for it — a buffer only says the damage hasn't reached
// the SOP yet. This program is deliberately buffer-RICH (SOP two years out) and
// still has a phase at double its estimate: before this, the page led with
// "Nothing needs to change today" and reported the overrun only as history in
// "Where the buffer went".

test.describe('a phase past its estimate is flagged at program level', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;

  test.beforeAll(async () => {
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Rivian',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    const project = await prisma.project.create({
      data: {
        name: 'R2 VHAL Integration',
        partnerId: partner.id,
        ownerName: 'dylan',
        theNeedle: 'On Track',
        hillChartProgress: 50,
        volumeFirstYear: 60000,
        sopDate: new Date(Date.now() + 730 * 86_400_000), // two years out: buffer is huge
      },
    });
    projectId = project.id;

    // Started 60 days ago against a 40-day estimate, half done → 60 elapsed + 20
    // remaining = 80 against 40 planned: 40 days over, exactly +100%.
    const phase = await prisma.phase.create({
      data: {
        name: 'VHAL Integration',
        projectId: project.id,
        forecastedDuration: 40,
        startedAt: new Date(Date.now() - 60 * 86_400_000),
      },
    });
    await prisma.phaseState.create({
      data: { phaseId: phase.id, status: 'In Progress', theNeedle: 'On Track', hillChartProgress: 50, source: 'testbot' },
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('the header names the constraint phase and links to the steps, without restating them', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    const flag = page.getByTestId('program-focus');
    await expect(flag).toBeVisible();
    // The phase mention is a link to its record, like every entity mention.
    await expect(flag.getByRole('link', { name: 'VHAL Integration' })).toHaveAttribute(
      'href', new RegExp(`/programs/${projectId}#phase-\\d+$`),
    );

    // #167: the header says WHICH phase and stops. The percentage, the days of work
    // left and the "Exploit the constraint" reaction are the Next-steps bullet's, said
    // there more fully off the same sorted list — the terser copy above the fuller one
    // is what this issue deleted, so asserting its ABSENCE is the point of the test.
    await expect(flag).not.toContainText('100%');
    await expect(flag).not.toContainText('Exploit the constraint');

    // The property the retired banner existed for SURVIVES, by a link rather than a
    // restatement: the fact is met above the fold and reaching the recommendation is one
    // click, not a hunt. This is the rewrite of the old bounding-box assertion — the
    // requirement was never "a second sentence up here", it was "do not make the reader
    // scroll to find out".
    const seeSteps = flag.getByRole('link', { name: 'What to do about it →' });
    await expect(seeSteps).toHaveAttribute('href', '#critical-chain');

    const flagBox = await flag.boundingBox();
    const chainBox = await page.locator('h2#critical-chain').boundingBox();
    expect(flagBox && chainBox).toBeTruthy();
    expect(flagBox!.y).toBeLessThan(chainBox!.y);

    // …and the link actually lands on the section it names, rather than being a href
    // pointing at an id nothing renders.
    await seeSteps.click();
    await expect(page.locator('h2#critical-chain')).toBeInViewport();
  });

  test('the next steps lead with root-causing it, buffer notwithstanding', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    const ledger = page.getByTestId('chain-ledger');
    // A healthy buffer no longer buys "Nothing needs to change today".
    await expect(ledger.getByRole('heading', { name: 'Time to act, in order of least disruption' })).toBeVisible();

    const first = ledger.locator('li').first();
    await expect(first).toContainText('VHAL Integration');
    await expect(first).toContainText('100%');
    await expect(first).toContainText('40-day estimate');
    // Both halves of the recommendation: find the cause, or re-plan the estimate.
    await expect(first).toContainText('root-cause the overrun');
    await expect(first.getByRole('link', { name: 'Edit phases →' })).toHaveAttribute(
      'href', `/programs/${projectId}/phases`,
    );
  });
});
