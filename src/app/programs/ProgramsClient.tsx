'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import HillChartControl from '../../components/HillChartControl';
import styles from '../ecosystem-summary/EcosystemSummaryClient.module.css';
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
    type: string;
    region: string | null;
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

interface ProgramsClientProps {
  initialProjects: Project[];
  people: Person[];
  regions?: string[];
  partnerTypes?: string[];
  /** Deep-link support (e.g. the ecosystem High-risk list's "More →"). */
  initialMinRisk?: number;
  initialSort?: 'risk' | null;
  initialActiveOnly?: boolean;
}

const SHOW_SCORECARDS = false;

export default function ProgramsClient({ initialProjects, people, regions = [], partnerTypes = [], initialMinRisk = 0, initialSort = null, initialActiveOnly = false }: ProgramsClientProps) {
  const locale = useLocale();
  // State filters
  const [partnerType, setPartnerType] = useState('All'); // 'All' | 'OEM' | 'Supplier'
  const [region, setRegion] = useState('All'); // 'All' | 'APAC' | 'EMEA' | 'AMER' | 'Other'
  const [selectedOwner, setSelectedOwner] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [minRiskVal, setMinRiskVal] = useState(initialMinRisk); // health floor (see lib/health)
  const [activeOnly, setActiveOnly] = useState(initialActiveOnly); // not archived, not done
  const [minProgress, setMinProgress] = useState(0);
  const [maxProgress, setMaxProgress] = useState(100);
  const [activeDrag, setActiveDrag] = useState<'min' | 'max' | null>(null);

  const svgRef = React.useRef<SVGSVGElement>(null);

  React.useEffect(() => {
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

  // Dynamic filter function
  const filteredProjects = initialProjects.filter((proj) => {
    // 0. Active only (not archived, not done) — deep-linked from the ecosystem stats
    if (activeOnly && (proj.isArchived || proj.hillChartProgress >= 100)) return false;

    // 1. Partner Type filter
    if (partnerType !== 'All' && proj.partner.type !== partnerType) {
      return false;
    }

    // 2. Google Region filter
    if (region !== 'All' && (proj.partner.region || 'Other') !== region) {
      return false;
    }

    // 3. Program Owner filter
    if (selectedOwner !== 'All' && proj.ownerName !== selectedOwner) {
      return false;
    }

    // 4. Keyword Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = proj.name.toLowerCase().includes(q);
      const matchPartner = proj.partner.name.toLowerCase().includes(q);
      if (!matchName && !matchPartner) return false;
    }

    // 5. Needle risk level floor
    const riskVal = healthOrder(proj.theNeedle);
    if (riskVal < minRiskVal) return false;

    // 6. Progress floor and ceiling
    if (proj.hillChartProgress < minProgress || proj.hillChartProgress > maxProgress) {
      return false;
    }

    return true;
  });

  // Risk sort (deep-linked): worst health first, then least progressed.
  if (initialSort === 'risk') {
    filteredProjects.sort(
      (a, b) => healthOrder(b.theNeedle) - healthOrder(a.theNeedle) || a.hillChartProgress - b.hillChartProgress,
    );
  }

  // Calculate coordinates for rendering handles in JSX
  const miniHighlightPath = React.useMemo(() => {
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

  const leftHandleX = 5 + (minProgress / 100) * 90;
  const leftHandleY = 35 - Math.sin((Math.PI * minProgress) / 100) * 26;
  const rightHandleX = 5 + (maxProgress / 100) * 90;
  const rightHandleY = 35 - Math.sin((Math.PI * maxProgress) / 100) * 26;

  // Aggregations for dynamic scorecards
  const totalMatching = filteredProjects.length;
  const activeMatching = filteredProjects.filter(p => p.hillChartProgress < 100).length;
  
  // Total in-flight vs total overall projects
  const scorecardRatio = `${activeMatching} / ${totalMatching}`;

  // High/Critical risk count
  const highRiskCount = filteredProjects.filter((p) => {
    return healthOrder(p.theNeedle) >= 1;
  }).length;


  return (
    <div className={styles.clientWrapper}>
      {/* Search & Filter Widgets Panel */}
      <section className={styles.filterSection}>
        <div className={styles.filterGroup}>
          <label htmlFor="searchField" className={styles.filterLabel}>{t(locale, 'searchPrograms')}</label>
          <input
            id="searchField"
            type="text"
            placeholder={t(locale, 'searchByNamePartner')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.input}
            style={{ width: '100%' }}
          />
        </div>

        {/* Active-only: deep-linked by the ecosystem Big Number (?filter=active) */}
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="activeOnly">{t(locale, 'activeOnly')}</label>
          <input
            id="activeOnly"
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="partnerTypeSelect" className={styles.filterLabel}>{t(locale, 'partnerType')}</label>
          <select
            id="partnerTypeSelect"
            value={partnerType}
            onChange={(e) => setPartnerType(e.target.value)}
            className={styles.select}
          >
            <option value="All">{t(locale, 'allTypes')}</option>
            {partnerTypes.map(pt => (
              <option key={pt} value={pt}>{t(locale, 'typeOnly', { t: pt })}</option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="regionSelect" className={styles.filterLabel}>{t(locale, 'googleRegion')}</label>
          <select
            id="regionSelect"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className={styles.select}
          >
            <option value="All">{t(locale, 'allRegions')}</option>
            {regions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="ownerSelect" className={styles.filterLabel}>{t(locale, 'programOwner')}</label>
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

        <div className={styles.filterGroup} style={{ minWidth: '200px' }}>
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
                onPointerDown={(e) => {
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
                onPointerDown={(e) => {
                  e.preventDefault();
                  setActiveDrag('max');
                }}
              />
            </svg>
          </div>
        </div>
      </section>

      {/* Scorecards hidden for now (2026-07-18): count/risk added little over the
          table itself, and the ecosystem page owns the real big numbers. The
          average-progress card is gone for good — a mean across unlike programs
          reads as precision without meaning. Set SHOW_SCORECARDS to bring the
          remaining two back. */}
      {SHOW_SCORECARDS && (
        <section className={styles.scorecards}>
          <div className={styles.card}>
            <h3>{t(locale, 'programsInFlightAllTime')}</h3>
            <div className={styles.metric}>{scorecardRatio}</div>
            <div className={styles.subtext}>{t(locale, 'activeVsTotal')}</div>
          </div>

          <div className={styles.card}>
            <h3>{t(locale, 'someRiskConcerned')}</h3>
            <div className={styles.metric}>{highRiskCount}</div>
            <div className={styles.subtext}>{t(locale, 'atElevatedRisk')}</div>
          </div>
        </section>
      )}

      {/* Main Database Table */}
      <section className={styles.tableSection}>
        <DataTable
          headers={[
            { key: 'name', label: t(locale, 'programName') },
            { key: 'partner.name', label: t(locale, 'partnerLabel') },
            { key: 'partner.region', label: t(locale, 'googleRegion') },
            { key: 'ownerName', label: t(locale, 'programOwner') },
            { key: 'sopDate', label: t(locale, 'targetSopHeader') },
            { key: 'theNeedle', label: t(locale, 'healthLabel') },
            { key: 'hillChartProgress', label: t(locale, 'progressLabel') }
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
                <td>{p.partner.region || t(locale, 'otherLabel')}</td>
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
              </tr>
            );
          }}
          defaultSortKey="name"
          pageSize={10}
          emptyStateMessage={t(locale, 'noProgramsMatchFilters')}
        />
      </section>
    </div>
  );
}
