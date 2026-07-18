'use client';

import React, { useRef, useState } from 'react';
import { movePersonCompany, copyPerson, deletePerson } from '../app/actions/people';
import { addPhasePerson } from '../app/actions/phasePeople';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import dash from './ProjectStatusDashboard.module.css';
import meta from './ProjectMetaHeader.module.css';
import admin from './ProjectAdminControls.module.css';
import KebabMenu from './KebabMenu';
import { useLightDismiss } from '../lib/useLightDismiss';

// Person maintenance behind the title kebab (the app-wide grammar: quiet ⋯ beside
// the name, dialogs for the work) — replaces the old full-width "Profile
// Maintenance & Administration" form farm.

interface Option {
  id: number;
  name: string;
}

export interface ProgramOption {
  id: number;
  name: string;
  phases: Option[];
}


export default function PersonAdminControls({ personId, personName, partners, programs }: {
  personId: number;
  personName: string;
  partners: Option[];
  programs: ProgramOption[];
}) {
  const locale = useLocale();
  const moveRef = useRef<HTMLDialogElement>(null);
  const copyRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const assignRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedProgram, setPickedProgram] = useState<number | ''>('');
  useLightDismiss(moveRef);
  useLightDismiss(copyRef);
  useLightDismiss(deleteRef);
  useLightDismiss(assignRef);
  const programPhases = programs.find((pr) => pr.id === pickedProgram)?.phases ?? [];

  // A failed action must surface INSIDE the dialog — a throw would hit the route
  // error boundary and destroy the user's modal input. Actions return { error };
  // redirect()-on-success still propagates as a throw and navigates. Returns true on
  // success so the caller's inline (deferred) form action closes its own dialog —
  // keeping every ref read out of render.
  const runAction = async (
    formData: FormData,
    action: (fd: FormData) => Promise<{ error?: string }>,
  ): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const result = await action(formData);
      if (result?.error) {
        setError(result.error);
        return false;
      }
      return true;
    } finally {
      setSaving(false);
    }
  };
  const errorLine = error && <p role="alert" className={admin.warningText}>{error}</p>;

  return (
    <span className={meta.actions}>
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
        <button type="button" data-testid="add-to-program" onClick={() => { setPickedProgram(''); assignRef.current?.showModal(); }}>
          {t(locale, 'addToProgram')}
        </button>
        <button type="button" onClick={() => moveRef.current?.showModal()}>
          {t(locale, 'moveToDifferentCompany')}
        </button>
        <button type="button" onClick={() => copyRef.current?.showModal()}>
          {t(locale, 'copyPersonProfile')}
        </button>
        <button type="button" data-testid="delete-person" onClick={() => deleteRef.current?.showModal()}>
          {t(locale, 'deleteLabel')}
        </button>
      </KebabMenu>

      {/* assign-to-program dialog: program → phase → role. Any login can assign a
          person (incl. themselves, via /me) onto a phase; the program derives. */}
      <dialog ref={assignRef} closedby="any" className={admin.dialog} aria-labelledby="assignPersonTitle">
        <div className={admin.dialogHeader}><h3 id="assignPersonTitle">{t(locale, 'addToProgram')}</h3></div>
        <form
          action={async (fd) => { if (await runAction(fd, addPhasePerson)) assignRef.current?.close(); }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="personId" value={personId} />
          {errorLine}
          <input type="hidden" name="projectId" value={pickedProgram || ''} />
          <div className={dash.textInputGroup}>
            <label htmlFor="assignProgram" className={dash.formLabel}>{t(locale, 'programLabel')}</label>
            <select id="assignProgram" required className={dash.textInput} value={pickedProgram}
              onChange={(e) => setPickedProgram(e.target.value ? parseInt(e.target.value, 10) : '')}>
              <option value="">{t(locale, 'selectProgram')}</option>
              {programs.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
            </select>
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="assignPhase" className={dash.formLabel}>{t(locale, 'phaseLabel')}</label>
            <select id="assignPhase" name="phaseId" required className={dash.textInput} disabled={!pickedProgram} defaultValue="">
              <option value="">{t(locale, 'selectPhase')}</option>
              {programPhases.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
            </select>
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="assignRole" className={dash.formLabel}>{t(locale, 'roleTitle')}</label>
            <input id="assignRole" type="text" name="role" placeholder={t(locale, 'roleTitlePlaceholder')} className={dash.textInput} />
          </div>
          <div className={dash.actionRow}>
            <button type="button" onClick={() => assignRef.current?.close()} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving || !pickedProgram} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </dialog>

      {/* move dialog */}
      <dialog ref={moveRef} closedby="any" className={admin.dialog} aria-labelledby="movePersonTitle">
        <div className={admin.dialogHeader}><h3 id="movePersonTitle">{t(locale, 'moveToDifferentCompany')}</h3></div>
        <form
          action={async (fd) => { if (await runAction(fd, movePersonCompany)) moveRef.current?.close(); }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="personId" value={personId} />
          {errorLine}
          <div className={dash.textInputGroup}>
            <label htmlFor="newPartnerId" className={dash.formLabel}>{t(locale, 'newOrganization')}</label>
            <select id="newPartnerId" name="newPartnerId" required className={dash.textInput} defaultValue="">
              <option value="">{t(locale, 'selectPartner')}</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="newRole" className={dash.formLabel}>{t(locale, 'roleTitle')}</label>
            <input id="newRole" type="text" name="newRole" required placeholder={t(locale, 'roleTitlePlaceholder')} className={dash.textInput} />
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="startDate" className={dash.formLabel}>{t(locale, 'effectiveDate')}</label>
            <input id="startDate" type="date" name="startDate" required className={dash.textInput} />
          </div>
          <div className={dash.actionRow}>
            <button type="button" onClick={() => moveRef.current?.close()} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'movePartner')}</button>
          </div>
        </form>
      </dialog>

      {/* copy dialog */}
      <dialog ref={copyRef} closedby="any" className={admin.dialog} aria-labelledby="copyPersonTitle">
        <div className={admin.dialogHeader}><h3 id="copyPersonTitle">{t(locale, 'copyPersonProfile')}</h3></div>
        <form
          action={async (fd) => { await runAction(fd, copyPerson); }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="personId" value={personId} />
          {errorLine}
          <p className={dash.formHelp ?? ''}>{t(locale, 'copyProfileHelp')}</p>
          <div className={dash.textInputGroup}>
            <label htmlFor="copyEmail" className={dash.formLabel}>{t(locale, 'newEmailAddress')}</label>
            <input id="copyEmail" type="email" name="copyEmail" required placeholder={t(locale, 'copyEmailPlaceholder')} className={dash.textInput} />
          </div>
          <div className={dash.actionRow}>
            <button type="button" onClick={() => copyRef.current?.close()} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'copyProfile')}</button>
          </div>
        </form>
      </dialog>

      {/* delete dialog */}
      <dialog ref={deleteRef} closedby="any" className={admin.dialog} aria-labelledby="deletePersonTitle">
        <div className={admin.dialogHeader}><h3 id="deletePersonTitle">{t(locale, 'deletePersonProfile')}</h3></div>
        <form
          action={async (fd) => { await runAction(fd, deletePerson); }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="personId" value={personId} />
          {errorLine}
          <p>{t(locale, 'deleteProfileHelp')} <strong>{personName}</strong></p>
          <div className={dash.actionRow}>
            <button type="button" onClick={() => deleteRef.current?.close()} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'deleteProfileBtn')}</button>
          </div>
        </form>
      </dialog>
    </span>
  );
}
