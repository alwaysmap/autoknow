'use client';

import React, { useRef, useEffect } from 'react';
import Link from 'next/link';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { updateProjectMetrics } from '../app/programs/[id]/actions';
import dash from './ProjectStatusDashboard.module.css';
// The involvement pill grammar is shared with the phase cards: solid ink = the OEM
// (primary), light gray = suppliers/other companies, dotted = Googler — the styling
// IS the label.
import pills from './PhaseTrack.module.css';
import styles from './ProjectMetaHeader.module.css';
import KebabMenu from './KebabMenu';
import { localDate } from '../lib/dates';

// Project metadata lives in the page HEADER — one strip, no sidebar card, no
// duplication. Quiet facts on the left (OEM · suppliers · owner, all links per
// design.md §2), and the two numbers leadership actually scans on the right as
// large figures: SOP target date and 12-month volume. The edit dialog rides along.

interface PartnerRef {
  id: number;
  name: string;
}

interface PartnerOption {
  id: number;
  name: string;
  isOem: boolean;
}

interface ProjectMetaHeaderProps {
  projectId: number;
  projectName: string;
  archivedTag?: string | null; // localized "[Archived]" suffix, when archived
  /** Extra small action links (Archive / Delete) rendered after Edit. */
  actions?: React.ReactNode;
  currentNeedle: string;
  currentHillChartProgress: number;
  ownerName: string;
  sopDateString: string; // yyyy-mm-dd or ''
  volumeFirstYear: number;
  hasGas: boolean;
  hasGbi: boolean;
  hasDigitalKey: boolean;
  hasAap: boolean;
  oemPartner?: PartnerRef | null;
  suppliersList?: PartnerRef[];
  currentPartnerId?: number;
  partnerOptions?: PartnerOption[];
}

