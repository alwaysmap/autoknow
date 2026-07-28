import { test, expect, expandCard, openCard, type Page } from './helpers/e2e';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the PhaseTrack train-line surface (spec §2.13) and the
// program phase editor: critical chain + explained constraint, compact read-only
// cards (typed involvement pills, no role labels, no status words), the focused
// popover (required-note status update, involvement editing, read-only dependencies),
// and structural editing gated behind whole-graph DAG validation.

// `expandCard` (toggle) and `openCard` (ensure open) come from tests/helpers/e2e —
// three specs wanted them, so they are not hand-rolled per file.

test.describe('PhaseTrack rail', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // Match by the row's name anchor exactly — substring matching would also catch rows
  // whose notes mention another phase's name.
  const row = (page: Page, name: string) =>
    page.getByTestId('phase-row').filter({ has: page.locator(`a:text-is("${name}")`) });
  const details = (page: Page) => page.getByTestId('phase-details');
  const openDetails = async (page: Page, name: string) => {
    // Hydration-resilient open: a click can land before React attaches the handler
    // on a cold dev-server load, and a swallowed click is never retried by expect().
    // Only click while the popover is closed (a late-opening popover scrims the
    // button, so a blind retry-click would hang on it).
    // The zoom button only exists at STANDARD size — min is one line, name and plan
    // — so the card is opened first when it is not already.
    await expect(async () => {
      if (!(await details(page).isVisible())) {
        const zoom = row(page, name).getByRole('button', { name: 'Details' });
        if (!(await zoom.isVisible())) await openCard(row(page, name));
        await zoom.click({ timeout: 2000 });
      }
      await expect(details(page)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
  };


  // The phase name link carries a `title` ("Done · click to trace its dependencies").
  // Per accname, a link takes its name from its CONTENT and falls back to `title`
  // only when there is none — but that ordering is easy to break by accident (an
  // aria-label added "for clarity", or wrapping the text in an aria-hidden span),
  // and the failure is invisible: sighted users see the phase name while every row
  // announces the same generic string, and the rows stop being tellable apart. So
  // assert the NAME, not the markup.
  test('a phase is reachable by its own name, not by its tooltip', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await expect(page.getByRole('link', { name: 'Bring-up', exact: true })).toBeVisible();
    // And the tooltip text is NOT what names it.
    await expect(page.getByRole('link', { name: /click to trace/ })).toHaveCount(0);
  });

  // A trace has to distinguish the two DIRECTIONS, not just related-vs-not. On a
  // phase every other phase happens to sit on a path through — the spine of a
  // converging plan — a related/unrelated scale dims nothing, so the click reads as
  // "nothing happened" (it was 6 of 15 phases on the AAOS template). Asserting the
  // four levels on the fixture's diamond: Bring-up → Integration → Certification,
  // with Audio hanging off Bring-up and therefore unrelated to Integration.
  test('tracing separates upstream, downstream and unrelated', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    const rel = (name: string) => row(page, name).getAttribute('data-rel');

    await expect(async () => {
      await row(page, 'Integration').locator('a:text-is("Integration")').click({ timeout: 2000 });
      expect(await rel('Integration')).toBe('self');
    }).toPass({ timeout: 20000 });

    expect(await rel('Bring-up')).toBe('up');        // what Integration waits FOR
    expect(await rel('Certification')).toBe('down'); // what waits ON Integration
    expect(await rel('Audio')).toBe('far');          // a sibling branch, on no path through it

    // Receded rows keep real controls, so they must not be left reachable-but-unreadable.
    const audio = row(page, 'Audio');
    await audio.locator('a:text-is("Audio")').focus();
    await expect(audio).toHaveCSS('opacity', '1');

    // The coloured stretch and the moving stretch are ONE set by construction, and
    // that is the whole guarantee: a reader told "this is your upstream" by colour
    // and "the work runs this way" by motion must be told it about the same track.
    // The two are computed from a shared filter, so this fails the moment anyone
    // reintroduces a second predicate for it.
    // Matched on GEOMETRY rather than counted, because the counts can agree while the
    // two sets sit on different track (and a trunk stretch's band and drift are loose
    // siblings among a bundle's children, so there is no wrapper to pair them by).
    const unmoving = await page.evaluate(([sel]) => {
      const geom = (el: Element) =>
        el.tagName === 'path'
          ? el.getAttribute('d')!
          : ['x1', 'y1', 'x2', 'y2'].map((a) => el.getAttribute(a)).join();
      const drift = new Set([...document.querySelectorAll('svg [class*="__flow"]')].map(geom));
      return [...document.querySelectorAll(sel)].map(geom).filter((g) => !drift.has(g));
    }, ['svg [class*="trackBacking"]']);
    expect(await page.locator('svg [class*="trackBacking"]').count()).toBeGreaterThan(0);
    expect(unmoving).toEqual([]);
  });

  // The card is one object to the reader even though it is a dozen elements, so a
  // click on ANY of it — not just the title — does the whole job: size it, trace it,
  // take the selection off whatever held it. Clicking dead space in the card body is
  // the case that regresses silently if the handler ever drifts back onto the header.
  test('clicking anywhere on a card sizes, selects and traces it', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    const integration = row(page, 'Integration');
    const audio = row(page, 'Audio');

    await expect(async () => {
      await expandCard(integration);
      await expect(integration).toHaveAttribute('data-rel', 'self', { timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await expect(integration).toContainText('Denso'); // opened to standard

    // The note text: plain prose in the card BODY, no control anywhere near it, and
    // precisely the area a header-scoped handler would miss. (Not the card's corner —
    // the involvement pills sit there, and those are links that rightly keep their
    // own job; webkit and chromium put them in different places.)
    await integration.getByText('Codec drops blocking the DSP path.').click();
    await expect(integration).not.toContainText('Denso'); // folded back to min
    await expect(integration).toHaveAttribute('data-rel', 'self');

    // A different card takes the selection outright — one phase is selected, ever.
    await expandCard(audio);
    await expect(audio).toHaveAttribute('data-rel', 'self');
    await expect(integration).not.toHaveAttribute('data-rel', 'self');
    await expect(page.getByTestId('phase-row').filter({ has: page.locator('[data-rel]') })).toBeTruthy();

    // The chevron is gone: sizing lives on the card, not on a second affordance.
    await expect(page.locator('button[aria-label^="Toggle detail"]')).toHaveCount(0);
  });

  // Collapsing the DIAGRAM is one state: every card at min and the dependency track
  // ink put away, stations left standing. Collapsing only the cards left the densest
  // thing on screen untouched, and on a rail that already opens with collapsed cards
  // it changed nothing at all. The bulk items are now idempotent, not disabled (#45):
  // even the one with nothing left to do still closes the panel, so it can never read
  // as a dead click.
  test('collapsing the diagram puts the tracks away and says so', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    const menu = page.getByRole('button', { name: 'Phase actions' });
    const expand = page.getByRole('menuitem', { name: 'Expand diagram' });
    const collapse = page.getByRole('menuitem', { name: 'Collapse diagram' });
    const rail = page.locator('svg[class*="rail"]');
    // Track ink only — a station draws its own <path> for the in-progress half-disc,
    // and those must SURVIVE the collapse, so they cannot be counted as track.
    const tracks = rail.locator('g:not([class*="station"]) > line, g:not([class*="station"]) > g > path');

    await expect(async () => {
      await menu.click({ timeout: 2000 });
      await expect(expand).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // Cards open collapsed but the tracks are drawn, so collapsing still has work.
    await expect(collapse).toBeEnabled();
    const drawn = await tracks.count();
    expect(drawn).toBeGreaterThan(0);

    await collapse.click();
    // Stations survive; the connecting ink does not.
    await expect(rail.locator('g[class*="station"]')).not.toHaveCount(0);
    await expect(tracks).toHaveCount(0);
    // And absent ink is labelled absent — in this grammar a missing line otherwise
    // means "no dependency", which would be a lie.
    await expect(page.getByText('Dependency tracks hidden')).toBeVisible();

    // Idempotent, not a disabled pair (#45): reopen and BOTH rows are still live —
    // neither greys out. Clicking Collapse again, with nothing left to collapse, does
    // not sit inert: it closes the panel (the visible response) and leaves the tracks
    // hidden, so the click can never read as dead.
    await menu.click();
    await expect(collapse).toBeEnabled();
    await expect(expand).toBeEnabled();
    await collapse.click();
    await expect(expand).toBeHidden(); // the panel closed on activation
    await expect(page.getByText('Dependency tracks hidden')).toBeVisible();
    // The way back restores the tracks.
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(tracks).toHaveCount(drawn);
    await expect(page.getByText('Dependency tracks hidden')).toHaveCount(0);
  });

  test('cards are compact: typed pills without role labels, no status words', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);

    // MIN is a single line: the name and the plan, and nothing else. No zoom button
    // and no Goal — the min size is untouched by the standard card's dossier
    // (autoknow-crw.2), which is what keeps a 15-phase program scannable.
    const bringUp = row(page, 'Bring-up');
    await expect(bringUp.getByRole('button', { name: 'Details' })).toHaveCount(0);
    await expect(bringUp).not.toContainText('Goal:');

    // Status is carried by glyphs, not words, on the card header.
    await expect(bringUp).not.toContainText('Done');
    const integration = row(page, 'Integration');
    await expect(integration).not.toContainText('In Progress');

    // Involvement renders as pills — names only, the colour carries the company
    // type. Rows default collapsed: expand first.
    await expandCard(integration);
    await expect(integration).toContainText('Denso');
    await expect(integration).toContainText('Kenji Sato');
    await expect(integration).not.toContainText('FAE');
    // The zoom button appears at standard size, and so does the Goal & definition of
    // done — the standard card is the phase's dossier, so what it is FOR is readable
    // without opening anything (autoknow-crw.2).
    await expect(integration.getByRole('button', { name: 'Details' })).toBeVisible();
    await expect(integration).toContainText('Goal:');
    // …the latest update whole, beside it: the words, the date and the author.
    await expect(integration).toContainText('Codec drops blocking the DSP path.');
    await expect(integration).toContainText('testbot');
    // …and the involvement metadata PINNED to the foot: whichever reading column runs
    // longer, the pills are the last thing on the card. Compared as boxes rather than
    // as DOM order, because "pinned to the foot" is a claim about where it RENDERS.
    const footTop = await integration.locator('a', { hasText: 'Denso' }).first()
      .evaluate((el) => el.getBoundingClientRect().top);
    for (const above of ['Goal:', 'Codec drops blocking the DSP path.']) {
      const bottom = await integration.getByText(above, { exact: false }).first()
        .evaluate((el) => el.getBoundingClientRect().bottom);
      expect(footTop).toBeGreaterThanOrEqual(bottom);
    }

    // Clicking the card again folds it back to one line, taking the goal, the pills
    // and the zoom button with it.
    await expandCard(integration);
    await expect(integration).not.toContainText('Denso');
    await expect(integration.getByRole('button', { name: 'Details' })).toHaveCount(0);
  });



  test('the popover is a modal over the rail; Esc closes it', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    const before = new URL(page.url());

    await openDetails(page, 'Audio');
    // Same page — a modal over the rail, no navigation and no <dialog>. Opening a
    // card can set an intermediate `#phase-N` (the title is a real deep link, main's
    // rail work), but the LAST thing this flow does is click Details, and the popover
    // that replaced the retired /history/phase/:id page is itself a URL (design.md
    // §5) — so it lands on `#phase-N-detail`. Path and query must not move; only the
    // fragment does, and to the detail anchor.
    const opened = new URL(page.url());
    expect(opened.pathname + opened.search).toBe(before.pathname + before.search);
    expect(opened.hash).toBe(`#phase-${seeded.phases.audio}-detail`);
    await expect(page.getByRole('dialog', { name: 'Audio' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(details(page)).toHaveCount(0);
    // Closing takes the fragment back off — the URL never claims an open popover.
    await expect.poll(() => new URL(page.url()).hash).toBe('');
  });

  test('a hill update REQUIRES a note; saving records history', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await openDetails(page, 'Audio');

    // The pane rests in view mode — the Update affordance reveals ball + editor.
    await details(page).getByRole('button', { name: 'Update', exact: true }).click();

    // Move the dot but say nothing → blocked with the inline error, still open.
    await details(page).locator('input[id^="phaseHillProgress-"]').fill('55');
    await details(page).getByRole('button', { name: 'Save Update' }).click();
    await expect(details(page)).toContainText('A progress change needs a note');
    await expect(details(page)).toBeVisible();

    // Write the note in the WYSIWYG editor (markdown under the hood) and save.
    await details(page).locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('Codec samples landed; over the hill.');
    await details(page).getByRole('button', { name: 'Save Update' }).click();

    // Save drops back to the view-mode story: the fresh update leads, big.
    await expect(details(page)).toContainText('Codec samples landed; over the hill.');
    await page.keyboard.press('Escape');
    await expect(details(page)).toHaveCount(0);

    // Back on the track: the card (expanded — rows default collapsed) shows the
    // new note but NOT the history list.
    const audio = row(page, 'Audio');
    await openCard(audio); // openDetails already opened it — a toggle would shut it
    await expect(audio).toContainText('Codec samples landed; over the hill.', { timeout: 10000 });
    await expect(audio.getByText('History')).toHaveCount(0);

    // The history (with the prior update) lives on the popover.
    await openDetails(page, 'Audio');
    await expect(details(page).getByText('History', { exact: true })).toBeVisible();
    // The LATEST update is the big headline; only the older one renders as a
    // compact history card.
    await expect(details(page).locator('[class*="latestUpdate"]')).toContainText('Codec samples landed');
    await expect(details(page).locator('[class*="historyList"] article')).toHaveCount(1);
  });

  test('partner involvement is editable on the popover', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await openDetails(page, 'Integration');

    // Seeded involvement is visible with its role (roles live HERE, not on the rail).
    const densoChip = details(page).locator('[data-testid="involvement-chip"]').filter({ hasText: 'Denso' });
    await expect(densoChip).toContainText('Supplier');

    // Add another partner with a role — the ghost "+" reveals the small form.
    await details(page).getByRole('button', { name: 'Partner to involve' }).click();
    await details(page).locator('select[aria-label="Partner to involve"]').selectOption({ label: 'Rivian' });
    await details(page).locator('input[aria-label="Role (optional)"]').first().fill('OEM');
    await details(page).getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(details(page).locator('[data-testid="involvement-chip"]').filter({ hasText: 'Rivian' })).toBeVisible();

    // Remove it again.
    await details(page)
      .locator('[data-testid="involvement-chip"]')
      .filter({ hasText: 'Rivian' })
      .locator('button[aria-label^="Remove"]')
      .click();
    await expect(details(page).locator('[data-testid="involvement-chip"]').filter({ hasText: 'Rivian' })).toHaveCount(0);
  });

  test('people involvement is editable on the popover', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await openDetails(page, 'Integration');

    // Seeded person is visible with role; remove them.
    const kenji = details(page).locator('[data-testid="involvement-chip"]').filter({ hasText: 'Kenji Sato' });
    await expect(kenji).toContainText('FAE');
    await kenji.locator('button[aria-label^="Remove"]').click();
    await expect(details(page).locator('[data-testid="involvement-chip"]').filter({ hasText: 'Kenji Sato' })).toHaveCount(0);

    // Add them back with a new role via the People picker (behind the ghost "+").
    await details(page).getByRole('button', { name: 'Person to involve' }).click();
    await details(page).locator('select[aria-label="Person to involve"]').selectOption({ label: 'Kenji Sato' });
    await details(page).locator('select[aria-label="Person to involve"]')
      .locator('xpath=following-sibling::input[1]').fill('Audio lead');
    await details(page).locator('select[aria-label="Person to involve"]')
      .locator('xpath=following-sibling::button[1]').click();
    const restored = details(page).locator('[data-testid="involvement-chip"]').filter({ hasText: 'Kenji Sato' });
    await expect(restored).toBeVisible();
    await expect(restored).toContainText('Audio lead');
  });
});

test.describe('Program phase editor', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // The card-DAG canvas: nodes carry only the name; everything else lives in the panel.
  const card = (page: Page, name: string) =>
    page.locator(`[data-testid="phase-card"][data-name="${name}"]`);
  const panel = (page: Page) => page.getByTestId('phase-panel');
  const saveBtn = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
  // Hydration-resilient interactions: on a cold dev-server load a click can land
  // before React attaches handlers; retry until the intended state appears.
  const openPanel = async (page: Page, name: string) => {
    await expect(async () => {
      if (!(await panel(page).isVisible())) {
        await card(page, name).click({ timeout: 2000 });
      }
      await expect(panel(page)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
  };
  const addPhaseOpensPanel = async (page: Page) => {
    await expect(async () => {
      if (!(await panel(page).isVisible())) {
        await page.getByRole('button', { name: 'Add phase' }).click({ timeout: 2000 });
      }
      await expect(panel(page)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
  };

  // Chain math shows on the rail as the constraint card's evidence line.
  const railRow = (page: Page, name: string) =>
    page.getByTestId('phase-row').filter({ has: page.locator(`a:text-is("${name}")`) });

  test('flags the seeded dead-end branch and disables Save', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // Audio never converges on Certification — two sinks, so the graph is invalid.
    await expect(page.getByTestId('dag-errors')).toContainText('“Audio” dead-ends');
    await expect(saveBtn(page)).toBeDisabled();
  });

  test('click downstream, click upstream, CONNECT — the save persists', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // Certification (downstream) opens the panel; Audio becomes the upstream candidate.
    await openPanel(page, 'Certification');
    await card(page, 'Audio').click();
    await panel(page).getByTestId('connect-after').click();

    // Single sink again → valid → savable.
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
    await expect(saveBtn(page)).toBeEnabled();
    await saveBtn(page).click();

    await page.waitForURL(`**/programs/${seeded.projectId}`);
    const deps = await prisma.phaseDependency.count({ where: { phaseId: seeded.phases.certification } });
    expect(deps).toBe(2);
  });

  test('a cycle is flagged live and cannot be saved', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // Integration already depends on Bring-up; wiring Bring-up after Certification cycles.
    await openPanel(page, 'Bring-up');
    await card(page, 'Certification').click();
    await panel(page).getByTestId('connect-after').click();

    await expect(page.getByTestId('dag-errors')).toContainText('cycle');
    await expect(saveBtn(page)).toBeDisabled();
  });

  test('renames and re-forecasts (weeks) via the detail panel', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    await openPanel(page, 'Audio');
    await panel(page).getByLabel('Phase name').fill('Audio & Media');
    await panel(page).getByLabel('Forecast (weeks)').fill('3.5'); // ≈ the seeded 25 days
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);

    // The rail reflects the rename and the weeks-based forecast.
    const renamed = page.getByTestId('phase-row').filter({ has: page.locator('a:text-is("Audio & Media")') });
    await expect(renamed).toHaveCount(1);
    await expect(renamed).toContainText('3.6w planned'); // 25 days ≈ 3.6w
  });

  test('adds a phase after the end; removes it again', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // Add opens the new card's panel; name it, forecast it, connect it after the end.
    await addPhaseOpensPanel(page);
    await panel(page).getByLabel('Phase name').fill('Field Trials');
    await panel(page).getByLabel('Forecast (weeks)').fill('4');
    await card(page, 'Certification').click();
    await panel(page).getByTestId('connect-after').click();

    // The END ring follows the new single sink; the graph is valid; save.
    await expect(card(page, 'Field Trials')).toHaveAttribute('title', /end phase/);
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);

    // The chain extends through the new phase: 74 + 28 ≈ 102 days — visible on the
    // constraint card's evidence line (Integration still heads the chain; rows
    // default collapsed, so expand first).
    await expandCard(railRow(page, 'Integration'));
    await expect(railRow(page, 'Integration')).toContainText('gates ≈102 days of downstream chain work');

    // Remove it from its panel (no history yet → no confirm) and save.
    await page.goto(`/programs/${seeded.projectId}/phases`);
    await openPanel(page, 'Field Trials');
    await panel(page).getByRole('button', { name: 'Remove phase' }).click();
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);
    // rows default collapsed — expand the constraint card before reading evidence
    await expandCard(railRow(page, 'Integration'));
    await expect(railRow(page, 'Integration')).toContainText('gates ≈74 days of downstream chain work');
  });

  test('adds a phase UPSTREAM of existing work via “before”', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // New node; click Bring-up as the other side; connect this one BEFORE it.
    await addPhaseOpensPanel(page);
    await panel(page).getByLabel('Phase name').fill('Prep');
    await panel(page).getByLabel('Forecast (weeks)').fill('4');
    await card(page, 'Bring-up').click();
    await panel(page).getByTestId('connect-before').click();

    // Prep is now the root (Bring-up depends on it); the graph stays valid.
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);

    // The chain grew from the TOP: Prep (28d) + the old ≈74 ≈ 102 — and the
    // CONSTRAINT moves to Prep, the new first unfinished stop on the chain.
    // (rows default collapsed — expand before reading the evidence line)
    await expandCard(railRow(page, 'Prep'));
    await expect(railRow(page, 'Prep')).toContainText('gates ≈102 days of downstream chain work');
    const bringUpDeps = await prisma.phaseDependency.count({ where: { phaseId: seeded.phases.bringUp } });
    expect(bringUpDeps).toBe(1);

    // Restore: remove Prep again.
    await page.goto(`/programs/${seeded.projectId}/phases`);
    await openPanel(page, 'Prep');
    await panel(page).getByRole('button', { name: 'Remove phase' }).click();
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);
    // rows default collapsed — expand the constraint card before reading evidence
    await expandCard(railRow(page, 'Integration'));
    await expect(railRow(page, 'Integration')).toContainText('gates ≈74 days of downstream chain work');
  });

  // #crw.1: one editor owns every field of a phase. The fragment lands on the phase,
  // and involvement — which used to be reachable ONLY from the program page's popover —
  // is changed right here, beside the name, the forecast and Goal & DoD.
  test('a phase fragment opens that phase, and involvement is editable in the panel', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases#phase-${seeded.phases.integration}`);

    // Arriving with the fragment opens Integration's panel — no click needed. The
    // hydration guard is still required: the fragment is read once React attaches.
    await expect(async () => {
      await expect(panel(page)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await expect(panel(page).getByLabel('Phase name')).toHaveValue('Integration');

    // The seeded involvement is here, with its role.
    const chip = (name: string) =>
      panel(page).locator('[data-testid="involvement-chip"]').filter({ hasText: name });
    await expect(chip('Denso')).toContainText('Supplier');
    await expect(chip('Kenji Sato')).toContainText('FAE');

    // Add a partner through the picker — the option set IS the partner directory.
    await panel(page).getByTestId('add-partner').click();
    await panel(page).locator('select[aria-label="Partner to involve"]').selectOption({ label: 'Rivian' });
    await panel(page).locator('input[aria-label="Role (optional)"]').first().fill('OEM');
    await panel(page).getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(chip('Rivian')).toBeVisible();
    expect(await prisma.phasePartner.count({
      where: { phaseId: seeded.phases.integration, partnerId: seeded.oemId },
    })).toBe(1);

    // …and remove them again, without leaving the editor.
    await chip('Rivian').locator('button[aria-label^="Remove"]').click();
    await expect(chip('Rivian')).toHaveCount(0);
    expect(await prisma.phasePartner.count({
      where: { phaseId: seeded.phases.integration, partnerId: seeded.oemId },
    })).toBe(0);
  });
});
