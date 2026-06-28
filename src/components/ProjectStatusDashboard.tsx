'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { updateProjectMetrics } from '../app/projects/[id]/actions';
import styles from './ProjectStatusDashboard.module.css';
import NeedleGauge from './NeedleGauge';
import { parseNeedleValue, getNeedleLabel } from '../lib/needle';

interface PartnerInfo {
  id: number;
  name: string;
}

interface ProjectStatusDashboardProps {
  projectId: number;
  projectName: string;
  currentNeedle: string;
  currentHillChartProgress: number;
  problemCount: number;
  ownerName: string;
  sopDateString: string;
  volumeFirstYear: number;
  phases: any[];
  oemPartner?: PartnerInfo | null;
  suppliersList?: PartnerInfo[];
}

const needleValueMap: Record<string, string> = {
  'Low': '1',
  'Medium': '2',
  'High': '3',
  'Critical': '4',
};

function getHillCoordinates(progress: number) {
  if (progress <= 50) {
    const t = progress / 50;
    const x = Math.pow(1 - t, 3) * 10 + 3 * Math.pow(1 - t, 2) * t * 50 + 3 * (1 - t) * Math.pow(t, 2) * 70 + Math.pow(t, 3) * 100;
    const y = Math.pow(1 - t, 3) * 80 + 3 * Math.pow(1 - t, 2) * t * 80 + 3 * (1 - t) * Math.pow(t, 2) * 10 + Math.pow(t, 3) * 10;
    return { x, y };
  } else {
    const t = (progress - 50) / 50;
    const x = Math.pow(1 - t, 3) * 100 + 3 * Math.pow(1 - t, 2) * t * 130 + 3 * (1 - t) * Math.pow(t, 2) * 150 + Math.pow(t, 3) * 190;
    const y = Math.pow(1 - t, 3) * 10 + 3 * Math.pow(1 - t, 2) * t * 10 + 3 * (1 - t) * Math.pow(t, 2) * 80 + Math.pow(t, 3) * 80;
    return { x, y };
  }
}

