import Link from 'next/link';
import ActivityFeed from '../components/ActivityFeed';
import UnifiedSearch from '../components/UnifiedSearch';
import EcosystemStats from '../components/EcosystemStats';
import CapacityChart from '../components/CapacityChart';
import HighRiskPrograms from '../components/HighRiskPrograms';
import { getActivity } from '../lib/activity';
import { getEcosystemDashboardData } from '../lib/dashboardData';
import { getLocale } from '../lib/locale';
import { t } from '../lib/i18n';
import EcosystemDashboardClient from './EcosystemDashboardClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const locale = await getLocale();
  // Ecosystem-wide activity — the same content /activity renders: ingested context
  // + program/needle/hill/phase changes, merged chronologically.
  const events = await getActivity({ kind: 'ecosystem' });

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
          style={{ marginBottom: '40px', display: 'flex', flexWrap: 'wrap', gap: '28px 48px', alignItems: 'flex-start' }}>
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
        {/* Ecosystem activity — mirrors the /activity page (the retired Action Items
            table lived here; updates now flow through needle/hill notes + ingest) */}
        <section className={styles.dashboardSection} style={{ marginBottom: '40px' }}>
          <div className={styles.sectionHeader}>
            <h2>{t(locale, 'recentActivity')}</h2>
          </div>
          <section style={{ marginBottom: 20 }}>
            {/* the feed's own filter chips sit directly below — no second chip row */}
            <UnifiedSearch placeholder={t(locale, 'searchAllAutoknow')} showTypeChips={false} />
          </section>
          <ActivityFeed items={events} deletable revalidate="/" />
        </section>

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
