import Link from 'next/link';
import EcosystemStats from '../components/EcosystemStats';
import SopRiskStat from '../components/SopRiskStat';
import RelationshipMix from '../components/RelationshipMix';
import SummaryPanel from '../components/SummaryPanel';
import { getSummary } from '../lib/summaries';
import { geminiConfigured } from '../lib/gemini';
import CapacityChart from '../components/CapacityChart';
import { getEcosystemDashboardData, getPartnerRelationshipScores } from '../lib/dashboardData';
import { getLocale } from '../lib/locale';
import { t } from '../lib/i18n';
import EcosystemDashboardClient from './EcosystemDashboardClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const locale = await getLocale();
  const summary = await getSummary('ecosystem', 0);

  // 2. Load the shared dashboard data (projects, forecasts, cycle times, briefings,
  //    the ecosystem chain busiest-resources roll-up) plus the partner relationship
  //    scores the mix tile reads.
  const [{ serializedProjects, busiest }, relationshipScores] = await Promise.all([
    getEcosystemDashboardData(),
    getPartnerRelationshipScores(),
  ]);

  // Snapshot "now" server-side so SSR and hydration agree. This is an async Server
  // Component — Date.now() runs once per request on the server, not on every client
  // render, so the react-hooks purity rule (which assumes client re-render) is a
  // false positive here.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const activeCount = serializedProjects.filter((p) => !p.isArchived && p.hillChartProgress < 100).length;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{t(locale, 'ecosystemDashboard')}</h1>
      </header>

      <main className={styles.main}>
        {/* the leadership strip, in reading order: how much work is in flight, how
            much of it is slipping its SOP, and how healthy the partner book carrying
            it is — the three questions the capacity chart below then answers in time */}
        <section className={styles.statStrip}>
          <EcosystemStats activeCount={activeCount} allTimeCount={serializedProjects.length} />
          <SopRiskStat now={now} programs={serializedProjects} />
          <RelationshipMix scores={relationshipScores} />
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
          <SummaryPanel scope="ecosystem" targetId={0} path="/"
            summary={summary} configured={geminiConfigured} />
        </section>
        {/* Recent activity retired from this page (2026-07-18): the ecosystem page
            is the leadership strip + briefing; activity lives on partner/program
            pages where it has an anchor. */}

        {serializedProjects.length === 0 ? (
          <section className={styles.dashboardSection}>
            <div className={styles.sectionHeader}>
              <h2>{t(locale, 'programsAtRisk')}</h2>
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
      </main>
    </div>
  );
}
