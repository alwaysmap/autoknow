import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Search Results Page (Text + pgvector)', () => {
  let fordId: number;
  let boschId: number;
  let initiativeId: number;

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

    // A person who has MOVED: her Bosch address is recorded on the period she held it
    // (#127 E8), and her current address shares nothing with it. Searching the old one
    // is what autoknow-drb was about — before the fix the lexical channel read only
    // `Person.email` and she was unfindable by the address on every 2023 document.
    const mover = await prisma.person.create({
      data: { name: 'Ingrid Moved', email: 'ingrid@waymo.example', currentPartnerId: bosch.id },
    });
    await prisma.personAffiliation.createMany({
      data: [
        { personId: mover.id, partnerId: bosch.id, role: 'Platform Engineer',
          startDate: new Date('2021-01-01T00:00:00Z'), endDate: new Date('2024-01-01T00:00:00Z'),
          email: 'ingrid.olsen@bosch.example' },
        { personId: mover.id, partnerId: ford.id, role: 'Systems Engineer',
          startDate: new Date('2024-01-01T00:00:00Z'), email: 'ingrid@waymo.example' },
      ],
    });

    // An initiative with Bosch as its one active member: findable by its own name AND
    // by the member's name (initiativeIndexText / the branch's member-names aggregate).
    const template = await prisma.programTemplate.create({ data: { name: 'Charging workflow snapshot' } });
    const initiative = await prisma.initiative.create({
      data: { name: 'Evos Charging Initiative', templateId: template.id },
    });
    initiativeId = initiative.id;
    await prisma.initiativePartner.create({ data: { initiativeId: initiative.id, partnerId: bosch.id } });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });


  // autoknow-drb (#124 Class 4, search side). A colleague searching the address on a
  // 2023 document is searching for the HUMAN, and a person who moves must not vanish
  // from search the moment their address changes — the same defect resolvePerson fixed
  // on the matching side and ownerPersonId fixed on the reference side.
  test('API: a person is findable by an address they have LEFT', async ({ request }) => {
    const res = await request.get('/api/search?q=ingrid.olsen@bosch.example');
    expect(res.ok()).toBeTruthy();
    const { items } = await res.json();
    // A feed item is identified by `kind` and `href`, not a `type` field — the search
    // branch's SQL column of that name is projected into the FeedItem shape upstream.
    const person = items.find((r: { href: string }) => r.href.startsWith('/people/'));
    expect(person?.title).toBe('Ingrid Moved');
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

  test('API: an initiative is findable by its own name and links to its page', async ({ request }) => {
    const res = await request.get('/api/search?q=charging');
    expect(res.ok()).toBeTruthy();
    const { items } = await res.json();
    // Rank 0 is guaranteed: the only other 'charging' text in the fixture is the
    // ProgramTemplate's name, and templates are not a searchable type.
    expect(items[0]).toMatchObject({
      kind: 'initiative',
      title: 'Evos Charging Initiative',
      href: `/initiatives/${initiativeId}`,
    });
  });

  test('API: an initiative surfaces under an ACTIVE member partner name', async ({ request }) => {
    const res = await request.get('/api/search?q=bosch&types=initiative');
    expect(res.ok()).toBeTruthy();
    const { items } = await res.json();
    // A member-name match is secondary evidence (0.6), not a title hit — the row is
    // present, its title untouched by the query.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'initiative', title: 'Evos Charging Initiative' });
  });

  test('UI: an initiative hit renders in the full results and links to its page', async ({ page }) => {
    await page.goto('/?q=charging');

    const hit = page.getByRole('link', { name: 'Evos Charging Initiative', exact: true });
    await expect(hit).toBeVisible();
    await expect(hit).toHaveAttribute('href', `/initiatives/${initiativeId}`);
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

  test('UI: the suggestion list is navigable with the arrow keys, and Enter opens the highlighted row', async ({ page }) => {
    await page.goto('/');

    const box = page.getByRole('searchbox');
    const suggest = page.getByTestId('search-suggest');
    await expect(async () => {
      await box.fill('ford');
      await expect(suggest).toBeVisible({ timeout: 2000 });
    }).toPass();

    const options = suggest.getByRole('option');
    // Down highlights the top row (the exact-match partner); the searchbox points at it.
    await box.press('ArrowDown');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(box).toHaveAttribute('aria-activedescendant', 'search-suggest-opt-0');

    // Down again moves the highlight; the previous row is no longer selected.
    await box.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');

    // Up brings it back to the top row, and Enter follows that row's own link.
    await box.press('ArrowUp');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await box.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/partners/${fordId}$`));
  });

  test('UI: clearing the search box returns to the landing page without a full refresh', async ({ page }) => {
    await page.goto('/');

    const box = page.getByRole('searchbox');
    const suggest = page.getByTestId('search-suggest');
    await expect(async () => {
      await box.fill('bosch');
      await expect(suggest).toBeVisible({ timeout: 2000 });
    }).toPass();

    // Commit to the full results view (the state the user gets stuck in).
    await suggest.getByRole('button').click();
    const count = page.getByText(/results? across the ecosystem/);
    await expect(count).toBeVisible();

    // Emptying the box tears the results down in place — the default landing page is back.
    await box.fill('');
    await expect(count).toHaveCount(0);
    await expect(suggest).toHaveCount(0);
    await expect(box).toHaveValue('');
  });

  test('UI: shared /search?q= links still land on the search experience', async ({ page }) => {
    await page.goto('/search?q=bosch');

    await expect(page).toHaveURL(/\/\?q=bosch$/);
    await expect(page.getByRole('link', { name: 'Bosch', exact: true })).toBeVisible();
  });

  test('API: a reindex does not let unrelated records leak into a specific-name search', async ({ request }) => {
    // Reindex embeds every row. With Gemini unconfigured (the test env), those vectors
    // are the deterministic fallback — an all-positive pedestal that sits ~0.75 from
    // EVERY query, which once floated unrelated brands in above the lexical ranking.
    // A name search must still return only records that name actually hits.
    const reindex = await request.post('/api/admin/reindex');
    expect(reindex.ok()).toBeTruthy();

    const res = await request.get('/api/search?q=bosch');
    const { items } = await res.json();
    const titles = items.map((i: { title: string }) => i.title);

    expect(items[0]).toMatchObject({ kind: 'partner', title: 'Bosch' });
    // Ford (partner) and its program share nothing with "bosch"; the pedestal used to
    // carry them in on a ~0.75 semantic score.
    expect(titles).not.toContain('Ford');
    expect(titles).not.toContain('Ford Evos AAOS Bring-up');
  });
});
