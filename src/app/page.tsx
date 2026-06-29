import Link from 'next/link';
import { prisma } from '../lib/db';
import { getEcosystemDashboardData } from '../lib/dashboardData';
import ActionItemsTable from '../components/ActionItemsTable';
import EcosystemDashboardClient from './EcosystemDashboardClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // 1. Fetch real action items from database (filtering out archived projects)
  const dbActionItems = await prisma.actionItem.findMany({
    where: {
      status: 'Pending',
      phase: {
        project: {
          isArchived: false
        }
      }
    },
    include: {
      phase: {
        include: {
          project: {
            include: {
              partner: true
            }
          }
        }
      }
    },
    orderBy: { id: 'desc' }
  });

  const actionItems = dbActionItems.map(item => ({
    id: item.id,
    priority: item.nextStep === 'Googler' ? '🔴 Critical' : '🟡 Warning',
    description: item.description,
    projectId: item.phase.project.id,
    project: item.phase.project.name,
    owner: item.assignedTo || '@unassigned',
    status: item.nextStep
  }));

  // 2. Load the shared dashboard data (projects, forecasts, cycle times, briefings).
  const {
    serializedProjects,
    briefings,
    p85LeadTime,
    people,
    cycleTimeData,
    cycleTimeStats,
  } = await getEcosystemDashboardData();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Ecosystem Dashboard</h1>
      </header>

      <main className={styles.main}>
        {/* Action Items Section */}
        <section className={styles.dashboardSection} style={{ marginBottom: '40px' }}>
          <div className={styles.sectionHeader}>
            <h2>Action Items</h2>
            <span className={styles.countBadge}>{actionItems.length} active blockers</span>
          </div>
          {actionItems.length === 0 ? (
            <div className={styles.emptyActionItemsBox}>
              <p className={styles.emptyText}>No pending action items detected. Clear skies! ☀️</p>
            </div>
          ) : (
            <ActionItemsTable actionItems={actionItems} />
          )}
        </section>

        {serializedProjects.length === 0 ? (
          <section className={styles.dashboardSection}>
            <div className={styles.sectionHeader}>
              <h2>Programs at Risk</h2>
            </div>
            <div className={styles.onboardingBox}>
              <h3>Welcome to AutoKnow 🌱</h3>
              <p>
                This tracker helps teams align on Android Automotive OS integrations, Google Automotive Services, and Digital Key standards. Get started by launching your first program from a standard template:
              </p>
              <div className={styles.onboardingOptions}>
                <Link href="/projects/new" className={styles.onboardingBtn}>
                  ➕ Create Project from Template
                </Link>
                <Link href="/admin" className={styles.onboardingBtnSecondary}>
                  ⚙️ Seed Mock Data (Walkthrough Mode)
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
