import Link from 'next/link';
import EcosystemStats from '../components/EcosystemStats';
import SummaryPanel from '../components/SummaryPanel';
import { getSummary } from '../lib/summaries';
import { geminiConfigured } from '../lib/gemini';
import CapacityChart from '../components/CapacityChart';
import HighRiskPrograms from '../components/HighRiskPrograms';
import { getEcosystemDashboardData } from '../lib/dashboardData';
import { getLocale } from '../lib/locale';
import { t } from '../lib/i18n';
import EcosystemDashboardClient from './EcosystemDashboardClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const locale = await getLocale();
  const summary = await getSummary('ecosystem', 0);

  // 2. Load the shared dashboard data (projects, forecasts, cycle times, briefings).
  const {
    serializedProjects,
    briefings,
    p85LeadTime,
    people,
    cycleTimeData,
    cycleTimeStats,
  } = await getEcosystemDashboardData();

  // Snapshot "now" server-side so SSR and hydration agree.
  const now = Date.now();
  const activeCount = serializedProjects.filter((p) => !p.isArchived && p.hillChartProgress < 100).length;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{t(locale, 'ecosystemDashboard')}</h1>
      </header>

      <main className={styles.main}>
        {/* the leadership strip, in reading order: what threatens capacity first,
            then when capacity lands (with/without GAS), then how many programs */}
        <section className={styles.dashboardSection}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '28px 48px', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 340px', minWidth: 300, maxWidth: 460 }}>
            <HighRiskPrograms now={now} programs={serializedProjects} />
          </div>
          <div style={{ flex: '1 1 300px', minWidth: 280, maxWidth: 420 }}>
            <CapacityChart
              now={now}
              programs={serializedProjects.map((p) => ({
                id: p.id, name: p.name,
                sopDate: p.sopDate, volumeFirstYear: p.volumeFirstYear, hasGas: p.hasGas, isArchived: p.isArchived,
              }))}
            />
          </div>
          <EcosystemStats activeCount={activeCount} allTimeCount={serializedProjects.length} />
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
          <EcosystemDashboardClient cycleTimeData={cycleTimeData} cycleTimeStats={cycleTimeStats}
            initialProjects={serializedProjects}
            briefings={briefings}
            p85LeadTime={p85LeadTime}
            people={people}
          />
        )}
      </main>
    </div>
  );
}
