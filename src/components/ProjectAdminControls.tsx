'use client';

import { useState } from 'react';
import { archiveProject, deleteProject, setProjectLifecycle } from '../app/programs/[id]/actions';
import OverlayDialog from './OverlayDialog';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './ProjectAdminControls.module.css';

interface ProjectAdminControlsProps {
  projectId: number;
  projectName: string;
  isArchived: boolean;
  lifecycle: string;
}

export default function ProjectAdminControls({
  projectId,
  projectName,
  isArchived,
  lifecycle,
}: ProjectAdminControlsProps) {
  const locale = useLocale();
  const [confirmName, setConfirmName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const openDeleteDialog = () => {
    setConfirmName('');
    setDeleteOpen(true);
  };

  const isConfirmed = confirmName.trim() === projectName;

  return (
    <div className={styles.adminControls}>
      {/* Lifecycle is a fact someone SETS (active/complete/cancelled) — archived is
          orthogonal visibility (lib/lifecycle). */}
      {lifecycle === 'active' ? (
        <>
          <form action={setProjectLifecycle}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="lifecycle" value="complete" />
            <button type="submit" data-testid="mark-complete" className={styles.archiveButton}>
              {t(locale, 'markComplete')}
            </button>
          </form>
          <form action={setProjectLifecycle}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="lifecycle" value="cancelled" />
            <button type="submit" data-testid="mark-cancelled" className={styles.archiveButton}>
              {t(locale, 'markCancelled')}
            </button>
          </form>
        </>
      ) : (
        <form action={setProjectLifecycle}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="lifecycle" value="active" />
          <button type="submit" data-testid="reactivate-program" className={styles.archiveButton}>
            {t(locale, 'reactivateProgram')}
          </button>
        </form>
      )}

      {/* Archive Project Form */}
      <form action={archiveProject}>
        <input type="hidden" name="projectId" value={projectId} />
        <button type="submit" className={styles.archiveButton}>
          {isArchived ? t(locale, 'unarchiveShort') : t(locale, 'archiveShort')}
        </button>
      </form>

      {/* Delete Project Trigger */}
      <button onClick={openDeleteDialog} className={styles.deleteButton}>
        {t(locale, 'deleteLabel')}
      </button>

      {/* Delete Confirmation Dialog */}
      <OverlayDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} width="30rem"
        title={t(locale, 'confirmProjectDeletion')} closeLabel={t(locale, 'close')}>
        <p className={styles.warningText}>
          {t(locale, 'deleteWarning')} <strong>{t(locale, 'cannotBeUndone')}</strong>
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
              {t(locale, 'confirmTypeName')} (<strong>{projectName}</strong>):
            </label>
            <input
              id="confirmProjectName"
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={t(locale, 'typeProjectNameExactly')}
              className={styles.textInput}
              autoComplete="off"
            />
          </div>

          <div className={styles.actionRow}>
            <button type="button" onClick={() => setDeleteOpen(false)} className={styles.cancelBtn}>
              {t(locale, 'cancel')}
            </button>
            <button
              type="submit"
              disabled={!isConfirmed}
              className={styles.dangerBtn}
            >
              {t(locale, 'permanentlyDeleteProject')}
            </button>
          </div>
        </form>
      </OverlayDialog>
    </div>
  );
}