export default function ProjectMetaHeader({
  projectId, projectName, archivedTag, actions, currentNeedle, currentHillChartProgress,
  ownerName, sopDateString, volumeFirstYear, hasGas, hasGbi, hasDigitalKey, hasAap, oemPartner, suppliersList,
  currentPartnerId, partnerOptions,
}: ProjectMetaHeaderProps) {
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Light-dismiss fallback for browsers without <dialog closedby> support.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !('closedBy' in HTMLDialogElement.prototype)) {
      const onClick = (event: MouseEvent) => {
        if (event.target === dialog) dialog.close();
      };
      dialog.addEventListener('click', onClick);
      return () => dialog.removeEventListener('click', onClick);
    }
  }, []);

  // SOP is a month/year target (last day of month assumed) — display month + year.
  const sop = sopDateString
    ? localDate(`${sopDateString}T00:00:00Z`, locale, { year: 'numeric', month: 'short' })
    : null;
  const sopMonthValue = sopDateString ? sopDateString.slice(0, 7) : ''; // yyyy-MM for <input type="month">
  const products = [
    hasGas && 'GAS',
    hasGbi && 'GBI',
    hasDigitalKey && t(locale, 'productDigitalKey'),
    hasAap && 'AAP',
  ].filter(Boolean) as string[];

  return (
    <div data-testid="project-meta">
      {/* title row: the name with its small action links floating right beside it */}
      <div className={styles.titleRow}>
        <h1 className={styles.title}>
          {projectName}
          {archivedTag && <span className={styles.archived}> {archivedTag}</span>}
        </h1>
        <span className={styles.actions}>
          <KebabMenu ariaLabel={t(locale, 'moreActions')}>
            <button type="button" title={t(locale, 'editMetadata')}
              onClick={() => dialogRef.current?.showModal()}>
              {t(locale, 'edit')}
            </button>
            {actions}
          </KebabMenu>
        </span>
      </div>

      <div className={styles.strip}>
      {/* who: standard involvement pills — solid = OEM/suppliers (lead partners),
          dotted = the Googler owner. The pill styling replaces the old labels. */}
      <div className={styles.facts}>
        {oemPartner ? (
          <Link href={`/partners/${oemPartner.id}`} className={`${pills.pill} ${pills.pillLead}`}
            title="OEM">
            {oemPartner.name}
          </Link>
        ) : (
          <span className={styles.factMuted}>{t(locale, 'tbd')}</span>
        )}
        {(suppliersList ?? []).map((sup) => (
          <Link key={sup.id} href={`/partners/${sup.id}`} className={`${pills.pill} ${pills.pillCompany}`}
            title={t(locale, 'suppliersLabel')}>
            {sup.name}
          </Link>
        ))}
        {ownerName ? (
          <span className={`${pills.pill} ${pills.pillGoogler}`} title={t(locale, 'googlerOwner')}>
            {ownerName}
          </span>
        ) : (
          <span className={styles.factMuted}>{t(locale, 'undecided')}</span>
        )}
        {products.length > 0 && (
          <span className={styles.fact}>
            <span className={styles.factLabel}>{t(locale, 'productsLabel')}</span>
            {products.join(' · ')}
          </span>
        )}
      </div>

      {/* the two figures worth scanning: when, and how big */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t(locale, 'sopTarget')}</div>
          <div className={styles.statValue}>
            {sop ?? <span className={styles.statMuted}>{t(locale, 'notSet')}</span>}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t(locale, 'targetVolume')}</div>
          <div className={styles.statValue}>
            {volumeFirstYear > 0
              ? volumeFirstYear.toLocaleString(locale)
              : <span className={styles.statMuted}>{t(locale, 'notSet')}</span>}
          </div>
        </div>
      </div>

      </div>

      {/* metadata edit dialog (moved from the retired sidebar card) */}
      <dialog ref={dialogRef} closedby="any" className={dash.dialog} aria-labelledby="settingsDialogTitle">
        <div className={dash.dialogHeader}>
          <h3 id="settingsDialogTitle">{t(locale, 'editMetadata')}</h3>
        </div>
        <form
          action={async (formData) => {
            await updateProjectMetrics(formData);
            dialogRef.current?.close();
          }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="theNeedle" value={currentNeedle} />
          <input type="hidden" name="hillChartProgress" value={currentHillChartProgress} />

          {(partnerOptions?.length ?? 0) > 0 && (
            <div className={dash.textInputGroup}>
              <label htmlFor="editLeadPartner" className={dash.formLabel}>{t(locale, 'leadPartnerLabel')}</label>
              <select id="editLeadPartner" name="partnerId" defaultValue={currentPartnerId} className={dash.textInput}>
                {[...partnerOptions!].sort((a, b) => Number(b.isOem) - Number(a.isOem) || a.name.localeCompare(b.name)).map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.name}{po.isOem ? ' (OEM)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={dash.textInputGroup}>
            <label htmlFor="editOwner" className={dash.formLabel}>{t(locale, 'googlerOwner')}</label>
            <input id="editOwner" type="text" name="ownerName" defaultValue={ownerName || ''} placeholder="e.g. jsmith@google.com" className={dash.textInput} />
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="editSop" className={dash.formLabel}>{t(locale, 'sopMonthLabel')}</label>
            <input id="editSop" type="month" name="sopDate" defaultValue={sopMonthValue} required className={dash.textInput} />
          </div>
          <div className={dash.textInputGroup}>
            <span className={dash.formLabel}>{t(locale, 'productsLabel')}</span>
            <label style={{ display: 'block', fontSize: 13 }}>
              <input type="checkbox" name="hasGas" defaultChecked={hasGas} /> {t(locale, 'productGas')}
            </label>
            <label style={{ display: 'block', fontSize: 13 }}>
              <input type="checkbox" name="hasGbi" defaultChecked={hasGbi} /> {t(locale, 'productGbi')}
            </label>
            <label style={{ display: 'block', fontSize: 13 }}>
              <input type="checkbox" name="hasDigitalKey" defaultChecked={hasDigitalKey} /> {t(locale, 'productDigitalKey')}
            </label>
            <label>
              <input type="checkbox" name="hasAap" defaultChecked={hasAap} /> {t(locale, 'productAap')}
            </label>
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="editVolume" className={dash.formLabel}>{t(locale, 'targetVolume')}</label>
            <input id="editVolume" type="number" name="volumeFirstYear" defaultValue={volumeFirstYear} min="0" placeholder="e.g. 50000" className={dash.textInput} />
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="settingsNotes" className={dash.formLabel}>{t(locale, 'updateNoteOptional')}</label>
            <input id="settingsNotes" type="text" name="notes" placeholder={t(locale, 'metadataNotesPlaceholder')} className={dash.textInput} />
          </div>

          <div className={dash.actionRow}>
            <button type="button" onClick={() => dialogRef.current?.close()} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" className={dash.submitBtn}>{t(locale, 'saveSettings')}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
