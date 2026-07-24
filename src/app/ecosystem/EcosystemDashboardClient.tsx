'use client';

import DateCell from '../../components/DateCell';
import Link from 'next/link';
import DataTable from '../../components/DataTable';

import styles from '../ecosystem-summary/EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../../lib/needle';
import { NeedleGaugeSvg } from '../../components/NeedleGaugeSvg';
import SopOutlookCell from '../../components/SopOutlookCell';
import { deriveProgramStatus, visibleInLists } from '../../lib/lifecycle';
import { healthKey, healthOrder } from '../../lib/health';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import BusiestResources from '../../components/BusiestResources';
import type { BusiestRow } from '../../lib/chainLedger';
import AnchorHeading from '../../components/AnchorHeading';

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
}

interface EcosystemDashboardClientProps {
  now: number;
  initialProjects: Project[];
  busiest?: BusiestRow[];
}

export default function EcosystemDashboardClient({
  now,
  initialProjects,
  busiest = [],
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

      {/* Cross-portfolio constraint resources — who several SOPs are waiting on */}
      <BusiestResources locale={locale} rows={busiest} />

      {/* Main Database Table */}
      <section className={styles.tableSection}>
        <AnchorHeading id="programs-at-risk" linkLabel={t(locale, 'anchorLink')}>
          {t(locale, 'programsAtRisk')}
        </AnchorHeading>
        <DataTable
          headers={[
            { key: 'name', label: t(locale, 'programName') },
            { key: 'sopDate', label: t(locale, 'targetSopHeader') },
            { key: 'volumeFirstYear', label: t(locale, 'targetVolume') },
            { key: 'theNeedle', label: t(locale, 'healthLabel') },
            { key: 'chainRemainingDays', label: t(locale, 'sopOutlookHeader') },
            { key: 'latestNote', label: t(locale, 'latestUpdate'), sortable: false }
          ]}
          data={filteredProjects}
          renderRow={(p: Project) => {
            return (
              <tr key={p.id}>
                <th scope="row">
                  <Link href={`/programs/${p.id}`} className={styles.tableLink}>
                    {p.name}
                  </Link>
                </th>
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
                  <SopOutlookCell
                    chainRemainingDays={p.chainRemainingDays}
                    sopDate={p.sopDate}
                    hillChartProgress={p.hillChartProgress}
                    now={now}
                    locale={locale}
                  />
                </td>
                <td>
                  {p.latestNote
                    ? <span className={styles.noteClamp} title={p.latestNote}>{p.latestNote}</span>
                    : <span className={styles.emptyCell}>—</span>}
                </td>
              </tr>
            );
          }}
          defaultSortKey="" // pre-sorted by risk, then progress; headers re-sort
          emptyStateMessage={t(locale, 'noProgramsMatchFilters')}
        />
      </section>

    </div>
  );
}
