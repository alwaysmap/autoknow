'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import NeedleGauge from '../../components/NeedleGauge';
import HillChartControl from '../../components/HillChartControl';
import styles from '../ecosystem-summary/EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../../lib/needle';
import { resolvePerson } from '../../lib/people';

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
}

const RISK_VALUES: Record<string, number> = {
  'Low': 0,
  'Medium': 1,
  'High': 2,
  'Critical': 3
};

export default function ProgramsClient({ initialProjects, people, regions = [], partnerTypes = [] }: ProgramsClientProps) {
  // State filters
  const [partnerType, setPartnerType] = useState('All'); // 'All' | 'OEM' | 'Supplier'
  const [region, setRegion] = useState('All'); // 'All' | 'APAC' | 'EMEA' | 'AMER' | 'Other'
  const [selectedOwner, setSelectedOwner] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [minRiskVal, setMinRiskVal] = useState(0); // 0=Low, 1=Medium, 2=High, 3=Critical
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
    const riskVal = RISK_VALUES[formatNeedleValue(proj.theNeedle)] ?? 0;
    if (riskVal < minRiskVal) return false;

    // 6. Progress floor and ceiling
    if (proj.hillChartProgress < minProgress || proj.hillChartProgress > maxProgress) {
      return false;
    }

    return true;
  });

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
    const lbl = formatNeedleValue(p.theNeedle);
    return lbl === 'High' || lbl === 'Critical';
  }).length;

  // Average progress
  const averageProgress = totalMatching > 0
    ? Math.round(filteredProjects.reduce((sum, p) => sum + p.hillChartProgress, 0) / totalMatching)
    : 0;

  return (
    <div className={styles.clientWrapper}>
      {/* Search & Filter Widgets Panel */}
      <section className={styles.filterSection}>
        <div className={styles.filterGroup}>
          <label htmlFor="searchField" className={styles.filterLabel}>Search Programs</label>
          <input
            id="searchField"
            type="text"
            placeholder="Search by name, partner..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.input}
            style={{ width: '100%' }}
          />
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="partnerTypeSelect" className={styles.filterLabel}>Partner Type</label>
          <select
            id="partnerTypeSelect"
            value={partnerType}
            onChange={(e) => setPartnerType(e.target.value)}
            className={styles.select}
          >
            <option value="All">All Types</option>
            {partnerTypes.map(t => (
              <option key={t} value={t}>{t} Only</option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="regionSelect" className={styles.filterLabel}>Google Region</label>
          <select
            id="regionSelect"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className={styles.select}
          >
            <option value="All">All Regions</option>
            {regions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="ownerSelect" className={styles.filterLabel}>Program Owner</label>
          <select
            id="ownerSelect"
            value={selectedOwner}
            onChange={(e) => setSelectedOwner(e.target.value)}
            className={styles.select}
          >
            {owners.map(owner => (
              <option key={owner} value={owner}>{owner}</option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup} style={{ minWidth: '200px' }}>
          <label className={styles.filterLabel}>
            Risk Floor (The Needle)
          </label>
          <div style={{ padding: '8px 0' }}>
            <NeedleGauge
              value={Object.keys(RISK_VALUES).find(k => RISK_VALUES[k] === minRiskVal) || 'Low'}
              scope="filter"
              onChange={(val) => {
                setMinRiskVal(RISK_VALUES[val] ?? 0);
              }}
            />
          </div>
        </div>

        <div className={styles.progressFilterContainer}>
          <label className={styles.filterLabel}>
            Filter progress by dragging curve: <strong>{minProgress}% - {maxProgress}%</strong>
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

      {/* Dynamic Big Number Scorecards */}
      <section className={styles.scorecards}>
        <div className={styles.card}>
          <h3>Programs In Flight / All Time</h3>
          <div className={styles.metric}>{scorecardRatio}</div>
          <div className={styles.subtext}>Active vs total matches</div>
        </div>

        <div className={styles.card}>
          <h3>High / Critical Risk</h3>
          <div className={styles.metric}>{highRiskCount}</div>
          <div className={styles.subtext}>At elevated risk level</div>
        </div>

        <div className={styles.card}>
          <h3>Average Progress</h3>
          <div className={styles.metric}>{averageProgress}</div>
          <div className={styles.subtext}>Calculated average score</div>
        </div>
      </section>

      {/* Main Database Table */}
      <section className={styles.tableSection}>
        <DataTable
          headers={[
            { key: 'name', label: 'Program Name' },
            { key: 'partner.name', label: 'Partner' },
            { key: 'partner.region', label: 'Google Region' },
            { key: 'ownerName', label: 'Program Owner' },
            { key: 'sopDate', label: 'Target SOP' },
            { key: 'theNeedle', label: 'Needle' },
            { key: 'hillChartProgress', label: 'Progress' }
          ]}
          data={filteredProjects}
          renderRow={(p: Project) => {
            const matched = p.ownerName ? resolvePerson(people, p.ownerName) : null;

            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/projects/${p.id}`} className={styles.tableLink}>
                    {p.name}
                  </Link>
                </td>
                <td>
                  <Link href={`/partners/${p.partner.id}`} className={styles.tableLink}>
                    {p.partner.name}
                  </Link>
                </td>
                <td>{p.partner.region || 'Other'}</td>
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
                <td>{p.sopDate ? new Date(p.sopDate).toLocaleDateString() : 'TBD'}</td>
                <td>
                  {(() => {
                    const label = formatNeedleValue(p.theNeedle);
                    return (
                      <button
                        type="button"
                        onClick={() => setMinRiskVal(RISK_VALUES[label] ?? 0)}
                        className={styles.badgeFilterBtn}
                        title={`Filter risk level: ${label}`}
                      >
                        <span className={`${styles.badge} ${styles['needle' + label]}`}>
                          {label}
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
          emptyStateMessage="No programs match current filters."
        />
      </section>
    </div>
  );
}
