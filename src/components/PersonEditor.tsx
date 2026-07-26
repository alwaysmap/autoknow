'use client';

import React, { useState } from 'react';
import { createPerson, movePersonCompany, deletePerson } from '../app/actions/people';
import { addPhasePerson } from '../app/actions/phasePeople';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import dash from './ProjectStatusDashboard.module.css';
import meta from './ProjectMetaHeader.module.css';
import admin from './ProjectAdminControls.module.css';
import KebabMenu from './KebabMenu';
import OverlayDialog from './OverlayDialog';

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
  const [assignOpen, setAssignOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedProgram, setPickedProgram] = useState<number | ''>('');
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
        <button type="button" data-testid="add-to-program" onClick={() => { setPickedProgram(''); setAssignOpen(true); }}>
          {t(locale, 'addToProgram')}
        </button>
        <button type="button" onClick={() => setMoveOpen(true)}>
          {t(locale, 'moveToDifferentCompany')}
        </button>
        <button type="button" data-testid="delete-person" onClick={() => setDeleteOpen(true)}>
          {t(locale, 'deleteLabel')}
        </button>
      </KebabMenu>

      {/* assign-to-program dialog: program → phase → role. Any login can assign a
          person (incl. themselves, via /me) onto a phase; the program derives. */}
      <OverlayDialog open={assignOpen} onClose={() => setAssignOpen(false)} width="30rem"
        title={t(locale, 'addToProgram')} closeLabel={t(locale, 'close')}>
        <form
          action={async (fd) => { if (await runAction(fd, addPhasePerson)) setAssignOpen(false); }}
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
            <button type="button" onClick={() => setAssignOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving || !pickedProgram} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>

      {/* move dialog */}
      <OverlayDialog open={moveOpen} onClose={() => setMoveOpen(false)} width="30rem"
        title={t(locale, 'moveToDifferentCompany')} closeLabel={t(locale, 'close')}>
        <form
          action={async (fd) => { if (await runAction(fd, movePersonCompany)) setMoveOpen(false); }}
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
            <button type="button" onClick={() => setMoveOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'movePartner')}</button>
          </div>
        </form>
      </OverlayDialog>

      {/* delete dialog */}
      <OverlayDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} width="30rem"
        title={t(locale, 'deletePersonProfile')} closeLabel={t(locale, 'close')}>
        <form
          action={async (fd) => { await runAction(fd, deletePerson); }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="personId" value={personId} />
          {errorLine}
          <p>{t(locale, 'deleteProfileHelp')} <strong>{personName}</strong></p>
          <div className={dash.actionRow}>
            <button type="button" onClick={() => setDeleteOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'deleteProfileBtn')}</button>
          </div>
        </form>
      </OverlayDialog>
    </span>
  );
}

/** "New person" ⋯ menu + create dialog, self-contained (own KebabMenu, like the
 *  PersonAdminControls/PartnerAdminControls above) and shared by the /people list header
 *  and the partner page's People card — so the two never drift into hand-rolled variants.
 *  The create action lives in app/actions/people.ts precisely so this client dialog can
 *  call it. `defaultPartnerId` pre-selects the organization: a partner page passes its own
 *  id so the new contact lands on THAT partner — the same "create from context" the
 *  Programs section uses (a program's partner is pre-filled from /programs/new?partnerId=).
 *
 *  The dialog is a SIBLING of the KebabMenu, never a child (KebabMenu.module.css explains
 *  why a nested dialog gets corrupted by the menu's row rules). */
export function NewPersonButton({ partners, defaultPartnerId }: {
  partners: Option[];
  defaultPartnerId?: number;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <>
      {/* Any login can create a Person; a Person needs no login of their own
          (partner-side contacts are the normal case). */}
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
        <button type="button" data-testid="new-person" onClick={() => setOpen(true)}>
          {t(locale, 'newPerson')}
        </button>
      </KebabMenu>
      <OverlayDialog open={open} onClose={() => setOpen(false)} width="30rem"
        title={t(locale, 'newPerson')} closeLabel={t(locale, 'close')}>
        <form
          action={async (formData) => {
            setSaving(true);
            // createPerson redirects to the new profile on success.
            try { await createPerson(formData); } finally { setSaving(false); }
          }}
          className={dash.dialogForm}
        >
          <div className={dash.textInputGroup}>
            <label htmlFor="npName" className={dash.formLabel}>{t(locale, 'nameLabel')}</label>
            <input id="npName" type="text" name="name" required className={dash.textInput} />
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="npEmail" className={dash.formLabel}>{t(locale, 'emailHeader')}</label>
            <input id="npEmail" type="email" name="email" required className={dash.textInput} />
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="npPartner" className={dash.formLabel}>{t(locale, 'newOrganization')}</label>
            <select id="npPartner" name="partnerId" required className={dash.textInput}
              defaultValue={defaultPartnerId ?? ''}>
              <option value="">{t(locale, 'selectPartner')}</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="npRole" className={dash.formLabel}>{t(locale, 'roleTitle')}</label>
            <input id="npRole" type="text" name="role" placeholder={t(locale, 'roleTitlePlaceholder')} className={dash.textInput} />
          </div>
          <div className={dash.actionRow}>
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>
    </>
  );
}
