'use client';

import DateCell from '../../components/DateCell';
import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import styles from './EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../../lib/needle';
import SopOutlookCell from '../../components/SopOutlookCell';
import type { LiveConstraint } from '../../lib/dashboardData';
import { HEALTHS, HEALTH_KEY, healthKey, healthColor, healthOrder } from '../../lib/health';
import { resolvePerson } from '../../lib/people';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
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
  /** Snapshotted server-side so SSR and hydration agree (see the page). */
  now: number;
  initialProjects: Project[];
  people: Person[];
}

export default function EcosystemSummaryClient({
  initialProjects,
  people,
  liveConstraints,
  now
}: EcosystemSummaryClientProps) {
  const locale = useLocale();
  const [minRiskVal, setMinRiskVal] = useState(0); // 0=Low, 1=Medium, 2=High, 3=Critical
  const [selectedOwner, setSelectedOwner] = useState('All');
  const [minProgress, setMinProgress] = useState(0);
  const [maxProgress, setMaxProgress] = useState(100);
  const [activeDrag, setActiveDrag] = useState<'min' | 'max' | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  // Drag coordinates listeners
  useEffect(() => {
    if (activeDrag === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      let p = Math.round(((x - 5) / 90) * 100);
      p = Math.max(0, Math.min(100, p));
      p = Math.round(p / 5) * 5; // Snap to 5% intervals

      if (activeDrag === 'min') {
        setMinProgress(Math.min(p, maxProgress));
      } else if (activeDrag === 'max') {
        setMaxProgress(Math.max(p, minProgress));
      }
    };

    const handleMouseUp = () => {
      setActiveDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeDrag, minProgress, maxProgress]);

  // Extract unique program owners
  const owners = ['All', ...Array.from(new Set(initialProjects.map(p => p.ownerName).filter(Boolean))) as string[]];

  // Helper check to determine if project matches progress range
  const matchesProgressRange = (proj: Project) => {
    return proj.hillChartProgress >= minProgress && proj.hillChartProgress <= maxProgress;
  };

  // Filter projects
  const filteredProjects = initialProjects.filter(proj => {
    // 1. Filter by program Health (On Track / Some Risk / Concerned)
    const riskVal = healthOrder(proj.theNeedle);
    if (riskVal < minRiskVal) return false;

    // 2. Filter by Googler Program Owner
    if (selectedOwner !== 'All' && proj.ownerName !== selectedOwner) {
      return false;
    }

    // 3. Filter by Progress Range
    if (!matchesProgressRange(proj)) {
      return false;
    }

    return true;
  });

  // Calculate high level dashboard aggregations
  const criticalCount = filteredProjects.filter(p => healthOrder(p.theNeedle) >= 1).length;

  // Build highlighted segment path for the mini Hill Chart preview
  const miniHighlightPath = useMemo(() => {
    let path = '';
    for (let p = minProgress; p <= maxProgress; p += 5) {
      const x = 5 + (p / 100) * 90;
      const y = 35 - Math.sin((Math.PI * p) / 100) * 26;
      if (p === minProgress) {
        path += `M ${x} ${y}`;
      } else {
        path += ` L ${x} ${y}`;
      }
    }
    const endX = 5 + (maxProgress / 100) * 90;
    const endY = 35 - Math.sin((Math.PI * maxProgress) / 100) * 26;
    if (path) path += ` L ${endX} ${endY}`;
    return path;
  }, [minProgress, maxProgress]);

  // Coordinates helper for rendering handles
  const leftHandleX = 5 + (minProgress / 100) * 90;
  const leftHandleY = 35 - Math.sin((Math.PI * minProgress) / 100) * 26;
  const rightHandleX = 5 + (maxProgress / 100) * 90;
  const rightHandleY = 35 - Math.sin((Math.PI * maxProgress) / 100) * 26;

  return (
    <PageShell title={t(locale, 'ecosystemSummary')}>
      <div className={styles.clientWrapper}>
      {/* Search & Filter Widgets Panel */}
      <section className={styles.filterSection}>
        <div className={styles.filterGroup}>
          <label htmlFor="riskSlider" className={styles.filterLabel}>
            {t(locale, 'healthFloor')}: <strong>{HEALTHS[minRiskVal] ? t(locale, HEALTH_KEY[HEALTHS[minRiskVal]]) : t(locale, 'noneMatch')}</strong>
          </label>
          <input
            id="riskSlider"
            type="range"
            min="0"
            max="3"
            value={minRiskVal}
            onChange={(e) => setMinRiskVal(parseInt(e.target.value))}
            className={styles.slider}
          />
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="ownerSelect" className={styles.filterLabel}>{t(locale, 'programOwnerGoogler')}</label>
          <select
            id="ownerSelect"
            value={selectedOwner}
            onChange={(e) => setSelectedOwner(e.target.value)}
            className={styles.select}
          >
            {owners.map(owner => (
              <option key={owner} value={owner}>{owner === 'All' ? t(locale, 'allLabel') : owner}</option>
            ))}
          </select>
        </div>

        <div className={styles.progressFilterContainer}>
          <label className={styles.filterLabel}>
            {t(locale, 'filterProgressRange')}
          </label>

          {/* Hidden inputs to preserve Playwright E2E automation compatibility */}
          <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0, overflow: 'hidden' }}>
            <input
              id="minProgressSlider"
              type="range"
              min="0"
              max="100"
              value={minProgress}
              onChange={(e) => {
                const val = Math.min(parseInt(e.target.value), maxProgress);
                setMinProgress(val);
              }}
            />
            <input
              id="maxProgressSlider"
              type="range"
              min="0"
              max="100"
              value={maxProgress}
              onChange={(e) => {
                const val = Math.max(parseInt(e.target.value), minProgress);
                setMaxProgress(val);
              }}
            />
          </div>

          {/* Draggable boundary mini hill chart preview */}
          <div className={styles.miniHillContainer}>
            <svg ref={svgRef} className={styles.miniHillChart} viewBox="0 0 100 40">
              <path d="M 5 35 Q 50 8 95 35" fill="none" stroke="var(--border)" strokeWidth="2.5" />
              {miniHighlightPath && (
                <path d={miniHighlightPath} fill="none" stroke="var(--p-600)" strokeWidth="3.5" strokeLinecap="round" />
              )}
              
              {/* Left Handle (Min) */}
              <circle
                cx={leftHandleX}
                cy={leftHandleY}
                r="3.5"
                fill="var(--p-700)"
                className={styles.dragHandle}
                style={{ cursor: 'ew-resize' }}
              />
              <circle
                cx={leftHandleX}
                cy={leftHandleY}
                r="7"
                fill="transparent"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setActiveDrag('min');
                }}
              />

              {/* Right Handle (Max) */}
              <circle
                cx={rightHandleX}
                cy={rightHandleY}
                r="3.5"
                fill="var(--p-700)"
                className={styles.dragHandle}
                style={{ cursor: 'ew-resize' }}
              />
              <circle
                cx={rightHandleX}
                cy={rightHandleY}
                r="7"
                fill="transparent"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setActiveDrag('max');
                }}
              />
            </svg>
          </div>
        </div>
      </section>

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
              // keys are React identity only here — `status` names no field on
              // LiveConstraint, and must still differ from its neighbour's.
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
                    <span className={styles.constraintPrograms}>
                      {c.programs.map((prog, n) => (
                        <span key={prog.id}>
                          {n > 0 && ', '}
                          <Link href={`/programs/${prog.id}`}>{prog.name}</Link>
                        </span>
                      ))}
                    </span>
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
            { key: 'ownerName', label: t(locale, 'ownerLabel') },
            { key: 'sopDate', label: t(locale, 'sopDate') },
            { key: 'volumeFirstYear', label: t(locale, 'volume12m') },
            { key: 'theNeedle', label: t(locale, 'healthLabel') },
            { key: 'hillChartProgress', label: t(locale, 'hillChartHeader') },
            { key: 'chainRemainingDays', label: t(locale, 'sopOutlookHeader') }
          ]}
          data={filteredProjects}
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
                        onClick={() => setMinRiskVal(healthOrder(label))}
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
