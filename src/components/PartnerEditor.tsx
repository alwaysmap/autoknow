'use client';

import React, { useState } from 'react';
import { createPartner, updatePartner, deletePartner } from '../app/actions/partners';
import type { PartnerDeleteBlockers } from '../lib/partnerDeletion';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import dash from './ProjectStatusDashboard.module.css';
import meta from './ProjectMetaHeader.module.css';
import admin from './ProjectAdminControls.module.css';
import KebabMenu from './KebabMenu';
import OverlayDialog from './OverlayDialog';
import useDialogAction from './useDialogAction';
import { type NamedRow } from '../lib/comboboxOptions';

// Partner CRUD surfaces. One shared form (create + edit); the partner page gets the
// small Edit · Delete links beside the name (same quiet grammar as programs), the
// /partners list gets a New partner button. Delete refuses honestly while the partner
// still owns programs or people — the dialog explains instead of offering the confirm.
//
// Those blockers arrive PRE-COUNTED, in a shape only `lib/partnerDeletion` can mint, so
// this dialog cannot form a second opinion about what the server action will allow — it
// once did, and offered deletes that were then refused (`autoknow-aa7`).

export interface PartnerRecord {
  id: number;
  name: string;
  typeId: number | null;
  regionId: number | null;
  website: string | null;
  internalDetailsUrl: string | null;
  summary: string | null;
}

