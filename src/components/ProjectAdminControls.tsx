'use client';

import { useState, useRef, useEffect } from 'react';
import { archiveProject, deleteProject } from '../app/projects/[id]/actions';
import styles from './ProjectAdminControls.module.css';

interface ProjectAdminControlsProps {
  projectId: number;
  projectName: string;
  isArchived: boolean;
}

export default function ProjectAdminControls({
  projectId,
  projectName,
  isArchived,
}: ProjectAdminControlsProps) {
  const [confirmName, setConfirmName] = useState('');
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

  // Setup light dismiss fallback for browsers without closedby support (like Safari)
  useEffect(() => {
    const dialog = deleteDialogRef.current;
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
  }, []);

  const openDeleteDialog = () => {
    setConfirmName('');
    deleteDialogRef.current?.showModal();
  };

  const isConfirmed = confirmName.trim() === projectName;

  return (
    <div className={styles.adminControls}>
      {/* Archive Project Form */}
      <form action={archiveProject}>
        <input type="hidden" name="projectId" value={projectId} />
        <button type="submit" className={styles.archiveButton}>
          {isArchived ? 'Unarchive Project' : 'Archive Project'}
        </button>
      </form>

      {/* Delete Project Trigger */}
      <button onClick={openDeleteDialog} className={styles.deleteButton}>
        Delete Project
      </button>

      {/* Delete Confirmation Dialog */}
      <dialog ref={deleteDialogRef} closedby="any" className={styles.dialog} aria-labelledby="deleteDialogTitle">
        <div className={styles.dialogHeader}>
          <h3 id="deleteDialogTitle">Confirm Project Deletion</h3>
        </div>
        
        <p className={styles.warningText}>
          Are you sure you want to delete this project? This will permanently remove all associated phases, action items, and status log histories. <strong>This action cannot be undone.</strong>
        </p>

        <form
          action={async (formData) => {
            if (isConfirmed) {
              await deleteProject(formData);
            }
          }}
          className={styles.dialogForm}
        >
          <input type="hidden" name="projectId" value={projectId} />

          <div className={styles.formGroup}>
            <label htmlFor="confirmProjectName" className={styles.formLabel}>
              Please type the name of the project to confirm (<strong>{projectName}</strong>):
            </label>
            <input
              id="confirmProjectName"
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder="Type project name exactly"
              className={styles.textInput}
              autoComplete="off"
            />
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={() => deleteDialogRef.current?.close()} className={styles.cancelBtn}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isConfirmed}
              className={styles.dangerBtn}
            >
              Permanently Delete Project
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
