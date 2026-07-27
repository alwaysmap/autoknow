import { test, expect, clickUntilNavigated } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Me Landing Page', () => {
  test.beforeAll(async () => {
    // Clear and seed clean test data for @dylan
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Google LLC',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } }
      }
    });

    const person = await prisma.person.create({
      data: {
        name: 'Dylan Lead',
        email: 'dylan@google.com',
        currentPartnerId: partner.id,
        notes: 'Technical Engagement Lead for Android Automotive'
      }
    });

    await prisma.personAffiliation.create({
      data: {
        personId: person.id,
        partnerId: partner.id,
        role: 'TEL',
        startDate: new Date('2024-01-01')
      }
    });

    const project = await prisma.project.create({
      data: {
        name: 'AAOS Google Integration',
        partnerId: partner.id,
        ownerName: 'dylan@google.com',
        sopDate: new Date('2026-12-01'),
        volumeFirstYear: 500000
      }
    });

    const phase = await prisma.phase.create({
      data: {
        name: 'VHAL Sync',
        projectId: project.id
      }
    });

    await prisma.actionItem.create({
      data: {
        phaseId: phase.id,
        description: 'Verify HAL interface requirements with Google team',
        assignedTo: '@dylan',
        status: 'Pending'
      }
    });
  });

  // /me RENDERS the person page; it does not redirect to it (autoknow-6q3). The URL is
  // the assertion that matters: /people/16 is right until that row is deleted and
  // re-created, or until somebody else signs in on this machine — /me is right on both
  // of those days, so the address a user copies off this page has to still read /me.
  test('renders the person page AT /me, keeping the stable address', async ({ page }) => {
    await page.goto('/me?user=@dylan');

    // Verify profile info
    await expect(page.locator('body')).toContainText('Dylan Lead');
    await expect(page.locator('body')).toContainText('Technical Engagement Lead for Android Automotive');

    // Verify Project accountabilities
    await expect(page.locator('body')).toContainText('AAOS Google Integration');

    // The address bar never moved to /people/:id — before or after a reload, which is
    // the other half of "stable": a bookmark of this URL has to come back here.
    expect(new URL(page.url()).pathname).toBe('/me');
    await page.reload();
    await expect(page.locator('body')).toContainText('Dylan Lead');
    expect(new URL(page.url()).pathname).toBe('/me');

    // And the person's own route still works — this bead added an address, it retired
    // none, and every table in the app links to /people/:id.
    const person = await prisma.person.findFirst({ where: { email: 'dylan@google.com' } });
    await page.goto(`/people/${person!.id}`);
    await expect(page.locator('h1')).toContainText('Dylan Lead');
  });

  test('a login without a Person self-provisions from /me', async ({ page }) => {
    // @casey has a login (any domain member can) but no Person record yet.
    await page.goto('/me?user=@casey');
    await expect(page.locator('body')).toContainText('No person profile matches');

    // Hydration-guarded first interaction (the repo's #1 e2e flake source otherwise) —
    // and `clickUntilNavigated` rather than a bare toPass, because this body NAVIGATES:
    // a plain retry would restart on the destination and hunt for a partner picker the
    // person page is correct not to have (note: a-retry-loop-that-navigates-strands-itself).
    await clickUntilNavigated(page, /\/people\/\d+/, async () => {
      await page.selectOption('select[name="partnerId"]', { label: 'Google LLC' });
      await page.getByTestId('create-my-profile').click();
    });
    await expect(page.locator('h1')).toContainText('Casey');

    // STILL lands on /people/:id — createMyProfile is untouched by autoknow-6q3, which
    // is about the /me ROUTE throwing its address away, not about where a create lands
    // (autoknow-p90 holds the question of coming back to /me instead).
    // Identity came from the login: the directory records a human NAME ('Casey'), not
    // the raw handle, which stays the lookup key.
    await expect(page.locator('body')).toContainText('casey@google.com');
    await expect(page.locator('body')).toContainText('Google LLC');

    // …and /me now shows that same person, at /me. This is the assertion the redirect
    // used to make impossible: the address survives, so the link does.
    await page.goto('/me?user=@casey');
    await expect(page.locator('h1')).toContainText('Casey');
    expect(new URL(page.url()).pathname).toBe('/me');
  });

  test('the legacy my-projects path lands on /me and stops there', async ({ page }) => {
    await page.goto('/my-projects?user=@dylan');
    // /my-projects → /me, one hop now instead of two: /me is the destination, not a
    // waypoint on the way to a row id.
    await page.waitForURL(/\/me\?/, { timeout: 5000 });
    await expect(page.locator('body')).toContainText('Dylan Lead');
    expect(new URL(page.url()).pathname).toBe('/me');
  });
});