function PartnerFormFields({ defaults, types, regions }: { defaults?: PartnerRecord | null; types: NamedRow[]; regions: NamedRow[] }) {
  const locale = useLocale();
  return (
    <>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfName" data-eyebrow>{t(locale, 'partnerName')}</label>
        <input id="pfName" type="text" name="name" required defaultValue={defaults?.name ?? ''} className={dash.textInput} />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfType" data-eyebrow>{t(locale, 'partnerType')}</label>
        <select id="pfType" name="typeId" defaultValue={defaults?.typeId ?? ''} className={dash.textInput}>
          <option value="">—</option>
          {types.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfRegion" data-eyebrow>{t(locale, 'googleRegion')}</label>
        <select id="pfRegion" name="regionId" defaultValue={defaults?.regionId ?? ''} className={dash.textInput} required>
          <option value="">—</option>
          {regions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfWebsite" data-eyebrow>{t(locale, 'website')}</label>
        <input id="pfWebsite" type="url" name="website" placeholder="https://…" defaultValue={defaults?.website ?? ''} className={dash.textInput} />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfInternal" data-eyebrow>{t(locale, 'internalDocumentation')}</label>
        <input id="pfInternal" type="url" name="internalDetailsUrl" placeholder="https://…" defaultValue={defaults?.internalDetailsUrl ?? ''} className={dash.textInput} />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="pfSummary" data-eyebrow>{t(locale, 'relationshipSummary')}</label>
        <textarea id="pfSummary" name="summary" rows={4} defaultValue={defaults?.summary ?? ''} className={dash.textArea} />
      </div>
    </>
  );
}

/** "New partner" button + create dialog, for the /partners list header. */
export function NewPartnerButton({ types, regions }: { types: NamedRow[]; regions: NamedRow[] }) {
  const locale = useLocale();
  const [newOpen, setNewOpen] = useState(false);
  const { saving, errorLine, runAction } = useDialogAction();

  // Self-contained ⋯ menu with the dialog as a SIBLING of the KebabMenu, never a child
  // (KebabMenu.module.css explains why a nested dialog gets corrupted by the row rules).
  return (
    <>
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
        <button type="button" data-testid="new-partner" onClick={() => setNewOpen(true)}>
          {t(locale, 'newPartner')}
        </button>
      </KebabMenu>
      <OverlayDialog open={newOpen} onClose={() => setNewOpen(false)} width="30rem"
        title={t(locale, 'newPartner')} closeLabel={t(locale, 'close')}>
        <form
          action={async (fd) => { await runAction(fd, createPartner); }}
          className={dash.dialogForm}
        >
          {errorLine}
          <PartnerFormFields types={types} regions={regions} />
          <div className={dash.actionRow}>
            <button type="button" onClick={() => setNewOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>
    </>
  );
}

/** Edit · Delete quiet links beside the partner name, with their dialogs. */
export default function PartnerAdminControls({
  partner, types, regions, blockers,
}: {
  partner: PartnerRecord;
  types: NamedRow[];
  regions: NamedRow[];
  blockers: PartnerDeleteBlockers;
}) {
  const locale = useLocale();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const { saving, errorLine, runAction } = useDialogAction();


  // `blocked` is the SERVER's answer to "may this be deleted", not this component's —
  // re-deriving it from the counts below would be a second place deciding that. They are
  // read only to choose which sentences to print, never to gate.
  const { blocked, programCount, employeeCount, escalationCount } = blockers;
  const isConfirmed = confirmName.trim() === partner.name;

  return (
    <span className={meta.actions}>
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
        <button type="button" title={t(locale, 'editPartnerTitle')}
          onClick={() => setEditOpen(true)}>
          {t(locale, 'edit')}
        </button>
        <button type="button" data-testid="delete-partner"
          onClick={() => { setConfirmName(''); setDeleteOpen(true); }}>
          {t(locale, 'deleteLabel')}
        </button>
      </KebabMenu>

      {/* edit dialog */}
      <OverlayDialog open={editOpen} onClose={() => setEditOpen(false)} width="30rem"
        title={t(locale, 'editPartnerTitle')} closeLabel={t(locale, 'close')}>
        <form
          action={async (fd) => { if (await runAction(fd, updatePartner)) setEditOpen(false); }}
          className={dash.dialogForm}
        >
          {errorLine}
          <input type="hidden" name="partnerId" value={partner.id} />
          <PartnerFormFields defaults={partner} types={types} regions={regions} />
          <div className={dash.actionRow}>
            <button type="button" onClick={() => setEditOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>

      {/* delete dialog — explains the blockers instead of offering a doomed confirm */}
      <OverlayDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} width="30rem"
        title={t(locale, 'confirmPartnerDeletion')} closeLabel={t(locale, 'close')}>
        {blocked ? (
          <>
            {programCount > 0 && <p className={admin.warningText}>{t(locale, 'partnerHasPrograms', { n: programCount })}</p>}
            {employeeCount > 0 && <p className={admin.warningText}>{t(locale, 'partnerHasPeople', { n: employeeCount })}</p>}
            {escalationCount > 0 && <p className={admin.warningText}>{t(locale, 'partnerHasEscalations', { n: escalationCount })}</p>}
            <div className={dash.actionRow}>
              <button type="button" onClick={() => setDeleteOpen(false)} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            </div>
          </>
        ) : (
          <>
            <p className={admin.warningText}>
              {t(locale, 'deletePartnerWarning')} <strong>{t(locale, 'cannotBeUndone')}</strong>
            </p>
            <form
              action={async (fd) => { await runAction(fd, async (f) => (isConfirmed ? deletePartner(f) : {})); }}
              className={admin.dialogForm}
            >
              {errorLine}
              <input type="hidden" name="partnerId" value={partner.id} />
              <div className={admin.formGroup}>
                <label htmlFor="confirmPartnerName" className={admin.formLabel}>
                  {t(locale, 'confirmTypePartnerName')} (<strong>{partner.name}</strong>):
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
                <button type="button" onClick={() => setDeleteOpen(false)} className={admin.cancelBtn}>{t(locale, 'cancel')}</button>
                <button type="submit" disabled={!isConfirmed} className={admin.dangerBtn}>
                  {t(locale, 'permanentlyDeletePartner')}
                </button>
              </div>
            </form>
          </>
        )}
      </OverlayDialog>
    </span>
  );
}
