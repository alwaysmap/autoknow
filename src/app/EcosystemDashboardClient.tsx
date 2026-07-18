'use client';

import DateCell from '../components/DateCell';
import Link from 'next/link';
import DataTable from '../components/DataTable';

import styles from './ecosystem-summary/EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../lib/needle';
import { NeedleGaugeSvg } from '../components/NeedleGauge';
import { sopOutlook } from '../lib/sop';
import { deriveProgramStatus, visibleInLists } from '../lib/lifecycle';
import { healthKey, healthOrder } from '../lib/health';
import { t } from '../lib/i18n';
import { useLocale } from '../components/LocaleProvider';

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  ownerName: string | null;
  volumeFirstYear: number;
  latestNote: string | null;
  chainRemainingDays: number;
  lifecycle: string;
  partner: {
    id: number;
    name: string;
  };
  phases: {
    id: number;
    name: string;
    states: {
      status: string;
      theNeedle: string | null;
      hillChartProgress: number | null;
    }[];
  }[];
  forecast: {
    remainingPhases: number;
    sim: {
      p50: number;
      p85: number;
      p95: number;
    };
  };
}

interface EcosystemDashboardClientProps {
  now: number;
  initialProjects: Project[];
}

export default function EcosystemDashboardClient({
  now,
  initialProjects,
}: EcosystemDashboardClientProps) {
  const locale = useLocale();

  // The fixed risk view: active programs (not archived, not done) at Some Risk or
  // worse. No filter chrome here — the URL-shareable /programs table is the place
  // for ad-hoc slicing.
  const filteredProjects = initialProjects
    .filter((proj) => visibleInLists(proj) && deriveProgramStatus(proj) === 'Active' && healthOrder(proj.theNeedle) >= 1)
    // risk-first reading order: worst health on top, least-progressed breaking ties
    .sort((a, b) => healthOrder(b.theNeedle) - healthOrder(a.theNeedle) || a.hillChartProgress - b.hillChartProgress);

  return (
    <div className={styles.clientWrapper}>
      {/* Filter panel + leader alert removed (2026-07-18, user call): the table
          below IS the risk view — floored at Some Risk, active programs only. */}

      {/* Scorecard strip removed (2026-07-18, user call) — the numbers the
          leadership strip and table don't already carry added noise, not signal. */}


      {/* Cycle-time point chart removed (2026-07-18, user call) — phase duration
          diagnostics live on the ecosystem-summary page if needed again. */}

      {/* SOP timeline chart removed entirely (2026-07-18, user call): redundant
          with the capacity chart's quarter drill-down + the sortable Target SOP
          column below. */}

      {/* Main Database Table */}
      <section className={styles.tableSection}>
        <h2>{t(locale, 'programsAtRisk')}</h2>
        <DataTable
          headers={[
            { key: 'name', label: t(locale, 'programName') },
            { key: 'sopDate', label: t(locale, 'targetSopHeader') },
            { key: 'volumeFirstYear', label: t(locale, 'targetVolume') },
            { key: 'theNeedle', label: t(locale, 'healthLabel') },
            { key: 'forecast', label: t(locale, 'forecastLabel') },
            { key: 'latestNote', label: t(locale, 'latestUpdate'), sortable: false }
          ]}
          data={filteredProjects}
          renderRow={(p: Project) => {
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/programs/${p.id}`} className={styles.tableLink}>
                    {p.name}
                  </Link>
                </td>
                <td><DateCell value={p.sopDate} fallback={t(locale, 'tbd')} /></td>
                <td>{t(locale, 'unitsCount', { n: p.volumeFirstYear.toLocaleString(locale) })}</td>
                <td>
                  {/* ONE small needle carries health (color) + progress (angle) */}
                  <div style={{ width: 72 }}
                    title={`${t(locale, healthKey(formatNeedleValue(p.theNeedle)))} · ${p.hillChartProgress}%`}>
                    <NeedleGaugeSvg progress={p.hillChartProgress} health={p.theNeedle} />
                  </div>
                </td>
                <td>
                  {/* Outlook from the REAL critical chain vs the SOP target — the
                      Monte Carlo placeholder (normal(12,4) per phase, blind to actual
                      plans) said "+16 days likely" on nearly every row. */}
                  {(() => {
                    if (!p.sopDate) return <span className={styles.finishedText}>{t(locale, 'tbd')}</span>;
                    if (p.hillChartProgress >= 100) return <span className={styles.finishedText}>{t(locale, 'finishedLabel')}</span>;
                    const { slackDays, onTrack } = sopOutlook(p.chainRemainingDays, p.sopDate, now);
                    return onTrack
                      ? <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{t(locale, 'slackWeeks', { n: Math.floor(slackDays / 7) })}</span>
                      : <span className={styles.forecastText} style={{ color: '#b06000' }}>{t(locale, 'lateByWeeks', { n: Math.ceil(-slackDays / 7) })}</span>;
                  })()}
                </td>
                <td>
                  {p.latestNote
                    ? <span className={styles.noteClamp} title={p.latestNote}>{p.latestNote}</span>
                    : <span className={styles.finishedText}>—</span>}
                </td>
              </tr>
            );
          }}
          defaultSortKey="" // pre-sorted by risk, then progress; headers re-sort
          pageSize={10}
          emptyStateMessage={t(locale, 'noProgramsMatchFilters')}
        />
      </section>

    </div>
  );
}
