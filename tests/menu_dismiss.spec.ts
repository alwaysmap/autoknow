import { test, expect, type Locator } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// autoknow-6mn. An anchored menu whose item NAVIGATES must be gone on the page it
// navigated to — and a menu whose item runs a SERVER ACTION must not close, because
// unmounting its <form> aborts the action in flight. Those two live in one file on
// purpose: they are the same rule read from both ends, and the second is the reason
// the first could not be "close on any inner click".
//
// The nav case is the load-bearing one. On /programs and /partners the ⋯ unmounts with
// the page, so a stale panel is only visible during the client navigation; the NAV
// survives every navigation, so a panel that never closed stays open forever — which is
// exactly what the user reported.

/** Open `trigger`'s menu and wait for `item` inside it, in the hydration-guarded shape a
 *  first interaction after a page load requires (AGENTS lesson 8): re-open only when the
 *  item is not already showing, never a bare click. Every test in this file needs it, so it
 *  is written once here and they differ only where they mean to. The same shape is still
 *  hand-rolled inline in the older specs; converging them onto one shared helper is tracked
 *  as autoknow-8g1. */
async function openMenu(trigger: Locator, item: Locator): Promise<void> {
  await expect(async () => {
    if (!(await item.isVisible())) await trigger.click({ timeout: 2000 });
    await expect(item).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

test.describe('menus dismiss on navigate, and only on navigate', () => {
  test.describe.configure({ mode: 'serial' });

  let partnerId: number;
  let projectId: number;

  test.beforeAll(async () => {
    await wipeAll();
    const partner = await prisma.partner.create({
      data: {
        name: 'Rivian MD',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    partnerId = partner.id;
    const project = await prisma.project.create({
      data: { name: 'Menu Dismiss Program', partnerId: partner.id },
    });
    projectId = project.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('the collapsed nav overflow menu is closed on the page it navigated to', async ({ page }) => {
    // Narrow enough that the priority-plus nav (#28) puts links in the ⋯ at every locale.
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto('/programs');

    // The overflow menu only EXISTS after the client measurer runs, so opening it is a
    // post-hydration first interaction.
    const more = page.getByTestId('nav-more');
    const panel = page.locator('nav [role="menu"]');
    const item = panel.getByRole('menuitem').first();
    await openMenu(more, item);

    const href = await item.getAttribute('href');
    expect(href).toBeTruthy();
    await item.click();
    // Match the path, not a regex built from it — an href with a `?` would otherwise
    // compile into a pattern that quietly matches the wrong thing.
    await page.waitForURL((url) => url.pathname === href);

    // The nav is in the layout, so this is the SAME ⋯ that was open a moment ago — the
    // one place where "it never closed" is directly observable rather than raced against
    // an unmount. Before the fix all three of these failed.
    await expect(panel).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[popover]:popover-open')).toHaveCount(0);
  });

  test('the programs list ⋯ leaves no panel open on the create page', async ({ page }) => {
    await page.goto('/programs');

    const item = page.getByTestId('new-program');
    await openMenu(page.getByTestId('kebab-menu'), item);
    await item.click();
    await page.waitForURL(/\/programs\/new$/);

    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('[popover]:popover-open')).toHaveCount(0);
  });

  test('the partner page Programs ⋯ leaves no panel open on the create page', async ({ page }) => {
    await page.goto(`/partners/${partnerId}`);

    // Two kebabs on this page (the partner NAME carries its own) — scope to the section.
    const kebab = page
      .locator('section', { has: page.locator('h2#programs') })
      .getByTestId('kebab-menu');
    const item = page.getByTestId('new-program');
    await openMenu(kebab, item);
    await item.click();
    await page.waitForURL((url) => url.pathname === '/programs/new' && url.search === `?partnerId=${partnerId}`);

    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('[popover]:popover-open')).toHaveCount(0);
  });

  test('a server-action menu item still does NOT close the menu', async ({ page }) => {
    // The guard on the fix: dismiss-on-navigate must not have become dismiss-on-anything.
    // "Mark complete" is a <button type=submit> inside <form action={setProjectLifecycle}>
    // living in the ⋯ — closing the panel would unmount that form mid-submit.
    await page.goto(`/programs/${projectId}`);

    const kebab = page.getByTestId('project-meta').getByTestId('kebab-menu');
    const panel = page.getByTestId('project-meta').locator('[role="menu"]');
    const complete = page.getByTestId('mark-complete');
    await openMenu(kebab, complete);

    await complete.click();

    // Still open across the round-trip — the form was never unmounted…
    await expect(panel).toBeVisible();
    await expect(kebab).toHaveAttribute('aria-expanded', 'true');
    // …and the action it was carrying actually landed.
    await expect(async () => {
      const row = await prisma.project.findUnique({
        where: { id: projectId },
        select: { lifecycle: true },
      });
      expect(row?.lifecycle).toBe('complete');
    }).toPass({ timeout: 10000 });
  });

  test('Escape and an outside click still dismiss the menu', async ({ page }) => {
    await page.goto('/programs');

    const kebab = page.getByTestId('kebab-menu');
    const item = page.getByTestId('new-program');

    await openMenu(kebab, item);
    await page.keyboard.press('Escape');
    await expect(item).toBeHidden();

    // A bare click is fine here and only here: the page is long hydrated by this point, so
    // this is not a first interaction and needs no guard.
    await kebab.click();
    await expect(item).toBeVisible();
    // Light-dismiss: a click on the page behind the panel. The corner offset keeps it on the
    // title's far LEFT — its centre is under the ⋯ and its panel, which would not be outside.
    await page.locator('h1').click({ position: { x: 2, y: 2 } });
    await expect(item).toBeHidden();
  });
});
