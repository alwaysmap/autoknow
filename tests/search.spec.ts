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

  test('should render the unified search with type filter chips', async ({ page }) => {
    await page.goto('/search?q=Ford');

    // Unified search header + the page's search box pre-filled from ?q= (the global
    // nav search also exists, so target by placeholder).
    await expect(page.locator('h1')).toContainText('Search');
    const searchBox = page.getByPlaceholder('Search partners, programs, people, context…');
    await expect(searchBox).toBeVisible();
    await expect(searchBox).toHaveValue('Ford');

    // Type filter chips (include/exclude) are present for every searchable type
    for (const t of ['Partners', 'Programs', 'People', 'Context']) {
      await expect(page.getByRole('button', { name: t, exact: true })).toBeVisible();
    }
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

  test('UI: searching bosch shows the partner as a result link', async ({ page }) => {
    await page.goto('/search?q=bosch');

    const hit = page.getByRole('link', { name: 'Bosch', exact: true });
    await expect(hit).toBeVisible();
    await expect(hit).toHaveAttribute('href', `/partners/${boschId}`);
  });

  test('API: ranking survives a full reindex (semantic blend does not bury exact matches)', async ({ request }) => {
    const reindex = await request.post('/api/admin/reindex');
    expect(reindex.ok()).toBeTruthy();

    const res = await request.get('/api/search?q=bosch');
    const { items } = await res.json();
    expect(items[0]).toMatchObject({ kind: 'partner', title: 'Bosch' });
  });
});
