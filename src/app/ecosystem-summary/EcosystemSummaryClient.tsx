'use client';

import DateCell from '../../components/DateCell';
import { useState } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import styles from './EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../../lib/needle';
import SopOutlookCell from '../../components/SopOutlookCell';
import type { LiveConstraint } from '../../lib/dashboardData';
import { healthKey, healthColor, healthOrder } from '../../lib/health';
import { resolvePerson } from '../../lib/people';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import AnchorHeading from '../../components/AnchorHeading';
import PageShell from '../../components/PageShell';

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  ownerName: string | null;
  volumeFirstYear: number;
  /** Remaining days along the REAL critical chain — the on-track signal vs SOP. */
  chainRemainingDays: number;
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

interface Person {
  id: number;
  name: string;
  email: string;
}

interface EcosystemSummaryClientProps {
  liveConstraints: LiveConstraint[];
  /** Funnel selections restored from the query string (design.md §2). */
  initialFilters?: Record<string, string[]>;
  initialTableSort?: TableSort | null;
  /** Snapshotted server-side so SSR and hydration agree (see the page). */
  now: number;
  initialProjects: Project[];
  people: Person[];
}

export default function EcosystemSummaryClient({
  initialProjects,
  people,
  liveConstraints,
  now,
  initialFilters,
  initialTableSort = null
}: EcosystemSummaryClientProps) {
  const locale = useLocale();
  // Filtering is the shared table grammar now (#95): Health and Owner are in-header
  // funnels like every other listing, and the state round-trips through the URL. The
  // panel this replaces was a health-floor slider, an owner <select>, and a draggable
  // mini hill chart for a progress band — the last bespoke filter surface in the app.
  // The progress band was RETIRED rather than converged: a funnel is a checklist of
  // distinct values and cannot express "between 20% and 60%", and the band did not earn
  // a one-off control. Progress stays a sortable column.
  const [filters, setFilters] = useState<Record<string, string[]>>(initialFilters ?? {});
  const [sort, setSort] = useState<TableSort | null>(initialTableSort);
  useTableUrlSync(filters, sort);

  // DataTable owns the filtering; this stays the unfiltered set it filters from.
  const filteredProjects = initialProjects;

  // Calculate high level dashboard aggregations
  const criticalCount = filteredProjects.filter(p => healthOrder(p.theNeedle) >= 1).length;

  return (
    <PageShell title={t(locale, 'ecosystemSummary')}>
      <div className={styles.clientWrapper}>

      {/* Visual Stuck / Critical Blockers Alerts */}
      {criticalCount > 0 && (
        <div className={styles.blockerAlert}>
          <strong>{t(locale, 'attentionLeaders')}</strong> {t(locale, 'flaggedPrograms', { n: criticalCount })}
        </div>
      )}
      {/* Ecosystem flow constraints diagnosis */}
      <section className={styles.constraintDiagnosis}>
        <div className={styles.diagnosisHeader}>
          <h3>{t(locale, 'flowConstraintDiagnosis')}</h3>
          <span className={styles.diagnosisSub}>{t(locale, 'flowConstraintSub')}</span>
        </div>
        {liveConstraints.length === 0 ? (
          <p className={styles.diagnosisEmpty}>{t(locale, 'noLiveConstraints')}</p>
        ) : (
          <DataTable
            headers={[
              { key: 'phaseName', label: t(locale, 'phaseLabel') },
              // Neither sorts: both derive from the same count, so two sort controls
              // would do one job, and the rows already arrive most-blocking first. The
              // `status` names no field on LiveConstraint: with `sortable: false` and no
              // funnel the key is React identity only. It becomes a live row path the
              // moment someone makes this column sortable or filterable — change it then.
              { key: 'programs', label: t(locale, 'clGatingSop'), sortable: false },
              { key: 'status', label: t(locale, 'statusLabel'), sortable: false },
            ]}
            data={liveConstraints}
            paginate={false}
            // Empty: keep the most-blocking-first order dashboardData already applied.
            defaultSortKey=""
            renderRow={(c: LiveConstraint) => {
              // Gating more than one live SOP is what makes a phase *primary*; a phase
              // gating one is still genuinely on a chain, just not the leverage point.
              const isPrimary = c.programs.length > 1;
              return (
                <tr key={c.phaseName} className={isPrimary ? styles.constraintHighlight : undefined}>
                  <th scope="row">{c.phaseName}</th>
                  <td>
                    {isPrimary
                      ? t(locale, 'gatingNPrograms', { n: c.programs.length })
                      : t(locale, 'gatingOneProgram')}
                    <div className={styles.constraintPrograms}>
                      {c.programs.map((prog, i) => (
                        <span key={prog.id}>
                          {i > 0 && ', '}
                          <Link href={`/programs/${prog.id}`}>{prog.name}</Link>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={isPrimary ? styles.badgeDanger : styles.badgeWarn}>
                      {t(locale, isPrimary ? 'primaryConstraint' : 'onCriticalChain')}
                    </span>
                  </td>
                </tr>
              );
            }}
          />
        )}
      </section>

      {/* Active Implementation Pipelines */}
      <section className={styles.tableSection}>
        <AnchorHeading id="lifecycle-launches" linkLabel={t(locale, 'anchorLink')}>
          {t(locale, 'programLifecycleLaunches')}
        </AnchorHeading>
        <DataTable
          headers={[
            { key: 'partner.name', label: t(locale, 'partnerLabel') },
            { key: 'name', label: t(locale, 'programLabel') },
            { key: 'ownerName', label: t(locale, 'ownerLabel'), filterable: true },
            { key: 'sopDate', label: t(locale, 'sopDate') },
            { key: 'volumeFirstYear', label: t(locale, 'volume12m') },
            {
              key: 'theNeedle', label: t(locale, 'healthLabel'), filterable: true,
              // Canonicalize legacy values so "Low"/"On Track" collapse to one option —
              // same treatment as /programs, which this now matches.
              filterValue: (row) => formatNeedleValue((row as Project).theNeedle),
              filterLabel: (v) => t(locale, healthKey(v)),
            },
            { key: 'hillChartProgress', label: t(locale, 'hillChartHeader') },
            { key: 'chainRemainingDays', label: t(locale, 'sopOutlookHeader') }
          ]}
          data={filteredProjects}
          filters={filters}
          onFiltersChange={setFilters}
          onSortChange={(key, dir) => setSort({ key, dir })}
          renderRow={(p: Project) => {
            const isEarlyStage = p.hillChartProgress <= 50;
            return (
              <tr key={p.id} className={isEarlyStage ? styles.earlyRow : ''}>
                <th scope="row">
                  <Link href={`/partners/${p.partner.id}`}>
                    {p.partner.name}
                  </Link>
                </th>
                <td>
                  <strong>
                    <Link href={`/programs/${p.id}`} className={styles.link}>
                      {p.name}
                    </Link>
                  </strong>
                  {isEarlyStage && <span className={styles.earlyBadge}>{t(locale, 'earlyStage')}</span>}
                </td>
                <td>
                  {(() => {
                    if (!p.ownerName) return t(locale, 'unassigned');
                    const matched = resolvePerson(people, p.ownerName);
                    if (matched) {
                      return (
                        <Link href={`/people/${matched.id}`} className={styles.ownerLink}>
                          {p.ownerName}
                        </Link>
                      );
                    }
                    return p.ownerName;
                  })()}
                </td>
                <td><DateCell value={p.sopDate} fallback={t(locale, 'tbd')} /></td>
                <td>{t(locale, 'unitsCount', { n: p.volumeFirstYear.toLocaleString(locale) })}</td>
                <td>
                  {(() => {
                    const label = formatNeedleValue(p.theNeedle);
                    return (
                      <button
                        type="button"
                        onClick={() => setFilters((f) => ({ ...f, theNeedle: [label] }))}
                        className={styles.badgeFilterBtn}
                        title={t(locale, 'filterHealthTitle', { h: t(locale, healthKey(label)) })}
                      >
                        <span className={styles.badge} style={{ color: healthColor(label) }}>
                          {t(locale, healthKey(label))}
                        </span>
                      </button>
                    );
                  })()}
                </td>
                <td>
                  <div className={styles.progressCell}>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressBar}
                        style={{ width: `${p.hillChartProgress}%` }}
                      />
                    </div>
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
              </tr>
            );
          }}
          defaultSortKey="name"
          emptyStateMessage={t(locale, 'noProgramsMatchFilters')}
        />
      </section>

      </div>
    </PageShell>
  );
}
