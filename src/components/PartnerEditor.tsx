'use client';

import React, { useRef, useState, useEffect } from 'react';
import { createPartner, updatePartner, deletePartner } from '../app/actions/partners';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import dash from './ProjectStatusDashboard.module.css';
import meta from './ProjectMetaHeader.module.css';
import admin from './ProjectAdminControls.module.css';
import KebabMenu from './KebabMenu';

// Partner CRUD surfaces. One shared form (create + edit); the partner page gets the
// small Edit · Delete links beside the name (same quiet grammar as programs), the
// /partners list gets a New partner button. Delete refuses honestly while the partner
// still owns programs or people — the dialog explains instead of offering the confirm.

interface Option {
  id: number;
  name: string;
}

export interface PartnerRecord {
  id: number;
  name: string;
  typeId: number | null;
  regionId: number | null;
  phone: string | null;
  website: string | null;
  internalDetailsUrl: string | null;
  summary: string | null;
}

// Light-dismiss fallback for browsers without <dialog closedby> support.
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

function PartnerFormFields({ defaults, types, regions }: { defaults?: PartnerRecord | null; types: Option[]; regions: Option[] }) {
  const locale = useLocale();
  return (
    <>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfName" className={dash.formLabel}>{t(locale, 'partnerName')}</label>
        <input id="pfName" type="text" name="name" required defaultValue={defaults?.name ?? ''} className={dash.textInput} />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfType" className={dash.formLabel}>{t(locale, 'partnerType')}</label>
        <select id="pfType" name="typeId" defaultValue={defaults?.typeId ?? ''} className={dash.textInput}>
          <option value="">—</option>
          {types.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfRegion" className={dash.formLabel}>{t(locale, 'googleRegion')}</label>
        <select id="pfRegion" name="regionId" defaultValue={defaults?.regionId ?? ''} className={dash.textInput} required>
          <option value="">—</option>
          {regions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfPhone" className={dash.formLabel}>{t(locale, 'telephone')}</label>
        <input id="pfPhone" type="text" name="phone" defaultValue={defaults?.phone ?? ''} className={dash.textInput} />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfWebsite" className={dash.formLabel}>{t(locale, 'website')}</label>
        <input id="pfWebsite" type="url" name="website" placeholder="https://…" defaultValue={defaults?.website ?? ''} className={dash.textInput} />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfInternal" className={dash.formLabel}>{t(locale, 'internalDocumentation')}</label>
        <input id="pfInternal" type="url" name="internalDetailsUrl" placeholder="https://…" defaultValue={defaults?.internalDetailsUrl ?? ''} className={dash.textInput} />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfSummary" className={dash.formLabel}>{t(locale, 'relationshipSummary')}</label>
        <textarea id="pfSummary" name="summary" rows={4} defaultValue={defaults?.summary ?? ''} className={dash.textArea} />
      </div>
    </>
  );
}

/** "New partner" button + create dialog, for the /partners list header. */
export function NewPartnerButton({ types, regions }: { types: Option[]; regions: Option[] }) {
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  useLightDismiss(dialogRef);

  return (
    <>
      <button type="button" className={admin.archiveButton} data-testid="new-partner"
        onClick={() => dialogRef.current?.showModal()}>
        {t(locale, 'newPartner')}
      </button>
      <dialog ref={dialogRef} closedby="any" className={admin.dialog} aria-labelledby="newPartnerTitle">
        <div className={admin.dialogHeader}><h3 id="newPartnerTitle">{t(locale, 'newPartner')}</h3></div>
        <form
          action={async (formData) => {
            setSaving(true);
            // createPartner redirects on success — no close needed.
            try { await createPartner(formData); } finally { setSaving(false); }
          }}
          className={dash.dialogForm}
        >
          <PartnerFormFields types={types} regions={regions} />
          <div className={dash.actionRow}>
            <button type="button" onClick={() => dialogRef.current?.close()} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Edit · Delete quiet links beside the partner name, with their dialogs. */
export default function PartnerAdminControls({
  partner, types, regions, programCount, employeeCount,
}: {
  partner: PartnerRecord;
  types: Option[];
  regions: Option[];
  programCount: number;
  employeeCount: number;
}) {
  const locale = useLocale();
  const editRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  useLightDismiss(editRef);
  useLightDismiss(deleteRef);

  const blocked = programCount > 0 || employeeCount > 0;
  const isConfirmed = confirmName.trim() === partner.name;

  return (
    <span className={meta.actions}>
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
        <button type="button" title={t(locale, 'editPartnerTitle')}
          onClick={() => editRef.current?.showModal()}>
          {t(locale, 'edit')}
        </button>
        <button type="button" data-testid="delete-partner"
          onClick={() => { setConfirmName(''); deleteRef.current?.showModal(); }}>
          {t(locale, 'deleteLabel')}
        </button>
      </KebabMenu>

      {/* edit dialog */}
      <dialog ref={editRef} closedby="any" className={admin.dialog} aria-labelledby="editPartnerTitle">
        <div className={admin.dialogHeader}><h3 id="editPartnerTitle">{t(locale, 'editPartnerTitle')}</h3></div>
        <form
          action={async (formData) => {
            setSaving(true);
            try { await updatePartner(formData); editRef.current?.close(); }
            finally { setSaving(false); }
          }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="partnerId" value={partner.id} />
          <PartnerFormFields defaults={partner} types={types} regions={regions} />
          <div className={dash.actionRow}>
            <button type="button" onClick={() => editRef.current?.close()} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </dialog>

      {/* delete dialog — explains the blockers instead of offering a doomed confirm */}
      <dialog ref={deleteRef} closedby="any" className={admin.dialog} aria-labelledby="deletePartnerTitle">
        <div className={admin.dialogHeader}><h3 id="deletePartnerTitle">{t(locale, 'confirmPartnerDeletion')}</h3></div>
        {blocked ? (
          <>
            {programCount > 0 && <p className={admin.warningText}>{t(locale, 'partnerHasPrograms', { n: programCount })}</p>}
            {employeeCount > 0 && <p className={admin.warningText}>{t(locale, 'partnerHasPeople', { n: employeeCount })}</p>}
            <div className={dash.actionRow}>
              <button type="button" onClick={() => deleteRef.current?.close()} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            </div>
          </>
        ) : (
          <>
            <p className={admin.warningText}>
              {t(locale, 'deleteWarning')} <strong>{t(locale, 'cannotBeUndone')}</strong>
            </p>
            <form
              action={async (formData) => {
                if (isConfirmed) await deletePartner(formData);
              }}
              className={admin.dialogForm}
            >
              <input type="hidden" name="partnerId" value={partner.id} />
              <div className={admin.formGroup}>
                <label htmlFor="confirmPartnerName" className={admin.formLabel}>
                  {t(locale, 'confirmTypeName')} (<strong>{partner.name}</strong>):
                </label>
                <input
                  id="confirmPartnerName"
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={t(locale, 'typePartnerNameExactly')}
                  className={admin.textInput}
                  autoComplete="off"
                />
              </div>
              <div className={admin.actionRow}>
                <button type="button" onClick={() => deleteRef.current?.close()} className={admin.cancelBtn}>{t(locale, 'cancel')}</button>
                <button type="submit" disabled={!isConfirmed} className={admin.dangerBtn}>
                  {t(locale, 'permanentlyDeletePartner')}
                </button>
              </div>
            </form>
          </>
        )}
      </dialog>
    </span>
  );
}
