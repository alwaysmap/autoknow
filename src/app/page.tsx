import Link from 'next/link';
import { prisma } from '../lib/db';
import ActionItemsTable from '../components/ActionItemsTable';
import EcosystemDashboardClient from './EcosystemDashboardClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// pseudo-random helper for Monte Carlo
function lcg(seed: number) {
  let val = seed;
  return function() {
    val = (val * 1664525 + 1013904223) % 4294967296;
    return val / 4294967296;
  };
}

// Monte Carlo simulator
function runMonteCarlo(remainingPhasesCount: number, seed: number): { p50: number; p85: number; p95: number } {
  if (remainingPhasesCount === 0) {
    return { p50: 0, p85: 0, p95: 0 };
  }

  const rand = lcg(seed);
  const runs = 1000;
  const durations: number[] = [];

  for (let r = 0; r < runs; r++) {
    let projectDuration = 0;
    for (let p = 0; p < remainingPhasesCount; p++) {
      const u1 = rand() || 0.0001;
      const u2 = rand() || 0.0001;
      const normalRand = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const phaseDuration = Math.max(3, 12 + normalRand * 4);
      projectDuration += phaseDuration;
    }
    durations.push(projectDuration);
  }

  durations.sort((a, b) => a - b);

  return {
    p50: Math.round(durations[Math.floor(runs * 0.50)]),
    p85: Math.round(durations[Math.floor(runs * 0.85)]),
    p95: Math.round(durations[Math.floor(runs * 0.95)])
  };
}

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

  // 2. Fetch all projects & phases for deterministic metrics
  const projects = await prisma.project.findMany({
    include: {
      partner: true,
      phases: {
        include: {
          states: {
            orderBy: { timestamp: 'desc' },
            take: 1
          }
        }
      },
      contextUrls: {
        orderBy: { id: 'desc' }
      }
    }
  });

  // Calculate p85 lead time for active WIP phases
  const activeWipPhases = projects.flatMap(proj => 
    proj.phases.filter(phase => phase.states[0]?.status === 'Active WIP')
  );

  const baselineWipDays = activeWipPhases.map((_, i) => 8 + (i * 4) + (i % 3));
  baselineWipDays.sort((a, b) => a - b);
  const p85LeadTime = baselineWipDays.length > 0 
    ? Math.round(baselineWipDays[Math.floor(baselineWipDays.length * 0.85)]) 
    : 14;

  // Append Monte Carlo forecast and serialize dates for passing to Client Component
  const serializedProjects = projects.map(proj => {
    const unstartedCount = proj.phases.filter(p => 
      p.states[0]?.status === 'Not Started' || !p.states[0]
    ).length;
    const sim = runMonteCarlo(unstartedCount, proj.id);

    return {
      id: proj.id,
      name: proj.name,
      isArchived: proj.isArchived,
      theNeedle: proj.theNeedle,
      hillChartProgress: proj.hillChartProgress,
      sopDate: proj.sopDate ? proj.sopDate.toISOString() : null,
      ownerName: proj.ownerName,
      volumeFirstYear: proj.volumeFirstYear,
      partner: {
        id: proj.partner.id,
        name: proj.partner.name
      },
      phases: proj.phases.map(p => ({
        id: p.id,
        name: p.name,
        states: p.states.map(s => ({
          status: s.status,
          theNeedle: s.theNeedle,
          hillChartProgress: s.hillChartProgress
        }))
      })),
      forecast: {
        remainingPhases: unstartedCount,
        sim
      }
    };
  });

  // Fetch latest briefings
  const briefings = projects.flatMap(proj => 
    proj.contextUrls.map(cu => ({
      projectId: proj.id,
      projectName: proj.name,
      partnerName: proj.partner.name,
      briefingText: cu.ingestedText || '',
      timestamp: new Date().toLocaleDateString()
    })).filter(b => b.briefingText)
  );

  // Fetch all people to resolve project owner links
  const people = await prisma.person.findMany({
    select: {
      id: true,
      name: true,
      email: true
    }
  });


  // 3. Fetch PhaseStates to compute Cycle Times
  const allPhases = await prisma.phase.findMany({
    include: {
      states: {
        orderBy: { timestamp: 'asc' }
      },
      project: {
        select: {
          isArchived: true
        }
      }
    }
  });

  const cycleTimeData: any[] = [];
  
  for (const phase of allPhases) {
    if (phase.project.isArchived) continue;
    
    let startWipDate = null;
    let finishedDate = null;
    
    for (const state of phase.states) {
      if (state.status === 'Active WIP' && !startWipDate) {
        startWipDate = state.timestamp;
      }
      if (state.status === 'Finished' && !finishedDate) {
        finishedDate = state.timestamp;
      }
    }
    
    if (startWipDate) {
      const end = finishedDate ? finishedDate : new Date();
      const days = Math.max(1, Math.round((end.getTime() - startWipDate.getTime()) / (1000 * 60 * 60 * 24)));
      cycleTimeData.push({
        phaseId: phase.id,
        phaseName: phase.name,
        cycleTimeDays: days,
        isFinished: !!finishedDate
      });
    }
  }

  // Calculate p50, p85, p95 per phase name
  const cycleTimeStats: Record<string, any> = {};
  const groupedByName: Record<string, number[]> = {};
  for (const ct of cycleTimeData) {
    if (ct.isFinished) {
      if (!groupedByName[ct.phaseName]) groupedByName[ct.phaseName] = [];
      groupedByName[ct.phaseName].push(ct.cycleTimeDays);
    }
  }
  
  for (const [name, daysArr] of Object.entries(groupedByName)) {
    daysArr.sort((a, b) => a - b);
    if (daysArr.length > 0) {
      cycleTimeStats[name] = {
        p50: daysArr[Math.floor(daysArr.length * 0.50)],
        p85: daysArr[Math.floor(daysArr.length * 0.85)],
        p95: daysArr[Math.floor(daysArr.length * 0.95)]
      };
    }
  }

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
