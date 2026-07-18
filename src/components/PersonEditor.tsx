'use client';

import React, { useRef, useState, useEffect } from 'react';
import { movePersonCompany, copyPerson, deletePerson } from '../app/actions/people';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import dash from './ProjectStatusDashboard.module.css';
import meta from './ProjectMetaHeader.module.css';
import admin from './ProjectAdminControls.module.css';
import KebabMenu from './KebabMenu';

// Person maintenance behind the title kebab (the app-wide grammar: quiet ⋯ beside
// the name, dialogs for the work) — replaces the old full-width "Profile
// Maintenance & Administration" form farm.

interface Option {
  id: number;
  name: string;
}

function useLightDismiss(ref: React.RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !('closedBy' in HTMLDialogElement.prototype)) {
      const onClick = (event: MouseEvent) => {
        if (event.target === dialog) dialog.close();
      };
      dialog.addEventListener('click', onClick);
      return () => dialog.removeEventListener('click', onClick);
    }
  }, [ref]);
}

export default function PersonAdminControls({ personId, personName, partners }: {
  personId: number;
  personName: string;
  partners: Option[];
}) {
  const locale = useLocale();
  const moveRef = useRef<HTMLDialogElement>(null);
  const copyRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  useLightDismiss(moveRef);
  useLightDismiss(copyRef);
  useLightDismiss(deleteRef);

  return (
    <span className={meta.actions}>
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
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

      {/* move dialog */}
      <dialog ref={moveRef} closedby="any" className={admin.dialog} aria-labelledby="movePersonTitle">
        <div className={admin.dialogHeader}><h3 id="movePersonTitle">{t(locale, 'moveToDifferentCompany')}</h3></div>
        <form
          action={async (formData) => {
            setSaving(true);
            try { await movePersonCompany(formData); moveRef.current?.close(); }
            finally { setSaving(false); }
          }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="personId" value={personId} />
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
          action={async (formData) => {
            setSaving(true);
            // copyPerson redirects on success — no close needed.
            try { await copyPerson(formData); } finally { setSaving(false); }
          }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="personId" value={personId} />
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
          action={async (formData) => {
            setSaving(true);
            // deletePerson redirects on success.
            try { await deletePerson(formData); } finally { setSaving(false); }
          }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="personId" value={personId} />
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
