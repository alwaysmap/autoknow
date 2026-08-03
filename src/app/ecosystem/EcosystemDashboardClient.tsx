'use client';

import DateCell from '../../components/DateCell';
import Link from 'next/link';
import DataTable from '../../components/DataTable';

import styles from '../ecosystem-summary/EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../../lib/needle';
import { NeedleGaugeSvg } from '../../components/NeedleGaugeSvg';
import SopOutlookCell from '../../components/SopOutlookCell';
import { deriveProgramStatus, visibleInLists } from '../../lib/lifecycle';
import { healthKey, parseHealth } from '../../lib/health';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import BusiestResources from '../../components/BusiestResources';
import type { BusiestRow } from '../../lib/chainLedger';
import type { PersonRef } from '../../components/PersonCell';
import AnchorHeading from '../../components/AnchorHeading';

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  /** Mirrors `DashboardProject.owner` — the FK-resolved owner (#127 E7), not the
   *  legacy `ownerName` text. This dashboard does not render it; the field stays so
   *  the local mirror of the payload does not quietly disagree with the loader. */
  owner: PersonRef | null;
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

  // The fixed risk view: active programs (not archived, not done) whose CURRENT
  // health is Concerned — the worst state, not "Some Risk or worse". No filter
  // chrome here — the URL-shareable /programs table is the place for ad-hoc
  // slicing, and it still floors at Some Risk.
  const filteredProjects = initialProjects
    .filter((proj) => visibleInLists(proj) && deriveProgramStatus(proj) === 'Active' && parseHealth(proj.theNeedle) === 'Concerned')
    // every row is Concerned, so health can no longer order them: least-progressed
    // on top, because that is the one furthest from getting out of trouble
    .sort((a, b) => a.hillChartProgress - b.hillChartProgress);

  return (
    <div className={styles.clientWrapper}>
      {/* Filter panel + leader alert removed (2026-07-18, user call): the table
          below IS the risk view — active programs currently Concerned. */}

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
          defaultSortKey="" // pre-sorted by progress (health no longer varies); headers re-sort
          emptyStateMessage={t(locale, 'noCurrentConcerns')}
        />
      </section>

    </div>
  );
}
