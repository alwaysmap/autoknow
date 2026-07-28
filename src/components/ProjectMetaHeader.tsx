'use client';

import { sopForecastTone } from '../lib/sop';
import ClassBox from './ClassBox';
import React, { useState } from 'react';
import OverlayDialog from './OverlayDialog';
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
import PersonCell, { type PersonRef } from './PersonCell';
import { partnerHref } from '../lib/entityHref';
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


/** One entry in the owner picker: the id it is selected by, the name it reads as, and
 *  the address it submits (the form field is still `ownerName` — lib/owner). */
interface PersonOption {
  id: number;
  name: string;
  email: string;
}

interface ProjectMetaHeaderProps {
  projectId: number;
  projectName: string;
  archivedTag?: string | null; // localized "[Archived]" suffix, when archived
  /** Extra small action links (Archive / Delete) rendered after Edit. */
  actions?: React.ReactNode;
  currentNeedle: string;
  currentHillChartProgress: number;
  /** The program's Googler owner, resolved from `Project.ownerPersonId` (#127 E7).
   *  Was the stored `ownerName` string, which this component re-matched against
   *  `peopleOptions` in two places — the pill and the edit form's default. */
  owner: PersonRef | null;
  sopDateString: string; // yyyy-mm-dd or ''
  /** Schedule forecast, from the same ChainLedger the Critical chain section reads,
   *  so the header and the ledger cannot disagree (#21). */
  projectedFinishMs?: number | null; // forecast finish; null = no phases/chain
  bufferDays?: number | null; // negative = forecast overshoots the SOP
  guidelineDays?: number; // the 50%-rule reserve: buffer below it reads as at-risk
  now?: number; // server-stable clock, so "SOP already passed" doesn't hydrate-drift
  volumeFirstYear: number;
  hasGas: boolean;
  hasGbi: boolean;
  hasDigitalKey: boolean;
  hasAap: boolean;
  oemPartner?: PartnerRef | null;
  suppliersList?: PartnerRef[];
  /** The PROGRAM's lead partner (`Project.partnerId`) — nothing to do with
   *  `Person.currentPartnerId`. It was called `currentPartnerId` until #127 E5, which
   *  made that name actively misleading: a grep for the person cache landed here, and a
   *  reader had to open the call site to learn it was a different table. */
  leadPartnerId?: number;
  partnerOptions?: PartnerOption[];
  /** Existing people — the owner is picked from these, never typed freeform. Just the
   *  picker's options now: since #127 E7 the current owner is preselected BY ID off the
   *  FK, so this no longer has to be a `PersonLike` directory for `resolvePerson` to
   *  match a stored string against. */
  peopleOptions?: PersonOption[];
}

/** One right-aligned figure: an uppercase label over a large value, sharing the
 *  muted "Not set" fallback when the value is absent (null), plus an optional
 *  footer sub-line (the SOP forecast). DRYs the two adjacent stat blocks. */
function Stat({ label, value, footer }: {
  label: string;
  value: React.ReactNode; // null renders the shared muted fallback
  footer?: React.ReactNode;
}) {
  const locale = useLocale();
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>
        {value ?? <span className={styles.statMuted}>{t(locale, 'notSet')}</span>}
      </div>
      {footer}
    </div>
  );
}

