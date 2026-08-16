import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// #174. The Critical Chain's left column rendered a heading — "Next step" — over an empty
// box, beside a column busy explaining that idle time is already costing the program a
// day. The heading and the list had two different sources of truth and nothing made them
// agree: the heading comes from `register` (buffer arithmetic alone), the list from five
// unrelated situation kinds, and both are easily true at once.
//
// The invariant is now `register !== 'none'` ⇒ at least one step. These are the two ends
// of it in a real browser: a program that used to render the empty column, and one whose
// heading is a complete sentence and correctly has no list at all.

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const ahead = (d: number) => new Date(Date.now() + d * DAY);

test.describe('the Next step column has a floor', () => {
  test.describe.configure({ mode: 'serial' });

  let idleId: number;
  let quietId: number;
  let startablePhaseId: number;

  test.beforeAll(async () => {
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Rivian',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });

    // PROGRAM 1 — the reported shape. The first phase finished exactly on plan 26 days
    // ago and nothing has started since, so the reserve moved without any phase
    // overrunning: register 'plan', and not one of the five step conditions fires.
    const idle = await prisma.project.create({
      data: {
        name: 'Idle Between Phases', partnerId: partner.id, theNeedle: 'On Track',
        hillChartProgress: 40, sopDate: ahead(64),
      },
    });
    idleId = idle.id;
    const done = await prisma.phase.create({
      data: { name: 'Production readiness', projectId: idle.id, forecastedDuration: 30, startedAt: ago(56) },
    });
    for (const [d, p] of [[56, 10], [41, 50], [26, 100]] as const) {
      await prisma.phaseState.create({
        data: { phaseId: done.id, status: 'x', theNeedle: 'On Track', hillChartProgress: p, timestamp: ago(d), source: 'testbot' },
      });
    }
    const startable = await prisma.phase.create({
      data: { name: 'App platform & Google services', projectId: idle.id, forecastedDuration: 30 },
    });
    startablePhaseId = startable.id;
    await prisma.phaseDependency.create({ data: { phaseId: startable.id, dependsOnPhaseId: done.id } });

    // PROGRAM 2 — the register that is CORRECTLY listless. "Nothing needs to change
    // today" is a complete sentence and needs no bullet under it; the floor must not
    // invent one, or it stops being a floor and becomes noise on every healthy program.
    const quiet = await prisma.project.create({
      data: {
        name: 'Comfortably On Plan', partnerId: partner.id, theNeedle: 'On Track',
        hillChartProgress: 50, sopDate: ahead(100),
      },
    });
    quietId = quiet.id;
    const first = await prisma.phase.create({
      data: { name: 'Kickoff', projectId: quiet.id, forecastedDuration: 30, startedAt: ago(40) },
    });
    await prisma.phaseState.create({
      data: { phaseId: first.id, status: 'x', theNeedle: 'On Track', hillChartProgress: 100, timestamp: ago(10), source: 'testbot' },
    });
    const running = await prisma.phase.create({
      data: { name: 'Bring-up', projectId: quiet.id, forecastedDuration: 40, startedAt: ago(10) },
    });
    await prisma.phaseState.create({
      data: { phaseId: running.id, status: 'x', theNeedle: 'On Track', hillChartProgress: 50, timestamp: ago(10), source: 'testbot' },
    });
    await prisma.phaseDependency.create({ data: { phaseId: running.id, dependsOnPhaseId: first.id } });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('"Next step" names the phase that could start, and what the waiting has cost', async ({ page }) => {
    await page.goto(`/programs/${idleId}`);

    const ledger = page.getByTestId('chain-ledger');
    await expect(ledger.getByRole('heading', { name: 'Next step' })).toBeVisible();

    // The heading is no longer a promise with nothing behind it.
    const steps = ledger.locator('ul li');
    await expect(steps).toHaveCount(1);
    await expect(steps.first()).toContainText('nothing is running');
    // The idle count is read from the waterfall row the RIGHT-hand column is printing,
    // not derived a second time — so the two columns state the same number.
    await expect(steps.first()).toContainText('has already cost 26 days');
    await expect(ledger).toContainText('Where the buffer went');

    // The phase name is a phaseBtn like every other phase mention in this component,
    // and it jumps to the rail row rather than being the one dead name on the page.
    await page.evaluate(() => {
      (window as Window & { __jumps?: number[] }).__jumps = [];
      window.addEventListener('autoknow:jump-phase', (e) => {
        (window as Window & { __jumps?: number[] }).__jumps!.push((e as CustomEvent<number>).detail);
      });
    });
    const phaseBtn = steps.first().getByRole('button', { name: 'App platform & Google services' });
    // Hydration-guarded first interaction (the suite's #1 flake source).
    await expect(async () => {
      await phaseBtn.click();
      expect(await page.evaluate(() => (window as Window & { __jumps?: number[] }).__jumps!.length)).toBeGreaterThan(0);
    }).toPass();
    expect(await page.evaluate(() => (window as Window & { __jumps?: number[] }).__jumps![0])).toBe(startablePhaseId);
  });

  test('a register that needs no list still gets none', async ({ page }) => {
    await page.goto(`/programs/${quietId}`);

    const ledger = page.getByTestId('chain-ledger');
    await expect(ledger.getByRole('heading', { name: 'Nothing needs to change today' })).toBeVisible();
    await expect(ledger.locator('ul li')).toHaveCount(0);
  });

  test('no program renders a step heading over an empty column', async ({ page }) => {
    // The invariant itself, read off the rendered page rather than the ledger: the two
    // headings that PROMISE an instruction must have one. This is the assertion that
    // would have failed before the floor existed.
    for (const id of [idleId, quietId]) {
      await page.goto(`/programs/${id}`);
      const ledger = page.getByTestId('chain-ledger');
      const heading = await ledger.locator('h3').first().innerText();
      const count = await ledger.locator('ul li').count();
      if (heading === 'Nothing needs to change today') expect(count).toBe(0);
      else expect(count).toBeGreaterThan(0);
    }
  });
});
