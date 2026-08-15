import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// #140. "Possible Resource Constraints" surfaced the right SUBJECT — the people and
// partners several programs lean on — and then could not support a resourcing decision:
// its intro claimed "one calendar driving many SOPs" over a row shape carrying no time
// data at all, so two programs wanting Priya in Q1 '27 and Q4 '28 rendered identically to
// two that both wanted her next month.
//
// The computation is pinned in tests/chainLedger.test.ts and the rendering in
// tests/ecosystemUrgency.test.tsx. What this adds is the wiring: the demand windows have
// to survive the whole path — Phase rows → the chain schedule → chainLedgerData →
// buildBusiestResources → the page — and a jsdom fixture cannot prove that.

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const ahead = (d: number) => new Date(Date.now() + d * DAY);

test.describe('Possible Resource Constraints computes the collision', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Rivian',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    const priya = await prisma.person.create({
      data: { name: 'Priya Sharma', email: 'priya@example.com', currentPartnerId: partner.id },
    });

    const activePhase = async (projectId: number, name: string, duration: number, startedDaysAgo: number) => {
      const phase = await prisma.phase.create({
        data: { name, projectId, forecastedDuration: duration, startedAt: ago(startedDaysAgo) },
      });
      await prisma.phaseState.create({
        data: { phaseId: phase.id, status: 'In Progress', theNeedle: 'On Track', hillChartProgress: 40, timestamp: ago(startedDaysAgo), source: 'testbot' },
      });
      return phase;
    };

    // GATED PROGRAM: Priya is on its live constraint. Its SOP is close, so its buffer is
    // thin — this is the program the section is worried about.
    const gated = await prisma.project.create({
      data: {
        name: 'Meridian Van GAS', partnerId: partner.id, theNeedle: 'Some Risk',
        hillChartProgress: 40, volumeFirstYear: 120000, sopDate: ahead(60),
      },
    });
    const integration = await activePhase(gated.id, 'Integration', 60, 30);
    await prisma.phasePerson.create({ data: { phaseId: integration.id, personId: priya.id, role: 'TEL' } });

    // SLACK PROGRAM: a long runway, and Priya is on its SECOND chain phase rather than
    // its constraint — which is what makes her time there "movable" and produces the
    // recommendation. Her window here starts when Kickoff hands over, so it overlaps
    // Integration's tail rather than sitting beside it.
    const slack = await prisma.project.create({
      data: {
        name: 'Nova Compact AAOS', partnerId: partner.id, theNeedle: 'On Track',
        hillChartProgress: 20, volumeFirstYear: 40000, sopDate: ahead(400),
      },
    });
    const kickoff = await activePhase(slack.id, 'Kickoff', 20, 10);
    const ship = await prisma.phase.create({
      data: { name: 'Ship readiness', projectId: slack.id, forecastedDuration: 60 },
    });
    await prisma.phaseDependency.create({ data: { phaseId: ship.id, dependsOnPhaseId: kickoff.id } });
    await prisma.phasePerson.create({ data: { phaseId: ship.id, personId: priya.id, role: 'FAE' } });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('states concurrency as a number and shows the window the demands collide in', async ({ page }) => {
    await page.goto('/ecosystem');
    const section = page.getByTestId('busiest-resources');
    await expect(section).toBeVisible();

    const row = section.locator('tr', { hasText: 'Priya Sharma' }).first();
    // The single most decision-relevant fact on the row, which used to exist only as a
    // count of links the reader performed by eye.
    await expect(row).toContainText('at once — one calendar');
    // …and WHEN, computed from the chain schedule rather than asserted by the intro.
    // Two real dates, each carrying its ISO machine form.
    await expect(row.locator('time')).toHaveCount(2);
    for (const t of await row.locator('time').all()) {
      await expect(t).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}/);
    }

    // A person and a company are counted against different thresholds, and the kind is
    // now a filterable class rather than a difference visible only in the wording.
    await expect(row.getByText('Person')).toBeVisible();
  });

  test('the advice asks rather than concludes, and says where the numbers come from', async ({ page }) => {
    await page.goto('/ecosystem');
    const section = page.getByTestId('busiest-resources');

    // The buffer figures inside it are typed-in estimates compounded through the chain.
    // The wording used to state a heuristic as a finding.
    await expect(section).toContainText('Worth asking');
    await expect(section).not.toContainText('at the least cost');

    // The basis is declared ONCE, structurally, instead of hedging every sentence.
    await section.getByRole('button', { name: /About Possible Resource Constraints/i }).click();
    await expect(page.locator('body')).toContainText('Nothing here models capacity');
  });
});
