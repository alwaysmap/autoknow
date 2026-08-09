import { test, expect, type Page } from './helpers/e2e';
import { prisma } from './helpers/db';
import { seedProgram } from './helpers/fixtures';

// autoknow-hcz.15: detail sections on program-shaped pages are collapsible, and the
// choice persists per browser via the COLLAPSED_SECTIONS preference (#31 registry).
// The three claims worth an e2e minute:
//   1. collapse → reload → still collapsed (the persistence is real, not React state);
//   2. the id is per SECTION, not per entity — collapsed on one program, collapsed on all;
//   3. a deep link to a collapsed section's anchor EXPANDS it (an address is a promise).
// Plus the composition case unit tests can't see: a heading OWNED by the wrapped
// component (ChainLedger's) grows the same chevron and folds the same body.

test.describe('Collapsible detail sections', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;
  let secondProjectId: number;

  test.beforeAll(async () => {
    const seeded = await seedProgram();
    projectId = seeded.projectId;
    // A second program: collapsing "Escalations" is a claim about the SECTION, so it
    // must hold here too without anyone touching this page.
    const second = await prisma.project.create({
      data: { name: 'R1 Refresh', partnerId: seeded.oemId, sopDate: new Date(Date.UTC(2027, 5, 30)) },
    });
    secondProjectId = second.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // Every section's disclosure carries the same testid; scope by the section's own
  // heading anchor. The collapsed state is read off aria-expanded rather than the
  // accessible name because the name flips with the state. `.last()` is load-bearing:
  // hosts like ChainLedger nest their OWN <section> inside the wrapper, so two sections
  // match the :has() — last = innermost, the one holding the heading row.
  const toggleFor = (page: Page, anchor: string) =>
    page.locator(`section:has(h2#${anchor})`).last().getByTestId('section-toggle');

  // First interaction after a page load is hydration-guarded (qa skill): an unhydrated
  // click changes nothing, so retry until the button's state visibly flips.
  const collapseGuarded = async (page: Page, anchor: string) => {
    const toggle = toggleFor(page, anchor);
    await expect(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 1000 });
    }).toPass();
  };

  test('collapsing Escalations survives reload and applies on every program', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    const body = page.getByText('No escalations.');
    await expect(body).toBeVisible();

    await collapseGuarded(page, 'escalations');
    await expect(body).toBeHidden();
    // The heading itself stays: a folded section is still findable and addressable.
    await expect(page.locator('h2#escalations')).toBeVisible();

    await page.reload();
    await expect(toggleFor(page, 'escalations')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('No escalations.')).toBeHidden();

    // Per-section, not per-entity: a program nobody collapsed anything on shows it folded.
    await page.goto(`/programs/${secondProjectId}`);
    await expect(toggleFor(page, 'escalations')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('No escalations.')).toBeHidden();
  });

  test('deep-linking a collapsed section expands it, persistently', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    await collapseGuarded(page, 'escalations');
    await expect(page.getByText('No escalations.')).toBeHidden();

    // Arriving at the section's address must show the section, not a folded heading.
    await page.goto(`/programs/${projectId}#escalations`);
    await expect(toggleFor(page, 'escalations')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('No escalations.')).toBeVisible();

    // The expand persisted (arrival is as explicit as the chevron): a plain reload
    // without the fragment stays open.
    await page.goto(`/programs/${projectId}`);
    await expect(toggleFor(page, 'escalations')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('No escalations.')).toBeVisible();
  });

  test('a heading owned by the wrapped component folds its body too (Critical chain)', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    // ChainLedger renders its own AnchorHeading + headline; the seeded program has an
    // SOP, so the headline paragraph is the ledger's first body element.
    const ledger = page.locator('[data-testid="chain-ledger"]');
    await expect(ledger.locator('p').first()).toBeVisible();

    await collapseGuarded(page, 'critical-chain');
    await expect(ledger.locator('p').first()).toBeHidden();
    await expect(page.locator('h2#critical-chain')).toBeVisible();

    await page.reload();
    await expect(toggleFor(page, 'critical-chain')).toHaveAttribute('aria-expanded', 'false');
    await expect(ledger.locator('p').first()).toBeHidden();
  });
});