export default function ProjectMetaHeader({
  projectId, projectName, archivedTag, actions, currentNeedle, currentHillChartProgress,
  owner, sopDateString, projectedFinishMs, bufferDays, guidelineDays, now,
  volumeFirstYear, hasGas, hasGbi, hasDigitalKey, hasAap, oemPartner, suppliersList,
  leadPartnerId, partnerOptions, peopleOptions,
}: ProjectMetaHeaderProps) {
  const locale = useLocale();
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // SOP forecast sub-line: the deterministic finish date the ledger already knows,
  // coloured by the health palette (§8b tokens, text-only §6) — a fact that used to
  // live only in the AI briefing (#21). Shown ALWAYS when there is a forecast, muted
  // when on track, so a present line reads as "checked" not "only shows up when bad".
  //   overshoot + SOP already passed  -> Concerned (--bad)
  //   overshoot + SOP still ahead      -> Some Risk (--warn)
  //   positive but below the 50% reserve -> Some Risk (--warn)
  //   otherwise                        -> muted
  const forecast = (() => {
    if (projectedFinishMs == null || !sopDateString) return null; // no chain / no SOP
    const date = localDate(new Date(projectedFinishMs), locale, { year: 'numeric', month: 'short', day: 'numeric' });
    const tone = sopForecastTone({
      bufferDays: bufferDays ?? null,
      guidelineDays: guidelineDays ?? null,
      sopMs: Date.parse(`${sopDateString}T00:00:00Z`),
      now: now ?? Date.parse(`${sopDateString}T00:00:00Z`), // no clock ⇒ can't be "passed"
    });
    const color = tone === 'blown' ? 'var(--bad)' : tone === 'atRisk' ? 'var(--warn)' : 'var(--muted)';
    return { date, color };
  })();

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
              onClick={() => setSettingsOpen(true)}>
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
          <Link href={partnerHref(oemPartner.id)} className={`${pills.pill} ${pills.pillLead}`}
            title="OEM">
            {oemPartner.name}
          </Link>
        ) : (
          <span className={styles.factMuted}>{t(locale, 'tbd')}</span>
        )}
        {(suppliersList ?? []).map((sup) => (
          <Link key={sup.id} href={partnerHref(sup.id)} className={`${pills.pill} ${pills.pillCompany}`}
            title={t(locale, 'suppliersLabel')}>
            {sup.name}
          </Link>
        ))}
        {owner ? (
          /* The owner reads by NAME and routes to /people/:id, through the one person
             cell (#153) — the OEM and supplier pills beside it were already links, so
             the owner was this strip's lone plain-text dead end (design.md §2). The
             pill's dotted ink rides on PersonCell's className, as on the phase rail. */
          <PersonCell person={owner}
            className={`${pills.pill} ${pills.pillGoogler}`} title={t(locale, 'googlerOwner')} />
        ) : (
          /* owner is REQUIRED — absence is a to-do, not a quiet fact */
          <button type="button" className={styles.ownerMissing} title={t(locale, 'googlerOwner')}
            onClick={() => setSettingsOpen(true)}>
            {t(locale, 'assignOwner')}
          </button>
        )}
        {products.length > 0 && (
          <span className={styles.fact}>
            <span className={styles.factLabel}>{t(locale, 'productsLabel')}</span>
            {products.map((p) => (
              <ClassBox key={p} className={styles.productBox}>{p}</ClassBox>
            ))}
          </span>
        )}
      </div>

      {/* The two figures worth scanning: how big, then when. Volume leads; SOP TARGET
          sits right-most because it carries the extra forecast line (#21) — pinning the
          sometimes-taller column to the edge reads as more balanced. */}
      <div className={styles.stats}>
        <Stat
          label={t(locale, 'targetVolume')}
          value={volumeFirstYear > 0 ? volumeFirstYear.toLocaleString(locale) : null}
        />
        <Stat
          label={t(locale, 'sopTarget')}
          value={sop}
          footer={forecast && (
            <div className={styles.statForecast} style={{ color: forecast.color }}>
              {t(locale, 'sopForecast', { d: forecast.date })}
            </div>
          )}
        />
      </div>

      </div>

      {/* metadata edit dialog (moved from the retired sidebar card) */}
      <OverlayDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} width="30rem"
        title={t(locale, 'editMetadata')} closeLabel={t(locale, 'close')}>
        <form
          action={async (formData) => {
            await updateProjectMetrics(formData);
            setSettingsOpen(false);
          }}
          className={dash.dialogForm}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="theNeedle" value={currentNeedle} />
          <input type="hidden" name="hillChartProgress" value={currentHillChartProgress} />

          {(partnerOptions?.length ?? 0) > 0 && (
            <div className={dash.textInputGroup}>
              <label htmlFor="editLeadPartner" className={dash.formLabel}>{t(locale, 'leadPartnerLabel')}</label>
              <select id="editLeadPartner" name="partnerId" defaultValue={leadPartnerId} className={dash.textInput}>
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
            {/* Picked from existing people only. The field NAME stays `ownerName`: that
                is the write contract (`requireOwner` turns the submitted address back
                into the {ownerName, ownerPersonId} pair, lib/owner). Only the DEFAULT
                changed — it is now the owner's current address looked up BY ID (#127 E7),
                not a string match, so an owner who has moved still shows as selected. */}
            <select id="editOwner" name="ownerName" required className={dash.textInput}
              defaultValue={(peopleOptions ?? []).find((p) => p.id === owner?.id)?.email ?? ''}>
              <option value="" disabled>{t(locale, 'selectAPerson')}</option>
              {(peopleOptions ?? []).map((p) => (
                <option key={p.id} value={p.email}>{p.name} ({p.email})</option>
              ))}
            </select>
          </div>
          <div className={dash.textInputGroup}>
            <label htmlFor="editSop" className={dash.formLabel}>{t(locale, 'sopMonthLabel')}</label>
            <input id="editSop" type="month" name="sopDate" defaultValue={sopMonthValue} required className={dash.textInput} />
          </div>
          <div className={dash.textInputGroup}>
            <span className={dash.formLabel}>{t(locale, 'productsLabel')}</span>
            <label style={{ display: 'block', fontSize: '0.8125rem' }}>
              <input type="checkbox" name="hasGas" defaultChecked={hasGas} /> {t(locale, 'productGas')}
            </label>
            <label style={{ display: 'block', fontSize: '0.8125rem' }}>
              <input type="checkbox" name="hasGbi" defaultChecked={hasGbi} /> {t(locale, 'productGbi')}
            </label>
            <label style={{ display: 'block', fontSize: '0.8125rem' }}>
              <input type="checkbox" name="hasDigitalKey" defaultChecked={hasDigitalKey} /> {t(locale, 'productDigitalKey')}
            </label>
            <label style={{ display: 'block', fontSize: '0.8125rem' }}>
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
            <button type="button" onClick={() => setSettingsOpen(false)} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" className={dash.submitBtn}>{t(locale, 'saveSettings')}</button>
          </div>
        </form>
      </OverlayDialog>
    </div>
  );
}
