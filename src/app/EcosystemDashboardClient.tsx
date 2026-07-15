'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import DataTable from '../components/DataTable';
import EcosystemSopChart from '../components/EcosystemSopChart';
import HillChartControl from '../components/HillChartControl';
import CycleTimeScatterPlot, { CycleTimeData, CycleTimeStats } from '../components/CycleTimeScatterPlot';

import styles from './ecosystem-summary/EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../lib/needle';
import { HEALTHS, HEALTH_KEY, healthKey, healthColor, healthOrder } from '../lib/health';
import { resolvePerson } from '../lib/people';
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

interface EcosystemDashboardClientProps {
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

  cycleTimeData?: CycleTimeData[];
  cycleTimeStats?: Record<string, CycleTimeStats>;
}

export default function EcosystemDashboardClient({
  initialProjects,
  briefings,
  p85LeadTime,
  people,
  cycleTimeData = [],
  cycleTimeStats = {},
}: EcosystemDashboardClientProps) {
  const locale = useLocale();
  const [minRiskVal, setMinRiskVal] = useState(0); // 0=Low, 1=Medium, 2=High, 3=Critical
  const [selectedOwner, setSelectedOwner] = useState('All');
  const [minProgress, setMinProgress] = useState(0);

  // Extract unique program owners
  const owners = ['All', ...Array.from(new Set(initialProjects.map(p => p.ownerName).filter(Boolean))) as string[]];

  // Helper check to determine if project matches progress range
  const matchesProgressRange = (proj: Project) => {
    return proj.hillChartProgress >= minProgress;
  };

  // Filter projects (also filtering out archived projects on the dashboard)
  const filteredProjects = initialProjects.filter(proj => {
    if (proj.isArchived) return false;

    // 1. Filter by Risk level from The Needle (Low, Medium, High, Critical)
    const riskVal = healthOrder(proj.theNeedle);
    if (riskVal < minRiskVal) return false;

    // 2. Filter by Googler Program Owner
    if (selectedOwner !== 'All' && proj.ownerName !== selectedOwner) {
      return false;
    }

    // 3. Filter by Progress Range (Progress >= minProgress floor)
    if (!matchesProgressRange(proj)) {
      return false;
    }

    return true;
  });


  // Filter Cycle Time Data based on filteredProjects. cycleTimeData is keyed by
  // phaseId, so build a phaseId -> projectId map from initialProjects to filter it.
  const filteredProjectIds = new Set(filteredProjects.map(p => p.id));
  const phaseToProjectMap = new Map<number, number>();
  initialProjects.forEach(proj => {
    proj.phases.forEach(phase => {
      phaseToProjectMap.set(phase.id, proj.id);
    });
  });

  const filteredCycleTimeData = cycleTimeData.filter(ct => {
    const projId = phaseToProjectMap.get(ct.phaseId);
    return projId !== undefined && filteredProjectIds.has(projId);
  });

  // Calculate high level dashboard aggregations
  const totalVolume = filteredProjects.reduce((sum, p) => sum + p.volumeFirstYear, 0);
  const criticalCount = filteredProjects.filter(p => healthOrder(p.theNeedle) >= 1).length;
  // Count non-archived programs matching the progress floor (the dashboard never
  // shows archived projects, so they must not inflate this card either).
  const inRangeCount = initialProjects.filter(p => !p.isArchived && matchesProgressRange(p)).length;

  return (
    <div className={styles.clientWrapper}>
      {/* Search & Filter Widgets Panel */}
      <section className={styles.filterSection}>
        <div className={styles.filterGroup} style={{ minWidth: '220px' }}>
          <label className={styles.filterLabel}>{t(locale, 'healthFloor')}</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {HEALTHS.map((h, i) => {
              const on = minRiskVal === i;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => setMinRiskVal(on ? 0 : i)}
                  aria-pressed={on}
                  style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${healthColor(h)}`, background: on ? healthColor(h) : 'transparent', color: on ? '#fff' : healthColor(h) }}
                >
                  {t(locale, HEALTH_KEY[h])}
                </button>
              );
            })}
          </div>
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

        <div className={styles.filterGroup} style={{ minWidth: '220px' }}>
          <label className={styles.filterLabel}>
            {t(locale, 'progressFloorHill')}
          </label>
          <div style={{ padding: '8px 0' }}>
            <HillChartControl
              value={minProgress}
              onChange={(val) => {
                setMinProgress(val);
              }}
            />
          </div>
        </div>
      </section>

      {/* Hidden inputs to preserve Playwright E2E automation compatibility for min/max progress */}
      <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0, overflow: 'hidden' }}>
        <input
          id="riskSlider"
          type="range"
          min="0"
          max="3"
          value={minRiskVal}
          onChange={(e) => setMinRiskVal(parseInt(e.target.value))}
        />
        <input
          id="minProgressSlider"
          type="range"
          min="0"
          max="100"
          value={minProgress}
          onChange={(e) => setMinProgress(parseInt(e.target.value))}
        />
        <input
          id="maxProgressSlider"
          type="range"
          min="0"
          max="100"
          value={100}
          onChange={() => {}}
        />
      </div>

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
          <div className={styles.metric}>{inRangeCount}</div>
          <div className={styles.subtext}>{t(locale, 'matchingProgressFilters')}</div>
        </div>

        <div className={styles.card}>
          <h3>{t(locale, 'deterministicLeadTime')}</h3>
          <div className={styles.metric}>{t(locale, 'p85Days', { n: p85LeadTime })}</div>
          <div className={styles.subtext}>{t(locale, 'wipCompletionCycle')}</div>
        </div>
      </section>

      {criticalCount > 0 && (
        <div className={styles.blockerAlert}>
          <strong>{t(locale, 'attentionLeaders')}</strong> {t(locale, 'flaggedPrograms', { n: criticalCount })}
        </div>
      )}


      <section className={styles.chartSection} style={{ marginTop: '32px' }}>
        <h2>{t(locale, 'cycleTimePointChart')}</h2>
        <CycleTimeScatterPlot data={filteredCycleTimeData} stats={cycleTimeStats} />
      </section>


      {/* Scatter Chart visualization */}
      <section className={styles.chartCard}>
        <h2>{t(locale, 'targetLaunchTimeline')}</h2>
        <EcosystemSopChart projects={filteredProjects} />
      </section>

      {/* Main Database Table */}
      <section className={styles.tableSection}>
        <h2>{t(locale, 'programsAtRisk')}</h2>
        <DataTable
          headers={[
            { key: 'name', label: t(locale, 'programName') },
            { key: 'partner.name', label: t(locale, 'oemPartnerHeader') },
            { key: 'ownerName', label: t(locale, 'programOwner') },
            { key: 'sopDate', label: t(locale, 'targetSopHeader') },
            { key: 'volumeFirstYear', label: t(locale, 'targetVolume') },
            { key: 'theNeedle', label: t(locale, 'healthLabel') },
            { key: 'hillChartProgress', label: t(locale, 'progressLabel') },
            { key: 'forecast', label: t(locale, 'forecastLabel') }
          ]}
          data={filteredProjects}
          renderRow={(p: Project) => {
            const matched = p.ownerName ? resolvePerson(people, p.ownerName) : null;

            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/programs/${p.id}`} className={styles.tableLink}>
                    {p.name}
                  </Link>
                </td>
                <td>
                  <Link href={`/partners/${p.partner.id}`} className={styles.tableLink}>
                    {p.partner.name}
                  </Link>
                </td>
                <td>
                  {(() => {
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
