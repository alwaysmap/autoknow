import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Ingested-content freshness (docs/INGEST_FRESHNESS_PLAN.md). The test server runs
// with NO Gemini key and NO cron secret on purpose, so this spec covers the
// deterministic surfaces: mode inference in the QuickIngest chip, honest degraded
// states, the Manage → Sources operator page, and revision events in the feed.

test.describe('Content freshness', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('QuickIngest infers the tracking mode as a tappable chip and degrades honestly', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);

    // Collapsed to a quiet affordance; hydration-guarded open.
    const form = page.getByTestId('quick-ingest');
    await expect(async () => {
      if (!(await form.isVisible())) await page.getByTestId('quick-ingest-open').click({ timeout: 2000 });
      await expect(form).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // A tracker URL infers Watched; the chip names what it detected.
    await form.locator('input[name="url"]').fill('https://github.com/org/repo/issues/42');
    const chip = page.getByTestId('mode-chip');
    await expect(chip).toContainText('Watched');
    await expect(chip).toContainText('bug / change');

    // Tapping flips to Snapshot — a visible choice, never a required question.
    await chip.click();
    await expect(chip).toContainText('Snapshot');

    // A chat link infers Snapshot.
    await form.locator('input[name="url"]').fill('https://chat.google.com/room/AAA/bbb/ccc');
    await expect(chip).toContainText('Snapshot');
    await expect(chip).toContainText('chat message');

    // Without a Gemini key, submitting refuses rather than faking an ingest.
    await form.locator('input[name="url"]').fill('https://example.com/notes');
    await form.locator('button[type="submit"]').click();
    await expect(page.getByTestId('quick-ingest-result')).toContainText('AI ingestion is off');
  });

  test('the refresh worker refuses to run without a secret', async ({ request }) => {
    const res = await request.get('/api/cron/refresh');
    expect(res.status()).toBe(503);
    expect((await res.json()).error).toContain('CRON_SECRET');
  });

  test('revision deltas surface as feed events with provenance on the source item', async ({ page }) => {
    // Simulate a watched doc that changed once (the shape refreshSource persists).
    const ctx = await prisma.contextUrl.create({
      data: {
        projectId: seeded.projectId,
        url: 'https://docs.google.com/document/d/testdoc123456789012/edit',
        type: 'Doc',
        title: 'R2 integration meeting notes',
        ingestedText: 'Codec delivery slipped; Denso escalation opened.',
        mode: 'watched',
        sourceRef: 'drive:testdoc123456789012',
        contentHash: 'h2',
        lastCheckedAt: new Date(),
        lastChangedAt: new Date(),
      },
    });
    await prisma.contextRevision.create({
      data: { contextUrlId: ctx.id, contentHash: 'h1', digest: 'Initial digest.', delta: null },
    });
    await prisma.contextRevision.create({
      data: {
        contextUrlId: ctx.id,
        contentHash: 'h2',
        digest: 'Codec delivery slipped; Denso escalation opened.',
        delta: 'Codec delivery slipped a week; escalation to Denso opened.',
      },
    });

    await page.goto(`/programs/${seeded.projectId}`);
    // The update is an event of its own…
    const updated = page.locator('article').filter({ hasText: 'Updated: R2 integration meeting notes' });
    await expect(updated.first()).toContainText('escalation to Denso opened');
    // …and the source item carries freshness provenance.
    const item = page.locator('article').filter({ hasText: 'R2 integration meeting notes' }).filter({ hasText: 'checked' });
    await expect(item.first()).toBeVisible();
  });

  test('Manage → Sources lists every source; pause and mode flips work', async ({ page }) => {
    // Self-contained rows (this test must run standalone too).
    const [frozen, watched] = await Promise.all([
      prisma.contextUrl.create({
        data: {
          projectId: seeded.projectId,
          url: 'https://github.com/org/repo/issues/7',
          type: 'Gerrit',
          title: 'Cold boot freeze bug',
          ingestedText: 'Bug digest.',
          mode: 'watched',
          sourceRef: 'https://github.com/org/repo/issues/7',
          contentHash: 'x',
          sourceStatus: 'resolved',
          frozenAt: new Date(),
          frozenReason: 'resolved',
        },
      }),
      prisma.contextUrl.create({
        data: {
          projectId: seeded.projectId,
          url: 'https://docs.google.com/document/d/sourcespagedoc1234567/edit',
          type: 'Doc',
          title: 'Denso supplier sync notes',
          ingestedText: 'Supplier digest.',
          mode: 'watched',
          sourceRef: 'drive:sourcespagedoc1234567',
          contentHash: 'y',
          lastCheckedAt: new Date(),
        },
      }),
    ]);

    await page.goto('/manage/sources');
    await expect(page.locator('h1')).toHaveText('Sources');

    // The resolved bug reads frozen with its reason.
    await expect(page.getByTestId(`source-${frozen.id}`)).toContainText('frozen — resolved');

    // The watched doc can be paused… (hydration-guarded: click only while unpaused)
    const docRow = page.getByTestId(`source-${watched.id}`);
    await expect(docRow).toContainText('Watched');
    await expect(async () => {
      if (!(await docRow.getByText('frozen — paused').isVisible())) {
        await docRow.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 2000 });
      }
      await expect(docRow).toContainText('frozen — paused', { timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // …and flipped to Snapshot (a recorded user decision). Completion signal: only
    // watched rows carry Refresh/Pause forms, so those disappearing proves the
    // action landed and the page re-rendered (the toggle button itself is labeled
    // "Snapshot" beforehand, so text alone can't distinguish).
    await expect(async () => {
      const refreshBtns = docRow.getByRole('button', { name: 'Refresh now' });
      if ((await refreshBtns.count()) > 0) {
        await docRow.getByRole('button', { name: 'Snapshot', exact: true }).click({ timeout: 2000 });
      }
      await expect(refreshBtns).toHaveCount(0, { timeout: 1500 });
    }).toPass({ timeout: 20000 });
    const row = await prisma.contextUrl.findUnique({ where: { id: watched.id } });
    expect(row?.mode).toBe('snapshot');
    expect(row?.modeSource).toBe('user');
  });
});
