import { test, expect } from '@playwright/test';
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

  test('the header states the overrun and demands it first', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    const flag = page.getByTestId('program-focus');
    await expect(flag).toBeVisible();
    await expect(flag).toContainText('100%');
    await expect(flag).toContainText('Exploit the constraint');
    // The phase mention is a link to its record, like every entity mention.
    await expect(flag.getByRole('link', { name: 'VHAL Integration' })).toHaveAttribute(
      'href', new RegExp(`/programs/${projectId}#phase-\\d+-detail$`),
    );

    // PROGRAM level means above the Critical chain section, not inside it — the
    // reader meets the fact before the needle, the briefing and every chart.
    const flagBox = await flag.boundingBox();
    const chainBox = await page.locator('h2#critical-chain').boundingBox();
    expect(flagBox && chainBox).toBeTruthy();
    expect(flagBox!.y).toBeLessThan(chainBox!.y);
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
