import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// autoknow-f9k asked whether hash-addressable popovers fail to CLEAR their hash on close,
// leaving a URL that still asks for a popover the reader has dismissed — which the next
// revalidate would honour by reopening it. Re-measured on the e2e build, all three
// families clear correctly and no console error appears. The bead's own second comment
// had already withdrawn the `useInsertionEffect` half; this withdraws the rest.
//
// What was missing is the pin. "Everything is a URL" (design.md §5) is a two-way contract
// — arriving at the hash OPENS the popover, and closing it must stop asking — and only
// the OPENING half was tested anywhere. `tests/needle.spec.ts` asserts the fragment is
// written on open and, on dismissal, only that the confirm prompt fires; the bead says so
// itself. So the round trip could break at any time with a green suite, which is exactly
// why the report could not be settled from the code.
//
// ONE spec for all three implementations on purpose (AGENTS lesson 7). They are three
// hand-rolled variants of one rule — NeedleGauge and RelationshipScale share
// `useHashAddressablePopover`, PhaseTrack still has its own `writeProgressHash` — and
// three copies of this test would let the rule drift exactly where the code already has.
test.describe('a hash-addressable popover stops asking for itself when it closes', () => {
  test.describe.configure({ mode: 'serial' });

  let partnerId: number;
  let projectId: number;
  let phaseId: number;
  let phaseStateId: number;

  test.beforeAll(async () => {
    await wipeAll();
    const partner = await prisma.partner.create({
      data: {
        name: 'Lucid Motors',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    partnerId = partner.id;
    const project = await prisma.project.create({
      data: {
        name: 'Lucid Gravity Cockpit',
        partnerId: partner.id,
        ownerName: 'dylan',
        theNeedle: 'On Track',
        sopDate: new Date('2028-01-01'),
        volumeFirstYear: 90000,
      },
    });
    projectId = project.id;
    const phase = await prisma.phase.create({ data: { name: 'AAOS Bring-up', projectId: project.id } });
    phaseId = phase.id;
    // A real update, so the addressed form below has something to address: the
    // `-:stateId` variant is the case that used to reopen itself after a revalidate
    // (autoknow-51j), so it is asserted separately from the bare log.
    const state = await prisma.phaseState.create({
      data: { phaseId: phase.id, status: 'In Progress', theNeedle: 'On Track', hillChartProgress: 20, source: 'testbot' },
    });
    phaseStateId = state.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // Each case reloads twice per attempt and may retry; the default 30s is a ceiling these
  // brush under load, and a false red on a timing test is worse than a slow true one.
  test.beforeEach(({}, testInfo) => testInfo.setTimeout(90_000));

  /**
   * Arrive at `hash`, close the popover it opened, and assert where the URL ended up.
   *
   * Deep-linking rather than clicking the opener: that is the path a shared URL and an
   * AI-brief citation take, so it is the one worth pinning.
   *
   * The WHOLE trip is inside the hydration guard (AGENTS lesson 8), not just the click.
   * A close landing before hydration still dismisses the native `<dialog>` — the
   * element's own behaviour — while React's `onClose`, which is what clears the hash,
   * never runs; retrying only the click would then find the popover already gone and
   * assert against a URL nothing had cleaned up, a false RED reading exactly like the
   * bug this spec exists to detect.
   *
   * Which is why each attempt resets through a DIFFERENT page. `page.goto` to a URL
   * differing from the current one only by its fragment is a SAME-DOCUMENT navigation:
   * nothing reloads, and a retry would sit on a hidden panel until the budget died,
   * reporting the first attempt's stale hash (measured: exactly that, 25s of it). Going
   * via the program's own bare path is NOT enough either — on the program page that
   * second, same-document hop lands with the fragment CLEARED and the popover shut,
   * which is `autoknow-pfka`, filed from this spec. `/` is a different document, so both
   * hops are real navigations and the arrival is the one a shared URL makes.
   */
  const closesTo = async (
    page: import('./helpers/e2e').Page,
    path: string,
    hash: string,
    panel: import('./helpers/e2e').Locator,
    expected: string,
  ) => {
    await expect(async () => {
      await page.goto('/');
      await page.goto(`${path}${hash}`);
      await expect(panel).toBeVisible({ timeout: 6000 });
      // Visible is not hydrated. The dialog element is server-rendered and the browser
      // will dismiss it on click all by itself, so a close that lands early LOOKS like a
      // successful close and leaves the hash set — the bug's own symptom, manufactured.
      // Settling the page first is what makes the retry converge instead of re-running
      // the same race.
      await page.waitForLoadState('networkidle');
      await panel.getByRole('button', { name: /close/i }).first().click({ timeout: 2000 });
      // HIDDEN, not absent: `<dialog>` stays mounted when it closes, so `toHaveCount(0)`
      // would never pass here. `toBeHidden` is also true for a locator matching nothing,
      // which covers the panels that DO unmount.
      await expect(panel).toBeHidden({ timeout: 2000 });
      expect(await page.evaluate(() => window.location.hash)).toBe(expected);
    }).toPass({ timeout: 30000 });
  };

  /** The four popovers, as a table: page, the fragment that opens them, the panel, and
   *  the URL they must come to rest on. Named because two of them are exercised twice —
   *  once for the fragment and once for the console — and a second spelling of a testid
   *  or a hash is a drift the suite would not catch. */
  const CASES = {
    gaugeLog: () => ({
      path: `/programs/${projectId}`,
      hash: '#status-history',
      testId: 'needle-detail',
      // Nothing left behind: the gauge's own row has no anchor to fall back to, so the
      // honest resting URL is the page itself.
      restsAt: '',
    }),
    relationshipLog: () => ({
      path: `/partners/${partnerId}`,
      hash: '#relationship-history',
      testId: 'relationship-detail',
      restsAt: '',
    }),
    phaseLog: () => ({
      path: `/programs/${projectId}`,
      hash: `#phase-${phaseId}-progress`,
      testId: 'phase-progress',
      // Different by design, and worth pinning as different: the card is still on screen
      // behind the log, so the phase keeps its address instead of the URL forgetting
      // where the reader is.
      restsAt: `#phase-${phaseId}`,
    }),
    addressedPhaseUpdate: () => ({
      path: `/programs/${projectId}`,
      hash: `#phase-${phaseId}-progress-${phaseStateId}`,
      testId: 'phase-progress',
      restsAt: `#phase-${phaseId}`,
    }),
  };

  const expectClosesTo = async (page: import('./helpers/e2e').Page, c: ReturnType<typeof CASES.gaugeLog>) =>
    closesTo(page, c.path, c.hash, page.getByTestId(c.testId), c.restsAt);

  test('the program gauge log clears the fragment entirely', async ({ page }) => {
    await expectClosesTo(page, CASES.gaugeLog());
  });

  test('the partner relationship log clears the fragment entirely', async ({ page }) => {
    await expectClosesTo(page, CASES.relationshipLog());
  });

  test("the phase log falls back to the phase's own row anchor, not to nothing", async ({ page }) => {
    await expectClosesTo(page, CASES.phaseLog());
  });

  test('an ADDRESSED phase update clears too, rather than reopening on the next render', async ({ page }) => {
    await expectClosesTo(page, CASES.addressedPhaseUpdate());
  });

  test('closing logs no console error — the hash listeners run outside React commit', async ({ page }) => {
    // The bead's other half: `lib/locationHash` patches pushState/replaceState and
    // dispatches SYNCHRONOUSLY, so a subscriber that setStates in response could be doing
    // it inside React's commit phase ("useInsertionEffect must not schedule updates").
    // Asserted at the console rather than reasoned about, because that error does not
    // fail anything on its own and so returns silently. Two families, because the shared
    // hook and PhaseTrack's hand-rolled copy are the two that could differ.
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await expectClosesTo(page, CASES.gaugeLog());
    await expectClosesTo(page, CASES.phaseLog());

    expect(errors).toEqual([]);
  });
});
