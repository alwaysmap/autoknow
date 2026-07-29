import { test, expect, openMenuItemDialog } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// The escalation lifecycle end to end (#245 part a): raise → assign → triage → close →
// re-open, driven through the real dialogs, plus the two things the detail page exists to
// show — the original request beside the editable statement, and the source thread with
// its snapshot caveat.
//
// Serial by necessity, not by habit: every test after the first reads the row the one
// before it wrote, which is what makes this a LIFECYCLE test rather than five independent
// assertions about a fixture.

test.describe('Escalations', () => {
  test.describe.configure({ mode: 'serial' });

  let partnerId: number;
  let projectId: number;
  let deciderName: string;
  let chatEscalationId: number;

  test.beforeAll(async () => {
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Volvo Cars',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } },
      },
    });
    partnerId = partner.id;

    const project = await prisma.project.create({
      data: { name: 'Volvo EX90 AAOS Refresh', partnerId: partner.id },
    });
    projectId = project.id;

    const decider = await prisma.person.create({
      data: { name: 'Marcus Webb', email: 'marcusw@google.com', currentPartnerId: partner.id },
    });
    deciderName = decider.name;

    // A chat-sourced escalation with real provenance: an ingested thread to link to, the
    // trigger text verbatim, and no triage — the exact shape part (b)'s webhook creates.
    const thread = await prisma.contextUrl.create({
      data: {
        url: 'https://chat.google.com/room/volvo-ex90/cert-escalation',
        type: 'Chat',
        sourceRef: 'chat:spaces/AAA/threads/cert',
        title: 'Volvo EX90 — certification slip escalation thread',
        addedBy: 'lena@continental.example',
      },
    });
    const chatEscalation = await prisma.escalation.create({
      data: {
        title: 'Certification slip was communicated late',
        originalRequest: 'escalate the cert slip on EX90 — marketing had already committed externally',
        partnerId: partner.id,
        projectId: project.id,
        contextUrlId: thread.id,
        raisedBy: 'lena@continental.example',
        sourceKind: 'chat',
      },
    });
    chatEscalationId = chatEscalation.id;
  });

  test('lists escalations, and an untriaged one reads as untriaged', async ({ page }) => {
    await page.goto('/escalations');

    await expect(page.locator('body')).toContainText('Certification slip was communicated late');
    await expect(page.locator('body')).toContainText('Open');
    // Null severity is a STATE, not a blank cell: the list says nobody has judged it yet.
    await expect(page.locator('body')).toContainText('Not triaged');
  });

  test('raises a new escalation through the dialog', async ({ page }) => {
    await page.goto('/escalations');

    // The first interaction after a page load is hydration-guarded (AGENTS lesson 8);
    // `openMenuItemDialog` retries the whole open-menu → click-item → dialog chain.
    await openMenuItemDialog(
      page.getByTestId('kebab-menu'),
      page.getByTestId('new-escalation'),
      page.locator('dialog[open]'),
    );

    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Statement').fill('Second-source audio codec decision needed');
    await dialog.getByLabel('Partner').selectOption(String(partnerId));
    await dialog.getByRole('button', { name: 'Save' }).click();

    // Creation redirects to the new escalation's own page.
    await page.waitForURL(/\/escalations\/\d+$/);
    await expect(page.locator('h1')).toHaveText('Second-source audio codec decision needed');

    const created = await prisma.escalation.findFirstOrThrow({
      where: { title: 'Second-source audio codec decision needed' },
    });
    // A manually raised escalation records that it was raised in the app, and has no
    // original request to preserve — the two provenance facts the form cannot set.
    expect(created.sourceKind).toBe('manual');
    expect(created.originalRequest).toBeNull();
    expect(created.status).toBe('open');
  });

  test('shows the original request beside the statement, and the source thread', async ({ page }) => {
    await page.goto(`/escalations/${chatEscalationId}`);

    // Both blocks, which is the whole point of the detail page (#245 decision 4).
    await expect(page.locator('body')).toContainText('Original request');
    await expect(page.locator('body')).toContainText(
      'escalate the cert slip on EX90 — marketing had already committed externally',
    );
    // The caveat has to be here, in the same voice as the Chat acks: a snapshot, never a
    // watch (docs/SCALING_LIMITS.md §3).
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/does not follow its thread/i);
    expect(body).not.toMatch(/\broom\b/i);

    await expect(page.getByRole('link', { name: 'Source thread' })).toHaveAttribute(
      'href',
      'https://chat.google.com/room/volvo-ex90/cert-escalation',
    );
  });

  test('assigns and triages through the edit dialog', async ({ page }) => {
    await page.goto(`/escalations/${chatEscalationId}`);

    // Edit is a plain button ON the page now — no menu to open first.
    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await page.getByTestId('escalation-edit').click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await dialog.getByLabel('Severity').selectOption('s1');
    await dialog.getByLabel('Org level').selectOption('director');
    await dialog.getByLabel('Decision maker').selectOption({ label: deciderName });
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('S1');
    await expect(page.locator('body')).toContainText('Director');
    await expect(page.getByRole('link', { name: deciderName })).toBeVisible();

    const after = await prisma.escalation.findUniqueOrThrow({ where: { id: chatEscalationId } });
    expect(after.severity).toBe('s1');
    expect(after.orgLevel).toBe('director');
    // Provenance survived an edit — the whole reason `originalRequest` is absent from the
    // update schema rather than merely absent from the form.
    expect(after.originalRequest).toBe(
      'escalate the cert slip on EX90 — marketing had already committed externally',
    );
  });

  test('closes with a terminal state, then re-opens', async ({ page }) => {
    await page.goto(`/escalations/${chatEscalationId}`);

    // Closing is now pick-and-press, in the open — no menu, no dialog.
    await expect(async () => {
      await page.getByLabel('Close as').selectOption('resolved');
      await page.getByTestId('escalation-close').click({ timeout: 2000 });
      await expect(page.locator('body')).toContainText('Closed — Resolved', { timeout: 2000 });
    }).toPass({ timeout: 20000 });

    const closed = await prisma.escalation.findUniqueOrThrow({ where: { id: chatEscalationId } });
    expect(closed.status).toBe('resolved');
    // `closedAt` is derived by the action, never submitted.
    expect(closed.closedAt).not.toBeNull();

    // Re-opening is legitimate: the decision did not stick. A CLOSED escalation offers
    // re-open and nothing else — the panel cannot offer a transition the action refuses,
    // so the "Close as" picker is not even rendered.
    await page.reload();
    await expect(page.getByLabel('Close as')).toHaveCount(0);
    await expect(async () => {
      await page.getByTestId('escalation-reopen').click({ timeout: 2000 });
      await expect(page.getByTestId('escalation-close')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });

    const reopened = await prisma.escalation.findUniqueOrThrow({ where: { id: chatEscalationId } });
    expect(reopened.status).toBe('open');
    // Re-opening CLEARS the close stamp, or the page would report a live escalation as
    // having been closed on a date.
    expect(reopened.closedAt).toBeNull();
  });

  test('appears in the partner and program detail sections', async ({ page }) => {
    await page.goto(`/partners/${partnerId}`);
    await expect(page.locator('#escalations')).toBeVisible();
    await expect(page.locator('body')).toContainText('Certification slip was communicated late');

    await page.goto(`/programs/${projectId}`);
    await expect(page.locator('body')).toContainText('Certification slip was communicated late');
  });
});
