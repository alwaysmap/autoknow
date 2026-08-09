import Link from 'next/link';
import EcosystemStatStrip from '../../components/EcosystemStatStrip';
import SummaryPanel from '../../components/SummaryPanel';
import { getSummary } from '../../lib/summaries';
import { geminiConfigured } from '../../lib/gemini';
import CapacityChart from '../../components/CapacityChart';
import ProgramTimeline from '../../components/ProgramTimeline';
import { getEcosystemDashboardData, getPartnerRelationshipScores } from '../../lib/dashboardData';
import { getProgramStartMs } from '../../lib/programTimelineData';
import { buildTimelineMarks } from '../../lib/programTimeline';
import { deriveProgramStatus } from '../../lib/lifecycle';
import { getEcosystemEscalations, getOpenEscalationsCount } from '../../lib/escalationQueries';
import { countActiveInitiatives, getInitiativesList } from '../../lib/initiativeQueries';
import { initiativeHref } from '../../lib/entityHref';
import InitiativeDistribution from '../../components/InitiativeDistribution';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import EcosystemDashboardClient from './EcosystemDashboardClient';
import EscalationRows from '../../components/EscalationRows';
import styles from './page.module.css';
import AnchorHeading from '../../components/AnchorHeading';
import KebabMenu from '../../components/KebabMenu';
import PageShell from '../../components/PageShell';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ pop?: string }> }) {
  // Poppable charts: a PARAMETER for humans, not a route per chart — a route family would
  // explode as the sweep grows, and `?pop=` reuses this page's session and its assembly
  // rather than duplicating either
  // (docs/adr/2026-07-22-poppable-charts-a-parameter-a-shared-assembly-and-a-token.md).
  // The machine-facing `/embed` half of that ADR, with its own credential, is autoknow-7wi
  // and is deliberately not built here.
  const { pop } = await searchParams;
  const locale = await getLocale();
  const summary = await getSummary('ecosystem', 0);

  // Snapshot "now" server-side so SSR and hydration agree. This is an async Server
  // Component — Date.now() runs once per request on the server, not on every client
  // render, so the react-hooks purity rule (which assumes client re-render) is a
  // false positive here. Taken BEFORE the loads because getInitiativesList reads
  // member statuses against it.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // 2. Load the shared dashboard data (projects, forecasts, cycle times, briefings,
  //    the ecosystem chain busiest-resources roll-up) plus the partner relationship
  //    scores the mix tile reads, the escalation and initiative counts for the strip,
  //    and the initiative rows for the section below the timeline.
  const [{ serializedProjects, busiest }, relationshipScores, openEscalationCount, escalations, activeInitiativeCount, initiatives] = await Promise.all([
    getEcosystemDashboardData(),
    getPartnerRelationshipScores(),
    getOpenEscalationsCount(),
    getEcosystemEscalations(),
    countActiveInitiatives(),
    getInitiativesList(now),
  ]);

  // The portfolio timeline (#159). Active programs only — this page is the leadership view
  // of what is IN FLIGHT — and what that leaves out is counted rather than silently
  // dropped, so the chart never quietly disagrees with the strip's program count above it.
  //
  // One partition, so "in flight = Active" is decided once. The excluded STATUSES are
  // collected in the same pass because the note below links to them by name.
  // One extra query for the page, through `getProgramStartMs` — the shared assembly /programs
  // will call too when #159's second surface lands.
  const inFlight: typeof serializedProjects = [];
  const excludedStatuses = new Set<ReturnType<typeof deriveProgramStatus>>();
  let notInFlightCount = 0;
  for (const p of serializedProjects) {
    const status = deriveProgramStatus(p);
    if (status === 'Active') { inFlight.push(p); continue; }
    notInFlightCount += 1;
    excludedStatuses.add(status);
  }

  const timeline = buildTimelineMarks(
    inFlight, await getProgramStartMs(inFlight.map((p) => p.id)), now,
  );

  // …and the count is a LINK, because the statuses are named from the excluded rows
  // themselves rather than assumed. `/programs`' status funnel keys on exactly this
  // vocabulary (`deriveProgramStatus`), so the destination shows those programs and no
  // others — including Archived, which this page counts and that table can still show.
  // Spelling out the statuses beats a `?filter=` shorthand: the reader lands on a table
  // whose funnel already says which statuses they are looking at (design.md §6).
  const notInFlightHref = `/programs?${[...excludedStatuses]
    .map((s) => `status=${encodeURIComponent(s)}`).join('&')}`;

  // The popped form: the chart alone, keeping the nav (`chrome: full`, the human default in
  // the ADR) so the page is still navigable. Same component, same layout object — a popped
  // chart that recomputed anything would be the second assembly the ADR exists to prevent.
  if (pop === 'timeline') {
    return (
      <PageShell title={t(locale, 'timelineTitle')} subtitle={t(locale, 'timelineSub')} maxWidth="68.75rem">
        <ProgramTimeline
          layout={timeline}
          filteredOut={notInFlightCount}
          filteredOutHref={notInFlightHref}
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title={t(locale, 'ecosystemDashboard')}
      // Cycle time is a diagnostic rather than a headline, so it is reached from here
      // rather than occupying the column. It is no longer too TALL to be a section —
      // app/ecosystem/cycle-time/page.tsx says what the reason is now (autoknow-7ii).
      actions={
        <KebabMenu ariaLabel={t(locale, 'moreActions')}>
          <Link href="/ecosystem/cycle-time">{t(locale, 'cycleTimeTitle')}</Link>
        </KebabMenu>
      }
      maxWidth="68.75rem"
    >
        {/* answered in time by the capacity chart further down the page */}
        <EcosystemStatStrip
          programs={serializedProjects}
          relationshipScores={relationshipScores}
          now={now}
          openEscalationCount={openEscalationCount}
          activeInitiativeCount={activeInitiativeCount}
        />

        {/* Escalations sit SECOND, directly under the strip (2026-08-03, user call).
            The strip's fourth tile already counts open escalations, so the section
            immediately below it is that tile's detail — the tile says how many, this
            says which — and the most time-sensitive thing on the page stops being the
            last thing read. This costs the capacity chart the fold, which is a decision,
            not a side effect: reading the ramp is considered work, and an open S1 is not.

            Recent activity retired from this page (2026-07-18): the ecosystem page
            is the leadership strip + briefing; activity lives on partner/program
            pages where it has an anchor. This panel is NOT that — it does not
            reopen 2026-07-18's decision. It is a fixed, pre-canned READ of one
            entity (open escalations across the portfolio), the same shape the
            strip tiles above already are, not a stream of everything that happened. */}
        {/* The tint is gated on the SAME emptiness `EscalationRows` renders `emptyLabel`
            for — design.md §1's new exception makes non-emptiness a rule, so if the
            component ever starts filtering its own rows these two must be reconciled
            rather than left to disagree into an alarm panel over "No open escalations." */}
        <section
          className={`${styles.dashboardSection} ${escalations.length > 0 ? styles.escalationsPanel : ''}`}
        >
          <AnchorHeading
            id="escalations"
            actions={
              <KebabMenu ariaLabel={t(locale, 'moreActions')}>
                <Link href="/escalations?status=open">{t(locale, 'escalationsLabel')}</Link>
              </KebabMenu>
            }
          >
            {t(locale, 'escalationsLabel')}
          </AnchorHeading>
          <EscalationRows
            escalations={escalations}
            locale={locale}
            emptyLabel={t(locale, 'escNoOpenEscalations')}
          />
        </section>

        {/* the capacity picture gets the full page width — it's the chart leadership
            actually reads, and hover needs room */}
        <section className={styles.dashboardSection}>
          <CapacityChart
            now={now}
            programs={serializedProjects.map((p) => ({
              id: p.id, name: p.name,
              sopDate: p.sopDate, volumeFirstYear: p.volumeFirstYear, lifecycle: p.lifecycle,
              hasGas: p.hasGas, hasGbi: p.hasGbi, hasDigitalKey: p.hasDigitalKey, hasAap: p.hasAap,
            }))}
          />
        </section>

        {/* What is in flight and when it lands — the question the capacity chart above
            cannot answer, because y is load-bearing there (units) so lateness and start
            cannot be shown at all. Sits under it: same subject, finer grain. */}
        <section className={styles.dashboardSection}>
          <AnchorHeading
            id="timeline"
            actions={
              <KebabMenu ariaLabel={t(locale, 'moreActions')}>
                <Link href="/ecosystem?pop=timeline">{t(locale, 'timelinePop')}</Link>
              </KebabMenu>
            }
          >
            {t(locale, 'timelineTitle')}
          </AnchorHeading>
          <p className={styles.sectionSub}>{t(locale, 'timelineSub')}</p>
          <ProgramTimeline
            layout={timeline}
            filteredOut={notInFlightCount}
            filteredOutHref={notInFlightHref}
          />
        </section>

        {/* Initiatives (gh-286 part h): the cross-partner goals the program views above
            deliberately exclude (decision 5), one row per active initiative. Each row
            reads through getInitiativesList — the SAME loader /initiatives renders — so
            this section and that page cannot disagree about a member's status (the
            summary-count ADR: a summary uses the threshold of the detail it summarizes).
            Zero initiatives is a real state and says so; the section never hides. */}
        <section className={styles.dashboardSection}>
          <AnchorHeading
            id="initiatives"
            actions={
              <KebabMenu ariaLabel={t(locale, 'moreActions')}>
                <Link href="/initiatives">{t(locale, 'navInitiatives')}</Link>
              </KebabMenu>
            }
          >
            {t(locale, 'navInitiatives')}
          </AnchorHeading>
          {initiatives.length === 0 ? (
            <p className={styles.initiativesEmpty}>{t(locale, 'initiativesEmpty')}</p>
          ) : (
            <ul className={styles.initiativeList}>
              {initiatives.map((i) => (
                <li key={i.id} className={styles.initiativeRow}>
                  <Link href={initiativeHref(i.id)}>{i.name}</Link>
                  <span className={styles.initiativeFacts}>
                    <span>
                      {t(locale, i.memberCount === 1 ? 'initiativePartnersOne' : 'initiativePartnersMany', {
                        n: i.memberCount.toLocaleString(locale),
                      })}
                    </span>
                    <span className={styles.initiativeSep}>·</span>
                    <InitiativeDistribution rollup={i.rollup} locale={locale} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* the ecosystem leadership summary — risks/actions first, fully cited */}
        <section className={styles.dashboardSection}>
          <SummaryPanel scope="ecosystem" targetId={0} path="/ecosystem"
            summary={summary} configured={geminiConfigured} />
        </section>
        {serializedProjects.length === 0 ? (
          <section className={styles.dashboardSection}>
            <div className={styles.sectionHeader}>
              <AnchorHeading id="programs-at-risk">
                {t(locale, 'programsAtRisk')}
              </AnchorHeading>
            </div>
            <div className={styles.onboardingBox}>
              <h3>{t(locale, 'welcomeAutoknow')}</h3>
              <p>
                {t(locale, 'onboardingIntro')}
              </p>
              <div className={styles.onboardingOptions}>
                <Link href="/programs/new" className={styles.onboardingBtn}>
                  {t(locale, 'createProjectFromTemplate')}
                </Link>
                <Link href="/admin" className={styles.onboardingBtnSecondary}>
                  {t(locale, 'seedMockDataWalkthrough')}
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <EcosystemDashboardClient now={now}
            initialProjects={serializedProjects}
            busiest={busiest}
          />
        )}
    </PageShell>
  );
}
