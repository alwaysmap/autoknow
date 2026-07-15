'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import EcosystemSopChart from '../../components/EcosystemSopChart';
import styles from './EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../../lib/needle';
import { HEALTHS, HEALTH_KEY, healthKey, healthColor, healthOrder } from '../../lib/health';
import { resolvePerson } from '../../lib/people';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  ownerName: string | null;
  volumeFirstYear: number;
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

interface Person {
  id: number;
  name: string;
  email: string;
}

interface EcosystemSummaryClientProps {
  initialProjects: Project[];
  briefings: {
    projectId: number;
    projectName: string;
    partnerName: string;
    briefingText: string;
    timestamp: string;
  }[];
  p85LeadTime: number;
  people: Person[];
}

export default function EcosystemSummaryClient({
  initialProjects,
  briefings,
  p85LeadTime,
  people
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
  const totalVolume = filteredProjects.reduce((sum, p) => sum + p.volumeFirstYear, 0);
  const inRangeCount = initialProjects.filter(matchesProgressRange).length;
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
    <div className={styles.clientWrapper}>
      <h1 className={styles.pageTitle}>{t(locale, 'ecosystemSummary')}</h1>
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
              <path d="M 5 35 Q 50 8 95 35" fill="none" stroke="#e0e0e0" strokeWidth="2.5" />
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

      {/* Leadership Scorecards */}
      <section className={styles.scorecards}>
        <div className={styles.card}>
          <h3>{t(locale, 'programsInFlight')}</h3>
          <div className={styles.metric}>{filteredProjects.length}</div>
          <div className={styles.subtext}>{t(locale, 'activeImplementations')}</div>
        </div>

        <div className={styles.card}>
          <h3>{t(locale, 'total12mVolume')}</h3>
          <div className={styles.metric}>
            {totalVolume.toLocaleString(locale)}
          </div>
          <div className={styles.subtext}>{t(locale, 'shippingUnitsFirstYear')}</div>
        </div>

        <div className={styles.card}>
          <h3>{t(locale, 'programsInRange')}</h3>
          <div className={styles.metric}>
            {inRangeCount}
          </div>
          <div className={styles.subtext}>{t(locale, 'withinSelectedRange')}</div>
        </div>

        <div className={styles.card}>
          <h3>{t(locale, 'leadTimeP85')}</h3>
          <div className={styles.metric}>{t(locale, 'daysShort', { n: p85LeadTime })}</div>
          <div className={styles.subtext}>{t(locale, 'averagePhaseDuration')}</div>
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
        <div className={styles.diagnosisGrid}>
          <div className={`${styles.diagnosisItem} ${styles.constraintHighlight}`}>
            <span className={styles.phaseLabel}>Compliance Testing (Phase 3.1)</span>
            <span className={styles.durationVal}>{t(locale, 'daysCount', { n: 54 })}</span>
            <span className={styles.badgeDanger}>{t(locale, 'slowestPrimaryConstraint')}</span>
          </div>
          <div className={styles.diagnosisItem}>
            <span className={styles.phaseLabel}>Audio HAL Integration</span>
            <span className={styles.durationVal}>{t(locale, 'daysCount', { n: 45 })}</span>
            <span className={styles.badgeWarn}>{t(locale, 'secondaryBottleneck')}</span>
          </div>
          <div className={styles.diagnosisItem}>
            <span className={styles.phaseLabel}>Car Service Integration</span>
            <span className={styles.durationVal}>{t(locale, 'daysCount', { n: 35 })}</span>
            <span className={styles.badgeInfo}>{t(locale, 'normalFlow')}</span>
          </div>
          <div className={styles.diagnosisItem}>
            <span className={styles.phaseLabel}>VHAL Integration</span>
            <span className={styles.durationVal}>{t(locale, 'daysCount', { n: 30 })}</span>
            <span className={styles.badgeInfo}>{t(locale, 'normalFlow')}</span>
          </div>
          <div className={styles.diagnosisItem}>
            <span className={styles.phaseLabel}>BSP &amp; Power-on</span>
            <span className={styles.durationVal}>{t(locale, 'daysCount', { n: 14 })}</span>
            <span className={styles.badgeInfo}>{t(locale, 'fastTrack')}</span>
          </div>
        </div>
      </section>

      {/* Industry SOP Target and Shipping Volume Curve */}
      <EcosystemSopChart projects={filteredProjects} />

      {/* Active Implementation Pipelines */}
      <section className={styles.tableSection}>
        <h2>{t(locale, 'programLifecycleLaunches')}</h2>
        <DataTable
          headers={[
            { key: 'partner.name', label: t(locale, 'partnerLabel') },
            { key: 'name', label: t(locale, 'programLabel') },
            { key: 'ownerName', label: t(locale, 'ownerLabel') },
            { key: 'sopDate', label: t(locale, 'sopDate') },
            { key: 'volumeFirstYear', label: t(locale, 'volume12m') },
            { key: 'theNeedle', label: t(locale, 'healthLabel') },
            { key: 'hillChartProgress', label: t(locale, 'hillChartHeader') },
            { key: 'forecast.sim.p85', label: t(locale, 'completionForecastP85') }
          ]}
          data={filteredProjects}
          renderRow={(p: Project) => {
            const isEarlyStage = p.hillChartProgress <= 50;
            return (
              <tr key={p.id} className={isEarlyStage ? styles.earlyRow : ''}>
                <td>
                  <Link href={`/partners/${p.partner.id}`}>
                    {p.partner.name}
                  </Link>
                </td>
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
                <td>{p.sopDate ? new Date(p.sopDate).toLocaleDateString(locale) : t(locale, 'tbd')}</td>
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
                  {p.forecast.remainingPhases > 0 ? (
                    <span className={styles.forecastText}>
                      {t(locale, 'daysLikely', { n: p.forecast.sim.p85 })}
                    </span>
                  ) : (
                    <span className={styles.finishedText}>{t(locale, 'finishedLabel')}</span>
                  )}
                </td>
              </tr>
            );
          }}
          defaultSortKey="name"
          pageSize={10}
          emptyStateMessage={t(locale, 'noProgramsMatchFilters')}
        />
      </section>

      {/* AI Synthesis Briefings Row */}
      <section className={styles.synthesisSection}>
        <h2>{t(locale, 'aiStatusSynthesis')}</h2>
        <div className={styles.briefingBlock}>
          <div className={styles.briefingHeader}>
            <span className={styles.aiBadge}>{t(locale, 'geminiSynthesisReport')}</span>
            <span className={styles.briefingDate}>{t(locale, 'liveFeedsCompiled')}</span>
          </div>
          {briefings.length === 0 ? (
            <p className={styles.emptyBriefing}>{t(locale, 'noWebhookUpdates')}</p>
          ) : (
            <div className={styles.synthesisContent}>
              <div className={styles.aiExecutiveSummary}>
                <strong>{t(locale, 'executiveBlockerSummary')}</strong>
                {briefings.map((b, idx) => (
                  <span key={idx}>
                    {' '}
                    <strong>{b.partnerName} (<Link href={`/programs/${b.projectId}`} className={styles.briefingLink}>{b.projectName}</Link>)</strong>: &quot;{b.briefingText}&quot;
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