export default function ProjectStatusDashboard({
  projectId,
  projectName,
  currentNeedle,
  currentHillChartProgress,
  problemCount,
  ownerName,
  sopDateString,
  volumeFirstYear,
  phases,
  oemPartner,
  suppliersList,
}: ProjectStatusDashboardProps) {
  const [selectedProgress, setSelectedProgress] = useState<number>(currentHillChartProgress);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);

  const progressDialogRef = useRef<HTMLDialogElement>(null);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const progressSvgRef = useRef<SVGSVGElement>(null);

  // Setup light dismiss fallback for browsers without closedby support (like Safari)
  useEffect(() => {
    const dialogRefs = [progressDialogRef, settingsDialogRef];
    
    const cleanups = dialogRefs.map((ref) => {
      const dialog = ref.current;
      if (dialog && !('closedBy' in HTMLDialogElement.prototype)) {
        const handleDismiss = (event: MouseEvent) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent = (
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width
          );
          if (!isDialogContent) {
            dialog.close();
          }
        };
        dialog.addEventListener('click', handleDismiss);
        return () => dialog.removeEventListener('click', handleDismiss);
      }
      return () => {};
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  const openProgressDialog = () => {
    setSelectedProgress(currentHillChartProgress);
    progressDialogRef.current?.showModal();
  };

  const openSettingsDialog = () => {
    settingsDialogRef.current?.showModal();
  };

  // Drag progress calculation - fully continuous, no snaps
  const updateProgressFromCoords = (clientX: number) => {
    if (!progressSvgRef.current) return;
    const rect = progressSvgRef.current.getBoundingClientRect();
    
    // Calculate percentage based on local x position relative to SVG width
    const xPercent = (clientX - rect.left) / rect.width;
    
    // Base hill curve starts at x=10 (5%) and ends at x=190 (95%).
    let progressVal = Math.round(((xPercent * 200 - 10) / 180) * 100);
    progressVal = Math.max(0, Math.min(100, progressVal));
    
    setSelectedProgress(progressVal);
  };

  const handleProgressPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingProgress(true);
    updateProgressFromCoords(e.clientX);
  };

  const handleProgressPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingProgress) return;
    updateProgressFromCoords(e.clientX);
  };

  const handleProgressPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDraggingProgress(false);
  };

  const hillCoords = getHillCoordinates(currentHillChartProgress);
  const dragHillCoords = getHillCoordinates(selectedProgress);

  return (
    <section className={styles.summaryDashboard}>
      <div className={styles.summaryTopRow}>
        {/* Needle Gauge Card */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Overall Health (The Needle)</div>
          <NeedleGauge
            value={currentNeedle}
            scope="project"
            targetId={projectId}
            hillChartProgress={currentHillChartProgress}
            notesLabel="Project health risk update note"
          />
        </div>

        {/* Hill Chart Progress Card */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Hill Chart Progress</div>
          <div className={styles.hillChartContainer}>
            <svg className={styles.gaugeSvg} viewBox="0 0 200 100">
              {/* Base Hill Curve */}
              <path
                d="M 10 80 C 50 80, 70 10, 100 10 C 130 10, 150 80, 190 80"
                className={styles.hillCurve}
              />
              {/* Center Line for peak */}
              <line x1="100" y1="10" x2="100" y2="80" stroke="var(--border)" strokeDasharray="3 3" />
              
              {/* Progress Ball */}
              <circle cx={hillCoords.x} cy={hillCoords.y} r="6" className={styles.hillDot} />

              {/* Hill Chart Labels */}
              <text x="50" y="94" textAnchor="middle" fontSize="8" fill="var(--muted)" fontWeight="600" letterSpacing="0.02em">Working it out</text>
              <text x="150" y="94" textAnchor="middle" fontSize="8" fill="var(--muted)" fontWeight="600" letterSpacing="0.02em">Getting it done</text>
            </svg>
          </div>
          <div className={styles.statusValue}>Progress Chart</div>
          <button onClick={openProgressDialog} className={styles.updateButton}>
            Update Progress
          </button>
        </div>

        {/* Blockers & Decisions Card */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Blockers &amp; Decisions</div>
          <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className={styles.problemCount}>{problemCount}</div>
            <div className={styles.problemSubtext}>Pending integration issues</div>
          </div>
        </div>

        {/* Settings Metadata Card */}
        <div className={styles.metadataCard}>
          <div className={styles.summaryCardLabel} style={{ textAlign: 'center' }}>Project Metadata</div>
          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>OEM</span>
              <span className={styles.metaVal}>
                {oemPartner ? (
                  <Link href={`/partners/${oemPartner.id}`} className={styles.metaLink}>
                    {oemPartner.name}
                  </Link>
                ) : (
                  <span className={styles.empty}>None</span>
                )}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Suppliers</span>
              <span className={styles.metaVal}>
                {suppliersList && suppliersList.length > 0 ? (
                  suppliersList.map((sup, sidx) => (
                    <span key={sup.id}>
                      {sidx > 0 && ', '}
                      <Link href={`/partners/${sup.id}`} className={styles.metaLink}>
                        {sup.name}
                      </Link>
                    </span>
                  ))
                ) : (
                  <span className={styles.empty}>None</span>
                )}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Googler Owner</span>
              <span className={styles.metaVal}>{ownerName || 'Undecided'}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>SOP Target</span>
              <span className={styles.metaVal}>{sopDateString || 'Not Set'}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>12M Target Volume</span>
              <span className={styles.metaVal}>{volumeFirstYear ? volumeFirstYear.toLocaleString() : '0'}</span>
            </div>
          </div>
          <button onClick={openSettingsDialog} className={styles.updateButton} style={{ width: '100%' }}>
            Edit Project Metadata
          </button>
        </div>
      </div>

      {/* dialog 2: Update Hill Chart Progress */}
      <dialog ref={progressDialogRef} closedby="any" className={styles.dialog} aria-labelledby="progressDialogTitle">
        <div className={styles.dialogHeader}>
          <h3 id="progressDialogTitle">Update Hill Chart Progress</h3>
        </div>
        <form
          action={async (formData) => {
            await updateProjectMetrics(formData);
            progressDialogRef.current?.close();
          }}
          className={styles.dialogForm}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="theNeedle" value={currentNeedle} />
          <input type="hidden" name="ownerName" value={ownerName} />
          <input type="hidden" name="sopDate" value={sopDateString} />
          <input type="hidden" name="volumeFirstYear" value={volumeFirstYear} />

          {/* Interactive Drag Hill Chart Container */}
          <div
            className={styles.dragProgressContainer}
            style={{
              padding: '16px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              backgroundColor: 'var(--surface)',
              userSelect: 'none'
            }}
          >
            <label className={styles.formLabel} style={{ display: 'block', marginBottom: '12px', textAlign: 'center' }}>
              Drag the ball directly along the curve to adjust progress
            </label>
            
            <svg
              ref={progressSvgRef}
              className={styles.dialogHillChart}
              viewBox="0 0 200 100"
              onPointerDown={handleProgressPointerDown}
              onPointerMove={handleProgressPointerMove}
              onPointerUp={handleProgressPointerUp}
              onPointerLeave={handleProgressPointerUp}
              style={{
                cursor: 'ew-resize',
                touchAction: 'none',
                width: '100%',
                height: '140px'
              }}
            >
              {/* Base Hill Curve */}
              <path
                d="M 10 80 C 50 80, 70 10, 100 10 C 130 10, 150 80, 190 80"
                className={styles.hillCurve}
                stroke="#ccc"
                strokeWidth="2.5"
                fill="none"
              />
              <line x1="100" y1="10" x2="100" y2="80" stroke="var(--border)" strokeDasharray="3 3" />

              {/* Progress Ball */}
              <circle
                cx={dragHillCoords.x}
                cy={dragHillCoords.y}
                r="7"
                className={styles.hillDot}
                fill="var(--p-600)"
                style={{
                  transition: isDraggingProgress ? 'none' : 'cx 0.2s ease-out, cy 0.2s ease-out'
                }}
              />

              {/* Hill Chart Labels */}
              <text x="50" y="94" textAnchor="middle" fontSize="8" fill="var(--muted)" fontWeight="600" letterSpacing="0.02em">Working it out</text>
              <text x="150" y="94" textAnchor="middle" fontSize="8" fill="var(--muted)" fontWeight="600" letterSpacing="0.02em">Getting it done</text>
            </svg>

            {/* Hidden progressSlider input for Playwright E2E automation compatibility */}
            <input
              id="progressSlider"
              type="range"
              name="hillChartProgress"
              min="0"
              max="100"
              step="1"
              value={selectedProgress}
              onChange={(e) => setSelectedProgress(parseInt(e.target.value))}
              style={{
                position: 'absolute',
                left: '-9999px',
                top: '-9999px',
                width: '10px',
                height: '10px',
                opacity: 0.01
              }}
            />
          </div>

          <div className={styles.formGroup} style={{ marginTop: '12px' }}>
            <label htmlFor="progressNotes" className={styles.formLabel}>Qualitative Update Note</label>
            <textarea
              id="progressNotes"
              name="notes"
              placeholder="What milestone was achieved? What work remains to complete?"
              className={styles.textArea}
              required
            />
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={() => progressDialogRef.current?.close()} className={styles.cancelBtn}>
              Cancel
            </button>
            <button type="submit" className={styles.submitBtn}>
              Save Progress Update
            </button>
          </div>
        </form>
      </dialog>

      {/* dialog 3: Update Settings Metadata */}
      <dialog ref={settingsDialogRef} closedby="any" className={styles.dialog} aria-labelledby="settingsDialogTitle">
        <div className={styles.dialogHeader}>
          <h3 id="settingsDialogTitle">Edit Project Metadata</h3>
        </div>
        <form
          action={async (formData) => {
            await updateProjectMetrics(formData);
            settingsDialogRef.current?.close();
          }}
          className={styles.dialogForm}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="theNeedle" value={currentNeedle} />
          <input type="hidden" name="hillChartProgress" value={currentHillChartProgress} />

          <div className={styles.textInputGroup}>
            <label htmlFor="editOwner" className={styles.formLabel}>Googler Owner</label>
            <input
              id="editOwner"
              type="text"
              name="ownerName"
              defaultValue={ownerName || ''}
              placeholder="e.g. jsmith@google.com"
              className={styles.textInput}
            />
          </div>

          <div className={styles.textInputGroup}>
            <label htmlFor="editSop" className={styles.formLabel}>SOP Date</label>
            <input
              id="editSop"
              type="date"
              name="sopDate"
              defaultValue={sopDateString}
              className={styles.textInput}
            />
          </div>

          <div className={styles.textInputGroup}>
            <label htmlFor="editVolume" className={styles.formLabel}>12M Target Volume</label>
            <input
              id="editVolume"
              type="number"
              name="volumeFirstYear"
              defaultValue={volumeFirstYear}
              min="0"
              placeholder="e.g. 50000"
              className={styles.textInput}
            />
          </div>

          <div className={styles.textInputGroup}>
            <label htmlFor="settingsNotes" className={styles.formLabel}>Update Note (Optional)</label>
            <input
              id="settingsNotes"
              type="text"
              name="notes"
              placeholder="Metadata changed detail notes"
              className={styles.textInput}
            />
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={() => settingsDialogRef.current?.close()} className={styles.cancelBtn}>
              Cancel
            </button>
            <button type="submit" className={styles.submitBtn}>
              Save Settings
            </button>
          </div>
        </form>
      </dialog>

      {/* Critical Chain Flow Visualizer */}
      {phases.length > 0 && (
        <div className={styles.visualizerSection}>
          <h3 className={styles.visualizerHeading}>Critical Chain Flow</h3>
          <div className={styles.flowChain}>
            {phases.map((phase, idx) => {
              const latestState = phase.states[0];
              const status = latestState?.status || 'Not Started';
              const needleVal = latestState?.theNeedle || 'Low';
              const needleLabel = getNeedleLabel(parseNeedleValue(needleVal));
              const progress = latestState?.hillChartProgress ?? 0;

              let statusClass = styles.flowNotStarted;
              if (status === 'Finished') statusClass = styles.flowFinished;
              else if (status === 'Active WIP') {
                statusClass = (needleLabel === 'Critical' || needleLabel === 'High') ? styles.flowBlocked : styles.flowActive;
              } else if (status === 'Skipped') statusClass = styles.flowSkipped;

              return (
                <div key={phase.id} className={styles.flowStepWrapper}>
                  <div className={`${styles.flowStep} ${statusClass}`}>
                    <div className={styles.flowStepName}>{phase.name}</div>
                    <div className={styles.flowStepMeta}>
                      {needleLabel} Risk
                    </div>
                  </div>
                  {idx < phases.length - 1 && (
                    <div className={styles.flowConnector}>&rarr;</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
