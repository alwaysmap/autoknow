'use client';

import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './ProjectStatusDashboard.module.css';
import NeedleGauge from './NeedleGauge';

interface ProjectStatusDashboardProps {
  projectId: number;
  currentNeedle: string; // program health
  currentHillChartProgress: number; // program progress (needle position)
  previousProgress?: number | null;
  previousHealth?: string | null;
  updatedAt?: string | null;
}

export default function ProjectStatusDashboard({
  projectId,
  currentNeedle,
  currentHillChartProgress,
  previousProgress,
  previousHealth,
  updatedAt,
}: ProjectStatusDashboardProps) {
  const locale = useLocale();

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

        {/* The phase hill summary lives in the Phases section at full content
            width (PhaseTrack) — the sidebar carries only the program needle. */}
      </div>
    </section>
  );
}
