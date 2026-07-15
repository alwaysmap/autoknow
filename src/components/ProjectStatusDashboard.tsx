'use client';

import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './ProjectStatusDashboard.module.css';
import NeedleGauge from './NeedleGauge';
import PhaseHillChart, { type PhaseDot } from './PhaseHillChart';

interface PhaseInput {
  id: number;
  name: string;
  states: { status: string; hillChartProgress: number | null }[];
}

interface ProjectStatusDashboardProps {
  projectId: number;
  currentNeedle: string; // program health
  currentHillChartProgress: number; // program progress (needle position)
  previousProgress?: number | null;
  previousHealth?: string | null;
  updatedAt?: string | null;
  phases: PhaseInput[];
}

export default function ProjectStatusDashboard({
  projectId,
  currentNeedle,
  currentHillChartProgress,
  previousProgress,
  previousHealth,
  updatedAt,
  phases,
}: ProjectStatusDashboardProps) {
  const locale = useLocale();

  const phaseDots: PhaseDot[] = phases.map((p) => ({
    id: p.id,
    name: p.name,
    progress: p.states[0]?.hillChartProgress ?? 0,
    status: p.states[0]?.status ?? 'Not Started',
  }));

  return (
    <section className={styles.summaryDashboard}>
      <div className={styles.summaryTopRow}>
        {/* Program Needle: progress (position) + health (color) */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>{t(locale, 'progressHealth')}</div>
          <NeedleGauge
            progress={currentHillChartProgress}
            health={currentNeedle}
            previousProgress={previousProgress}
            previousHealth={previousHealth}
            updatedAt={updatedAt}
            targetId={projectId}
            scope="project"
          />
        </div>

        {/* Phase progress: a dot per phase on the hill */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>{t(locale, 'phasesCard')}</div>
          <PhaseHillChart phases={phaseDots} />
        </div>

      </div>
    </section>
  );
}
