import Link from 'next/link';
import EcosystemStatStrip from '../../components/EcosystemStatStrip';
import SummaryPanel from '../../components/SummaryPanel';
import { getSummary } from '../../lib/summaries';
import { geminiConfigured } from '../../lib/gemini';
import CapacityChart from '../../components/CapacityChart';
import { getEcosystemDashboardData, getPartnerRelationshipScores } from '../../lib/dashboardData';
import { getEcosystemEscalations, getOpenEscalationsCount } from '../../lib/escalationQueries';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import EcosystemDashboardClient from './EcosystemDashboardClient';
import EscalationRows from '../../components/EscalationRows';
import styles from './page.module.css';
import AnchorHeading from '../../components/AnchorHeading';
import KebabMenu from '../../components/KebabMenu';
import PageShell from '../../components/PageShell';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const locale = await getLocale();
  const summary = await getSummary('ecosystem', 0);

  // 2. Load the shared dashboard data (projects, forecasts, cycle times, briefings,
  //    the ecosystem chain busiest-resources roll-up) plus the partner relationship
  //    scores the mix tile reads.
  const [{ serializedProjects, busiest }, relationshipScores, openEscalationCount, escalations] = await Promise.all([
    getEcosystemDashboardData(),
    getPartnerRelationshipScores(),
    getOpenEscalationsCount(),
    getEcosystemEscalations(),
  ]);

  // Snapshot "now" server-side so SSR and hydration agree. This is an async Server
  // Component — Date.now() runs once per request on the server, not on every client
  // render, so the react-hooks purity rule (which assumes client re-render) is a
  // false positive here.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <PageShell title={t(locale, 'ecosystemDashboard')} maxWidth="68.75rem">
        {/* answered in time by the capacity chart further down the page */}
        <EcosystemStatStrip
          programs={serializedProjects}
          relationshipScores={relationshipScores}
          now={now}
          openEscalationCount={openEscalationCount}
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
            linkLabel={t(locale, 'anchorLink')}
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

        {/* the ecosystem leadership summary — risks/actions first, fully cited */}
        <section className={styles.dashboardSection}>
          <SummaryPanel scope="ecosystem" targetId={0} path="/ecosystem"
            summary={summary} configured={geminiConfigured} />
        </section>
        {serializedProjects.length === 0 ? (
          <section className={styles.dashboardSection}>
            <div className={styles.sectionHeader}>
              <AnchorHeading id="programs-at-risk" linkLabel={t(locale, 'anchorLink')}>
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
