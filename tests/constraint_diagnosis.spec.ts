import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// #148. The Flow Constraint Diagnosis named a phase and stopped: a reader who already
// knew from the needle that a program was at risk learned that a phase called
// "Integration" was on its chain, and still could not tell whether it was late, blocked,
// contended, or simply the longest step in a healthy plan.
//
// The portfolio needs BOTH states seeded or only half of them is ever seen — a panel that
// can only describe trouble makes every row it prints read as trouble, which is why
// "on the chain, nothing wrong" is a first-class answer rather than a dropped row.

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const ahead = (d: number) => new Date(Date.now() + d * DAY);

test.describe('the constraint panel says why, not just where', () => {
  test.describe.configure({ mode: 'serial' });

  let troubledId: number;
  let troubledPhaseId: number;

  test.beforeAll(async () => {
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Rivian',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });

    // OVER-RUNNING: started 60 days ago against a 40-day estimate, half done → 60
    // elapsed + 20 remaining = 80 against 40 planned, exactly +100%.
    const troubled = await prisma.project.create({
      data: {
        name: 'Meridian Van GAS', partnerId: partner.id, theNeedle: 'Some Risk',
        hillChartProgress: 50, volumeFirstYear: 40000, sopDate: ahead(700),
      },
    });
    troubledId = troubled.id;
    const integration = await prisma.phase.create({
      data: { name: 'Integration', projectId: troubled.id, forecastedDuration: 40, startedAt: ago(60) },
    });
    troubledPhaseId = integration.id;
    await prisma.phaseState.create({
      data: { phaseId: integration.id, status: 'In Progress', theNeedle: 'Some Risk', hillChartProgress: 50, timestamp: ago(60), source: 'testbot' },
    });

    // CLEAN: one finished phase on plan, one running on pace. Its constraint is a real
    // constraint — the longest remaining step — and there is nothing wrong with it.
    const clean = await prisma.project.create({
      data: {
        name: 'Nova Compact AAOS', partnerId: partner.id, theNeedle: 'On Track',
        hillChartProgress: 50, volumeFirstYear: 20000, sopDate: ahead(140),
      },
    });
    const kickoff = await prisma.phase.create({
      data: { name: 'Kickoff', projectId: clean.id, forecastedDuration: 30, startedAt: ago(40) },
    });
    await prisma.phaseState.create({
      data: { phaseId: kickoff.id, status: 'x', theNeedle: 'On Track', hillChartProgress: 100, timestamp: ago(10), source: 'testbot' },
    });
    const bringUp = await prisma.phase.create({
      data: { name: 'Bring-up', projectId: clean.id, forecastedDuration: 40, startedAt: ago(10) },
    });
    await prisma.phaseState.create({
      data: { phaseId: bringUp.id, status: 'In Progress', theNeedle: 'On Track', hillChartProgress: 50, timestamp: ago(10), source: 'testbot' },
    });
    await prisma.phaseDependency.create({ data: { phaseId: bringUp.id, dependsOnPhaseId: kickoff.id } });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('each named phase carries why it is the constraint, since when, and on what basis', async ({ page }) => {
    await page.goto('/ecosystem-summary');
    const panel = page.locator('section', { hasText: 'Flow Constraint Diagnosis' }).first();
    await expect(panel).toBeVisible();

    const troubled = panel.locator('tr', { hasText: 'Integration' });
    // WHY — the ledger's own diagnosis, which until now rendered on one screen only.
    await expect(troubled).toContainText('100% past the 40-day estimate');
    await expect(troubled).toContainText('20 days of work still left');
    await expect(troubled).toContainText('Meridian Van GAS');
    // …and on WHAT BASIS. `overPct` is a share of a typed-in forecastedDuration, so the
    // row says the number is against an estimate rather than printing it as a fact.
    await expect(troubled).toContainText('against a typed-in estimate');
    // The diagnosis links to the phase CARD in the program it is about — one click from
    // the evidence, rather than a dead sentence.
    await expect(troubled.getByRole('link', { name: /100% past/ })).toHaveAttribute(
      'href', `/programs/${troubledId}#phase-${troubledPhaseId}`,
    );

    // SINCE WHEN, as a real date read down the column.
    const since = troubled.locator('time');
    await expect(since).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}/);
  });

  test('a phase that is simply the longest step says so, rather than being dropped', async ({ page }) => {
    await page.goto('/ecosystem-summary');
    const panel = page.locator('section', { hasText: 'Flow Constraint Diagnosis' }).first();

    const clean = panel.locator('tr', { hasText: 'Bring-up' });
    await expect(clean).toContainText('with nothing wrong');
    await expect(clean).toContainText('Nova Compact AAOS');
    // A clean row's basis is the honest other half of the pair: nothing here is being
    // compared against a guess.
    await expect(clean).toContainText('measured from recorded dates');
  });

  test('the worst row leads, and the method is stated once rather than hedged per row', async ({ page }) => {
    await page.goto('/ecosystem-summary');
    const panel = page.locator('section', { hasText: 'Flow Constraint Diagnosis' }).first();

    // Severity leads the ordering now. Under the old count-only order these two both gate
    // one program, so the one that is 100% over could sort below the one that is fine.
    const names = await panel.locator('tbody th').allInnerTexts();
    expect(names.indexOf('Integration')).toBeLessThan(names.indexOf('Bring-up'));

    // The basis vocabulary is explained ONCE, in the section's ⓘ — the alternative is a
    // disclaimer per sentence, which drowns the sentences.
    await panel.getByRole('button', { name: /About Flow Constraint Diagnosis/i }).click();
    await expect(page.locator('body')).toContainText('compared against a duration somebody typed in');
  });
});
