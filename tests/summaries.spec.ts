import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the leadership summaries. The test server runs WITHOUT a
// Gemini key on purpose (deterministic), so these tests cover: the honest degraded
// state on all three scopes, the structured API contract, the prompt editor
// (DB override + revert-to-default), and rendering of a stored structured summary.

test.describe('Leadership summaries', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('all three scopes degrade honestly without a Gemini key', async ({ page }) => {
    await page.goto('/ecosystem');
    await expect(page.getByTestId('summary-ecosystem')).toContainText('AI summaries are off');
    await expect(page.getByTestId('summary-ecosystem')).toContainText('GEMINI_API_KEY');

    await page.goto(`/programs/${seeded.projectId}`);
    await expect(page.getByTestId('summary-program')).toContainText('AI summaries are off');

    await page.goto(`/partners/${seeded.oemId}`);
    await expect(page.getByTestId('summary-partner')).toContainText('AI summaries are off');
  });

  test('the API is structured and honest about configuration', async ({ request }) => {
    const res = await request.get(`/api/summaries/program/${seeded.projectId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.summary).toBeNull();

    // POST without a key refuses rather than faking a synthesis.
    const gen = await request.post(`/api/summaries/program/${seeded.projectId}`);
    expect(gen.status()).toBe(503);

    // Scope validation: ecosystem is id 0 only; junk scopes 404.
    expect((await request.get('/api/summaries/ecosystem/7')).status()).toBe(404);
    expect((await request.get('/api/summaries/nonsense/1')).status()).toBe(404);
  });

  test('a stored summary renders structured sections with citations', async ({ page }) => {
    // Simulate a prior generation (the shape createSummary persists).
    await prisma.summary.create({
      data: {
        scope: 'program',
        targetId: seeded.projectId,
        trigger: 'manual',
        model: 'test-model',
        windowStart: new Date(Date.now() - 7 * 86400000),
        windowEnd: new Date(),
        tldr: 'Integration is the constraint; codec drops threaten the SOP target.',
        body: {
          sections: [
            {
              key: 'risks',
              bullets: [
                {
                  text: 'Codec drops are blocking the DSP path in Integration.',
                  citations: [{ label: 'Integration · update', href: `/programs/${seeded.projectId}#phase-${seeded.phases.integration}-detail`, external: false }],
                },
              ],
            },
            {
              key: 'actions',
              bullets: [{ text: 'Escalate codec delivery with Denso.', citations: [] }],
            },
            {
              key: 'progress',
              bullets: [{ text: 'Bring-up completed ahead of forecast.', citations: [] }],
            },
          ],
        },
        sourceCounts: { needle: 2, hill: 3, context: 1 },
      },
    });

    await page.goto(`/programs/${seeded.projectId}`);
    const panel = page.getByTestId('summary-program');
    await expect(panel).toContainText('Integration is the constraint');
    await expect(panel).toContainText('Risks');
    await expect(panel).toContainText('Actions');
    await expect(panel).toContainText('Codec drops are blocking the DSP path');
    // Citation superscript deep-links to that phase's DETAILS popover.
    await expect(panel.locator(`a[href="/programs/${seeded.projectId}#phase-${seeded.phases.integration}-detail"]`)).toBeVisible();
    await expect(panel).toContainText('from 6 sources');
  });

  test('prompts are readable and tunable; clearing reverts to the default', async ({ page }) => {
    await page.goto('/manage/prompts');

    // All three scopes visible, defaulted, showing the actual default text.
    for (const scope of ['ecosystem', 'partner', 'program']) {
      const section = page.getByTestId(`prompt-${scope}`);
      await expect(section).toContainText('default');
      await expect(section.locator('textarea')).toContainText('Synthesize ONLY from the numbered evidence');
    }

    // Save a custom program prompt → DB override, badge flips.
    const program = page.getByTestId('prompt-program');
    await program.locator('textarea').fill('CUSTOM: summarize for the VP. Sections: tldr, progress, risks, themes, actions.');
    await program.getByRole('button', { name: 'Save prompt' }).click();
    await expect(page.getByTestId('prompt-program')).toContainText('custom (database override)');
    const row = await prisma.summaryPrompt.findUnique({ where: { scope: 'program' } });
    expect(row?.prompt).toContain('CUSTOM: summarize for the VP');

    // Clearing reverts to the default (override row removed). Wait on the custom
    // badge disappearing — the reliable "revert committed" signal.
    await page.getByTestId('prompt-program').locator('textarea').fill('');
    await page.getByTestId('prompt-program').getByRole('button', { name: 'Save prompt' }).click();
    await expect(page.getByTestId('prompt-program')).not.toContainText('custom (database override)');
    expect(await prisma.summaryPrompt.findUnique({ where: { scope: 'program' } })).toBeNull();

    // The explicit "Restore default" button reverts an override and resets the
    // textarea to the built-in default text.
    const partner = page.getByTestId('prompt-partner');
    await partner.locator('textarea').fill('CUSTOM partner prompt override.');
    await partner.getByRole('button', { name: 'Save prompt' }).click();
    await expect(page.getByTestId('prompt-partner')).toContainText('custom (database override)');
    await page.getByTestId('prompt-partner').getByRole('button', { name: 'Restore default' }).click();
    await expect(page.getByTestId('prompt-partner')).not.toContainText('custom (database override)');
    await expect(page.getByTestId('prompt-partner').locator('textarea')).toContainText('Synthesize ONLY from the numbered evidence');
    expect(await prisma.summaryPrompt.findUnique({ where: { scope: 'partner' } })).toBeNull();
  });
});
