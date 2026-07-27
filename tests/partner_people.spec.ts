import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// The partner page's People table (#127 E12, spec #124 §7 "Partner People list").
//
// The fixture is one partner with all three of #124 §4's buckets AT ONCE, because that is
// the only arrangement in which a bucket can steal a row from its neighbour — and because
// the defect this replaced could not express two of them at all: the old list asked
// `where: { endDate: null }`, which showed a future hire as a current employee and could
// never show a leaver. Both are asserted, not just the fixed one.
//
// Dates are relative to the run so the fixture cannot age into meaning something else
// (docs/knowledge/a-literal-future-date-in-a-fixture-expires.md): "incoming" has to be
// genuinely ahead of whatever day the suite runs on.

const DAY = 86_400_000;
const daysOut = (n: number) => new Date(Date.now() + n * DAY);

test.describe('Partner people: current / past / incoming', () => {
  test.describe.configure({ mode: 'serial' });

  let partnerId: number;

  test.beforeAll(async () => {
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Hitachi Astemo',
        type: { connectOrCreate: { where: { name: 'Supplier' }, create: { name: 'Supplier' } } },
        region: { connectOrCreate: { where: { name: 'APAC' }, create: { name: 'APAC' } } },
      },
    });
    partnerId = partner.id;

    const person = async (name: string, email: string) =>
      (await prisma.person.create({ data: { name, email, currentPartnerId: partner.id } })).id;
    const period = (personId: number, role: string, start: Date, end: Date | null) =>
      prisma.personAffiliation.create({
        data: { personId, partnerId: partner.id, role, startDate: start, endDate: end },
      });

    await period(await person('Rina Sitting', 'rina@example.com'), 'Cockpit Lead', daysOut(-400), null);
    await period(await person('Otto Departed', 'otto@example.com'), 'Firmware Engineer', daysOut(-900), daysOut(-200));
    await period(await person('Ines Arriving', 'ines@example.com'), 'Validation Lead', daysOut(60), null);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('defaults to who works here, and the other two buckets are one funnel away', async ({ page }) => {
    await page.goto(`/partners/${partnerId}`);

    const table = page.locator('table');
    await expect(table).toContainText('Rina Sitting');
    // The whole point: a hire whose period starts in 60 days is NOT a current employee,
    // and a leaver is not simply absent from the record.
    await expect(table).not.toContainText('Ines Arriving');
    await expect(table).not.toContainText('Otto Departed');
    // Bucket (a) has exactly one member, and the footer counts the same rows the table
    // draws — the page's employee figure is the same `current` array.
    await expect(page.locator('body')).toContainText('Showing 1-1 of 1 results');

    // First interaction after load is hydration-guarded: an unguarded first click fires
    // before React binds onClick and is this suite's top flake source (AGENTS lesson 8).
    await expect(async () => {
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect(table).toContainText('Ines Arriving', { timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // Unfiltered, all three read down one column, each with the date its bucket is
    // defined by — the leaver's `until`, the arrival's `from`.
    await expect(table).toContainText('Otto Departed');
    // Case-insensitive: `ClassBox` upper-cases its label in CSS, so the text the browser
    // reports is not the text the catalog holds.
    await expect(table).toContainText(/current/i);
    await expect(table).toContainText(/past/i);
    await expect(table).toContainText(/incoming/i);
    const arriving = page.locator('tr').filter({ hasText: 'Ines Arriving' });
    await expect(arriving.locator('time')).toHaveCount(1); // a from date, and no leaving date
  });

  test('a status is a CLASS: clicking one filters its own column and never navigates', async ({ page }) => {
    await page.goto(`/partners/${partnerId}`);

    await expect(async () => {
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect(page.locator('table')).toContainText('Otto Departed', { timeout: 1500 });
    }).toPass({ timeout: 20000 });

    await page.getByRole('button', { name: 'Past' }).click();
    await expect(page.locator('table')).toContainText('Otto Departed');
    await expect(page.locator('table')).not.toContainText('Rina Sitting');
    // design.md §6: a class filters, it does not navigate.
    await expect(page).toHaveURL(new RegExp(`/partners/${partnerId}$`));
  });
});
