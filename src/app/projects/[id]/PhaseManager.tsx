'use client';

import { useState, useRef, useEffect } from 'react';
import { addPhase, editPhase, deletePhase } from './actions';
import styles from './PhaseManager.module.css';

interface Phase {
  id: number;
  name: string;
  forecastedDuration: number;
}

interface PhaseManagerProps {
  projectId: number;
  phases: Phase[];
}

export default function PhaseManager({ projectId, phases }: PhaseManagerProps) {
  const [activePhase, setActivePhase] = useState<Phase | null>(null);
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const editDialogRef = useRef<HTMLDialogElement>(null);

  // Setup light dismiss backdrop click listener for dialogs
  useEffect(() => {
    const dialogs = [addDialogRef.current, editDialogRef.current];
    const handlers = dialogs.map(dialog => {
      if (!dialog) return () => {};
      const handleDismiss = (e: MouseEvent) => {
        if (e.target === dialog) {
          dialog.close();
        }
      };
      dialog.addEventListener('click', handleDismiss);
      return () => dialog.removeEventListener('click', handleDismiss);
    });
    return () => handlers.forEach(h => h());
  }, [activePhase]);

  const openAdd = () => addDialogRef.current?.showModal();
  const openEdit = (phase: Phase) => {
    setActivePhase(phase);
    setTimeout(() => {
      editDialogRef.current?.showModal();
    }, 10);
  };

  return (
    <div className={styles.managerContainer}>
      <div className={styles.managerHeader}>
        <h3>Phases Workflow</h3>
        <button onClick={openAdd} className={styles.addBtn}>
          ➕ Add Phase
        </button>
      </div>

      {phases.length === 0 ? (
        <p className={styles.empty}>No phases defined. Add a phase to get started.</p>
      ) : (
        <div className={styles.phaseList}>
          {phases.map((phase) => (
            <div key={phase.id} className={styles.phaseItem}>
              <div className={styles.phaseInfo}>
                <strong>{phase.name}</strong>
                <span className={styles.duration}>({phase.forecastedDuration} days)</span>
              </div>
              <div className={styles.phaseActions}>
                <button onClick={() => openEdit(phase)} className={styles.editBtn}>
                  Edit
                </button>
                <form
                  action={deletePhase}
                  onSubmit={(e) => {
                    if (!confirm(`Are you sure you want to delete phase "${phase.name}"?`)) {
                      e.preventDefault();
                    }
                  }}
                  style={{ display: 'inline' }}
                >
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="phaseId" value={phase.id} />
                  <button type="submit" className={styles.deleteBtn}>
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Phase Dialog */}
      <dialog ref={addDialogRef} className={styles.dialog} aria-labelledby="addPhaseTitle">
        <h4 id="addPhaseTitle">Add New Phase</h4>
        <form
          action={async (formData) => {
            await addPhase(formData);
            addDialogRef.current?.close();
          }}
          className={styles.dialogForm}
        >
          <input type="hidden" name="projectId" value={projectId} />
          
          <div className={styles.formGroup}>
            <label htmlFor="addPhaseName">Phase Name</label>
            <input id="addPhaseName" type="text" name="name" required placeholder="e.g. BSP Bring-up" />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="addPhaseDuration">Forecasted Duration (Days)</label>
            <input id="addPhaseDuration" type="number" name="forecastedDuration" defaultValue="30" min="1" required />
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={() => addDialogRef.current?.close()} className={styles.cancelBtn}>
              Cancel
            </button>
            <button type="submit" className={styles.submitBtn}>
              Add Phase
            </button>
          </div>
        </form>
      </dialog>

      {/* Edit Phase Dialog */}
      <dialog ref={editDialogRef} className={styles.dialog} aria-labelledby="editPhaseTitle">
        <h4 id="editPhaseTitle">Edit Phase</h4>
        {activePhase && (
          <form
            action={async (formData) => {
              await editPhase(formData);
              editDialogRef.current?.close();
              setActivePhase(null);
            }}
            className={styles.dialogForm}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="phaseId" value={activePhase.id} />

            <div className={styles.formGroup}>
              <label htmlFor="editPhaseName">Phase Name</label>
              <input id="editPhaseName" type="text" name="name" defaultValue={activePhase.name} required />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="editPhaseDuration">Forecasted Duration (Days)</label>
              <input id="editPhaseDuration" type="number" name="forecastedDuration" defaultValue={activePhase.forecastedDuration} min="1" required />
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                onClick={() => {
                  editDialogRef.current?.close();
                  setActivePhase(null);
                }}
                className={styles.cancelBtn}
              >
                Cancel
              </button>
              <button type="submit" className={styles.submitBtn}>
                Save Changes
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
