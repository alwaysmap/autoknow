'use client';

import { useRef, useEffect } from 'react';
import Link from 'next/link';
import { updateProjectMetrics } from '../app/projects/[id]/actions';
import styles from './ProjectStatusDashboard.module.css';
import NeedleGauge from './NeedleGauge';
import PhaseHillChart, { type PhaseDot } from './PhaseHillChart';

interface PartnerInfo {
  id: number;
  name: string;
}

interface PhaseInput {
  id: number;
  name: string;
  states: { status: string; hillChartProgress: number | null }[];
}

interface ProjectStatusDashboardProps {
  projectId: number;
  projectName: string;
  currentNeedle: string; // program health
  currentHillChartProgress: number; // program progress (needle position)
  previousProgress?: number | null;
  previousHealth?: string | null;
  updatedAt?: string | null;
  problemCount: number;
  ownerName: string;
  sopDateString: string;
  volumeFirstYear: number;
  phases: PhaseInput[];
  oemPartner?: PartnerInfo | null;
  suppliersList?: PartnerInfo[];
}

export default function ProjectStatusDashboard({
  projectId,
  currentNeedle,
  currentHillChartProgress,
  previousProgress,
  previousHealth,
  updatedAt,
  problemCount,
  ownerName,
  sopDateString,
  volumeFirstYear,
  phases,
  oemPartner,
  suppliersList,
}: ProjectStatusDashboardProps) {
  const settingsDialogRef = useRef<HTMLDialogElement>(null);

  // Light-dismiss fallback for browsers without <dialog closedby> support.
  useEffect(() => {
    const dialog = settingsDialogRef.current;
    if (dialog && !('closedBy' in HTMLDialogElement.prototype)) {
      const onClick = (event: MouseEvent) => {
        if (event.target === dialog) dialog.close();
      };
      dialog.addEventListener('click', onClick);
      return () => dialog.removeEventListener('click', onClick);
    }
  }, []);

  const phaseDots: PhaseDot[] = phases.map((p) => ({
    id: p.id,
    name: p.name,
    progress: p.states[0]?.hillChartProgress ?? 0,
    status: p.states[0]?.status ?? 'Not Started',
  }));

  return (
    <section className={styles.summaryDashboard}>
      <div className={styles.summaryTopRow}>
        {/* Program Needle: progress (position) + health (color) */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Progress &amp; Health</div>
          <NeedleGauge
            progress={currentHillChartProgress}
            health={currentNeedle}
            previousProgress={previousProgress}
            previousHealth={previousHealth}
            updatedAt={updatedAt}
            targetId={projectId}
            scope="project"
          />
        </div>

        {/* Phase progress: a dot per phase on the hill */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Phases (hill chart)</div>
          <PhaseHillChart phases={phaseDots} />
        </div>

        {/* Blockers & Decisions */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardLabel}>Blockers &amp; Decisions</div>
          <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className={styles.problemCount}>{problemCount}</div>
            <div className={styles.problemSubtext}>Pending integration issues</div>
          </div>
        </div>

        {/* Metadata */}
        <div className={styles.metadataCard}>
          <div className={styles.summaryCardLabel} style={{ textAlign: 'center' }}>Project Metadata</div>
          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>OEM</span>
              <span className={styles.metaVal}>
                {oemPartner ? (
                  <Link href={`/partners/${oemPartner.id}`} className={styles.metaLink}>{oemPartner.name}</Link>
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
                      <Link href={`/partners/${sup.id}`} className={styles.metaLink}>{sup.name}</Link>
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
          <button onClick={() => settingsDialogRef.current?.showModal()} className={styles.updateButton} style={{ width: '100%' }}>
            Edit Project Metadata
          </button>
        </div>
      </div>

      {/* Metadata edit dialog */}
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
            <input id="editOwner" type="text" name="ownerName" defaultValue={ownerName || ''} placeholder="e.g. jsmith@google.com" className={styles.textInput} />
          </div>
          <div className={styles.textInputGroup}>
            <label htmlFor="editSop" className={styles.formLabel}>SOP Date</label>
            <input id="editSop" type="date" name="sopDate" defaultValue={sopDateString} className={styles.textInput} />
          </div>
          <div className={styles.textInputGroup}>
            <label htmlFor="editVolume" className={styles.formLabel}>12M Target Volume</label>
            <input id="editVolume" type="number" name="volumeFirstYear" defaultValue={volumeFirstYear} min="0" placeholder="e.g. 50000" className={styles.textInput} />
          </div>
          <div className={styles.textInputGroup}>
            <label htmlFor="settingsNotes" className={styles.formLabel}>Update Note (Optional)</label>
            <input id="settingsNotes" type="text" name="notes" placeholder="Metadata change notes" className={styles.textInput} />
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={() => settingsDialogRef.current?.close()} className={styles.cancelBtn}>Cancel</button>
            <button type="submit" className={styles.submitBtn}>Save Settings</button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
