import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Search Results Page (Text + pgvector)', () => {
  let fordId: number;
  let boschId: number;

  test.beforeAll(async () => {
    // Clear and seed a couple of partners + a project to search. Deliberately NOT
    // reindexed: embeddings stay NULL, so these tests prove the lexical half of the
    // blended search finds records that have never been embedded (the "bosch bug").
    await wipeAll();

    const oem = { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } };
    const ford = await prisma.partner.create({ data: { name: 'Ford', type: oem, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } } });
    fordId = ford.id;

    const bosch = await prisma.partner.create({
      data: {
        name: 'Bosch',
        type: { connectOrCreate: { where: { name: 'Tier 1' }, create: { name: 'Tier 1' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    boschId = bosch.id;

    await prisma.project.create({
      data: {
        name: 'Ford Evos AAOS Bring-up',
        partnerId: ford.id,
        ownerName: 'Dylan',
        sopDate: new Date('2027-06-30T00:00:00Z'),
        volumeFirstYear: 150000,
        theNeedle: 'High'
      }
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });


  test('API: a lowercase partial query finds an unembedded partner first', async ({ request }) => {
    const res = await request.get('/api/search?q=bosch');
    expect(res.ok()).toBeTruthy();
    const { items } = await res.json();

    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toMatchObject({ kind: 'partner', title: 'Bosch', href: `/partners/${boschId}` });
  });

  test('API: an exact partner name outranks the prefix-matching program', async ({ request }) => {
    const res = await request.get('/api/search?q=Ford');
    expect(res.ok()).toBeTruthy();
    const { items } = await res.json();
    const titles = items.map((i: { title: string }) => i.title);

    // Exact name match ranks first; the program matches by prefix and follows.
    expect(items[0]).toMatchObject({ kind: 'partner', title: 'Ford', href: `/partners/${fordId}` });
    expect(titles).toContain('Ford Evos AAOS Bring-up');
    // Scores are relevance-ordered and in [0, 1].
    for (const it of items) {
      expect(it.score).toBeGreaterThanOrEqual(0);
      expect(it.score).toBeLessThanOrEqual(1);
    }
  });

  test('UI: the landing page searches from ?q= and links the partner it finds', async ({ page }) => {
    await page.goto('/?q=bosch');

    const hit = page.getByRole('link', { name: 'Bosch', exact: true });
    await expect(hit).toBeVisible();
    await expect(hit).toHaveAttribute('href', `/partners/${boschId}`);
  });

  test('UI: the landing search suggests as you type, then opens the full results', async ({ page }) => {
    await page.goto('/');

    // Hydration-guarded first interaction (AGENTS lesson 8): an unguarded fill on a
    // freshly loaded page is this suite's #1 flake source.
    const suggest = page.getByTestId('search-suggest');
    await expect(async () => {
      await page.getByRole('searchbox').fill('bosch');
      await expect(suggest).toBeVisible({ timeout: 2000 });
    }).toPass();

    // Suggestions are navigable links whose accessible name says what each one IS,
    // not just what it's called.
    const hit = suggest.getByRole('link', { name: /^Bosch — Partner/ });
    await expect(hit).toBeVisible();
    await expect(hit).toHaveAttribute('href', `/partners/${boschId}`);

    // "See all results" hands off to the full experience and dismisses the panel.
    await suggest.getByRole('button').click();
    await expect(suggest).toHaveCount(0);
    // `results?` — the count line has a singular form, and how many rows this
    // fixture happens to match is not what the test is about.
    await expect(page.getByText(/results? across the ecosystem/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bosch', exact: true })).toBeVisible();
  });

  test('UI: shared /search?q= links still land on the search experience', async ({ page }) => {
    await page.goto('/search?q=bosch');

    await expect(page).toHaveURL(/\/\?q=bosch$/);
    await expect(page.getByRole('link', { name: 'Bosch', exact: true })).toBeVisible();
  });

  test('API: ranking survives a full reindex (semantic blend does not bury exact matches)', async ({ request }) => {
    const reindex = await request.post('/api/admin/reindex');
    expect(reindex.ok()).toBeTruthy();

    const res = await request.get('/api/search?q=bosch');
    const { items } = await res.json();
    expect(items[0]).toMatchObject({ kind: 'partner', title: 'Bosch' });
  });
});
