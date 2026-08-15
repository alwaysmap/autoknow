import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// #167 acceptance 5, the one that has to be a browser test: the COUNT the Critical
// Chain's owner-load bullet states and the ROWS behind the link it offers must be the
// same answer. The bullet used to enumerate its evidence inline — program links followed
// by every phase name inside them as uncapped plain text — so with a busy owner it
// printed thirteen unclickable phase names in one sentence. It now prints one link, and
// that link only works if `?filter=active` shows exactly what was counted.
//
// The owner here is active in THREE other programs, plus this one, which they own with
// nothing running — so the "elsewhere" the sentence claims and the rows the link lands
// on can be compared exactly rather than approximately.

test.describe('the owner-load bullet links to the work it counted', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;
  let personId: number;
  const elsewhere = ['Nova Compact AAOS', 'Stellantis STLA GAS', 'Meridian Van GBI'];

  test.beforeAll(async () => {
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Rivian',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    const person = await prisma.person.create({
      data: { name: 'Priya Sharma', email: 'priya@example.com', currentPartnerId: partner.id },
    });
    personId = person.id;

    // The program being READ: owned by Priya, with a phase nobody has started. It is
    // therefore NOT part of her active work, which is what lets the assertion below be
    // an equality instead of a superset check.
    const home = await prisma.project.create({
      data: {
        name: 'R2 Platform', partnerId: partner.id, ownerPersonId: person.id,
        theNeedle: 'On Track', hillChartProgress: 10, volumeFirstYear: 60000,
        sopDate: new Date(Date.now() + 730 * 86_400_000),
      },
    });
    projectId = home.id;
    await prisma.phase.create({
      data: { name: 'Kickoff', projectId: home.id, forecastedDuration: 40 },
    });

    // Three other programs she leads, each with one phase actually running.
    for (const name of elsewhere) {
      const other = await prisma.project.create({
        data: {
          name, partnerId: partner.id, ownerPersonId: person.id,
          theNeedle: 'On Track', hillChartProgress: 40,
          sopDate: new Date(Date.now() + 365 * 86_400_000),
        },
      });
      const phase = await prisma.phase.create({
        data: { name: `${name} integration`, projectId: other.id, forecastedDuration: 30 },
      });
      await prisma.phaseState.create({
        data: { phaseId: phase.id, status: 'In Progress', theNeedle: 'On Track', hillChartProgress: 45, source: 'testbot' },
      });
    }
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('three other programs collapse to ONE link, not an enumeration', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    const bullet = page.getByTestId('chain-ledger').locator('li', { hasText: 'Priya Sharma' });
    await expect(bullet).toContainText('3 active phases');

    const link = bullet.getByRole('link', { name: '3 other programs' });
    await expect(link).toHaveAttribute('href', `/people/${personId}?filter=active#programs`);

    // The evidence is BEHIND the link now: no phase name from another program is
    // printed into this sentence. This is the assertion the issue is really about —
    // "no cap and no truncation" was the defect, so a cap is not the fix, absence is.
    for (const name of elsewhere) {
      await expect(bullet).not.toContainText(`${name} integration`);
    }
  });

  test('the link lands on exactly the programs the sentence counted', async ({ page }) => {
    await page.goto(`/people/${personId}?filter=active#programs`);

    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(elsewhere.length);
    for (const name of elsewhere) {
      await expect(rows.filter({ hasText: name })).toHaveCount(1);
    }
    // The program she owns with nothing running is attached but not active — it is the
    // row the filter is FOR, and seeing it here would mean the two surfaces are answering
    // different questions.
    await expect(rows.filter({ hasText: 'R2 Platform' })).toHaveCount(0);
  });
});
