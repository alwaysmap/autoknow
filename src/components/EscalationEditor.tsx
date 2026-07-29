'use client';

import React, { useState } from 'react';
import {
  createEscalation,
  setEscalationStatus,
  updateEscalation,
} from '../app/actions/escalations';
import {
  ORG_LEVELS,
  ORG_LEVEL_KEY,
  SEVERITIES,
  SEVERITY_KEY,
  STATUS_KEY,
  TERMINAL_STATUSES,
  isClosed,
  type EscalationOrgLevel,
  type EscalationSeverity,
  type EscalationStatus,
} from '../lib/escalation';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import dash from './ProjectStatusDashboard.module.css';
import meta from './ProjectMetaHeader.module.css';
import KebabMenu from './KebabMenu';
import OverlayDialog from './OverlayDialog';
import useDialogAction from './useDialogAction';

// Escalation write surfaces (#245 part a): one shared form for create and edit, plus the
// status control. Mirrors `PartnerEditor` — the list header gets a New button, the detail
// page gets quiet Edit · Change status affordances in a ⋯ menu.
//
// Every field that names another entity is a PICKER over existing rows, never free text
// (AGENTS lesson 3): the three person roles, the partner and the program. That is also why
// the webhook leaves all three people unassigned — a name guessed from a chat digest would
// be exactly the free-text write this rule exists to prevent, with a real person's name on
// the wrong escalation.
//
// `originalRequest` appears in NO form here. It is provenance, and a field that must never
// be edited must not be rendered as an input that could be.

interface Option {
  id: number;
  name: string;
}

export interface EscalationRecord {
  id: number;
  title: string;
  summary: string | null;
  status: EscalationStatus;
  severity: EscalationSeverity | null;
  orgLevel: EscalationOrgLevel | null;
  partnerId: number | null;
  projectId: number | null;
  ownerPersonId: number | null;
  decisionMakerPersonId: number | null;
  requestedOfPersonId: number | null;
}

function EscalationFormFields({
  defaults,
  partners,
  projects,
  people,
}: {
  defaults?: EscalationRecord | null;
  partners: Option[];
  projects: Option[];
  people: Option[];
}) {
  const locale = useLocale();
  // A person picker three times over, so the three roles cannot drift apart in markup the
  // way three hand-written selects would.
  const personSelect = (id: string, name: string, label: string, value: number | null) => (
    <div className={dash.textInputGroup}>
      <label htmlFor={id} className={dash.formLabel}>{label}</label>
      <select id={id} name={name} defaultValue={value ?? ''} className={dash.textInput}>
        <option value="">{t(locale, 'escUnassigned')}</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <div className={dash.textInputGroup}>
        <label htmlFor="efTitle" className={dash.formLabel}>{t(locale, 'escStatement')}</label>
        <input
          id="efTitle" type="text" name="title" required
          placeholder={t(locale, 'escTitlePlaceholder')}
          defaultValue={defaults?.title ?? ''} className={dash.textInput}
        />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="efSummary" className={dash.formLabel}>{t(locale, 'escSummaryLabel')}</label>
        <textarea id="efSummary" name="summary" rows={4} defaultValue={defaults?.summary ?? ''} className={dash.textArea} />
      </div>

      {/* Partner and/or program — at least one, enforced at the zod boundary. Neither is
          marked `required` in the markup, because the requirement is on the PAIR and a
          browser can only express it per field: marking both would demand both. */}
      <div className={dash.textInputGroup}>
        <label htmlFor="efPartner" className={dash.formLabel}>{t(locale, 'partnerLabel')}</label>
        <select id="efPartner" name="partnerId" defaultValue={defaults?.partnerId ?? ''} className={dash.textInput}>
          <option value="">—</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="efProject" className={dash.formLabel}>{t(locale, 'programLabel')}</label>
        <select id="efProject" name="projectId" defaultValue={defaults?.projectId ?? ''} className={dash.textInput}>
          <option value="">—</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Triage. Blank is a real answer — "not yet triaged" — so both keep an empty
          option rather than defaulting to a middle value nobody chose. */}
      <div className={dash.textInputGroup}>
        <label htmlFor="efSeverity" className={dash.formLabel}>{t(locale, 'escSeverityLabel')}</label>
        <select id="efSeverity" name="severity" defaultValue={defaults?.severity ?? ''} className={dash.textInput}>
          <option value="">{t(locale, 'escUntriaged')}</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{t(locale, SEVERITY_KEY[s])}</option>)}
        </select>
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="efOrgLevel" className={dash.formLabel}>{t(locale, 'escOrgLevelLabel')}</label>
        <select id="efOrgLevel" name="orgLevel" defaultValue={defaults?.orgLevel ?? ''} className={dash.textInput}>
          <option value="">{t(locale, 'escUntriaged')}</option>
          {ORG_LEVELS.map((o) => <option key={o} value={o}>{t(locale, ORG_LEVEL_KEY[o])}</option>)}
        </select>
      </div>

      {personSelect('efOwner', 'ownerPersonId', t(locale, 'escOwner'), defaults?.ownerPersonId ?? null)}
      {personSelect('efDecider', 'decisionMakerPersonId', t(locale, 'escDecisionMaker'), defaults?.decisionMakerPersonId ?? null)}
      {personSelect('efRequestedOf', 'requestedOfPersonId', t(locale, 'escRequestedOf'), defaults?.requestedOfPersonId ?? null)}
    </>
  );
}

/** "New escalation" button + create dialog, for the /escalations list header. */
export function NewEscalationButton({
  partners, projects, people,
}: {
  partners: Option[];
  projects: Option[];
  people: Option[];
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { saving, errorLine, runAction } = useDialogAction();

  return (
    <>
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
        <button type="button" data-testid="new-escalation" onClick={() => setOpen(true)}>
          {t(locale, 'newEscalation')}
        </button>
      </KebabMenu>
      <OverlayDialog open={open} onClose={() => setOpen(false)} width="30rem"
        title={t(locale, 'newEscalation')} closeLabel={t(locale, 'close')}>
        <form action={async (fd) => { await runAction(fd, createEscalation); }} className={dash.dialogForm}>
          {errorLine}
          <EscalationFormFields partners={partners} projects={projects} people={people} />
          <div className={dash.actionRow}>
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>
    </>
  );
}

/**
 * Edit · Change status, in the detail page's ⋯ menu.
 *
 * The status dialog offers only the transitions `lib/escalation.canTransition` allows —
 * an OPEN escalation offers the four ways to close, a CLOSED one offers re-open and
 * nothing else. That is the same predicate the server action enforces, so the UI cannot
 * offer a change the boundary will refuse (the `autoknow-aa7` failure, in miniature: a
 * dialog that formed its own opinion about what the server would allow).
 */
export default function EscalationAdminControls({
  escalation, partners, projects, people, duplicateCandidates,
}: {
  escalation: EscalationRecord;
  partners: Option[];
  projects: Option[];
  people: Option[];
  /** Candidates for "duplicate of": every OTHER escalation, whatever its status — a
   *  duplicate of a closed one is an ordinary thing to record. Excluding THIS row is the
   *  caller's job (see the detail page), so the option a row could use to become its own
   *  duplicate never reaches the client. */
  duplicateCandidates: Option[];
}) {
  const locale = useLocale();
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<EscalationStatus>(
    isClosed(escalation.status) ? 'open' : 'resolved',
  );
  const { saving, errorLine, runAction } = useDialogAction();

  const closed = isClosed(escalation.status);
  const choices: EscalationStatus[] = closed ? ['open'] : TERMINAL_STATUSES;

  return (
    <span className={meta.actions}>
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
        <button type="button" onClick={() => setEditOpen(true)}>{t(locale, 'edit')}</button>
        <button type="button" data-testid="escalation-status" onClick={() => setStatusOpen(true)}>
          {closed ? t(locale, 'escReopen') : t(locale, 'escChangeStatus')}
        </button>
      </KebabMenu>

      <OverlayDialog open={editOpen} onClose={() => setEditOpen(false)} width="30rem"
        title={t(locale, 'escEdit')} closeLabel={t(locale, 'close')}>
        <form
          action={async (fd) => { if (await runAction(fd, updateEscalation)) setEditOpen(false); }}
          className={dash.dialogForm}
        >
          {errorLine}
          <input type="hidden" name="escalationId" value={escalation.id} />
          <EscalationFormFields defaults={escalation} partners={partners} projects={projects} people={people} />
          <div className={dash.actionRow}>
            <button type="button" onClick={() => setEditOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>

      <OverlayDialog open={statusOpen} onClose={() => setStatusOpen(false)} width="30rem"
        title={closed ? t(locale, 'escReopen') : t(locale, 'escClose')} closeLabel={t(locale, 'close')}>
        <form
          action={async (fd) => { if (await runAction(fd, setEscalationStatus)) setStatusOpen(false); }}
          className={dash.dialogForm}
        >
          {errorLine}
          <input type="hidden" name="escalationId" value={escalation.id} />
          <div className={dash.textInputGroup}>
            <label htmlFor="esStatus" className={dash.formLabel}>{t(locale, 'escCloseAs')}</label>
            <select
              id="esStatus" name="status" className={dash.textInput}
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as EscalationStatus)}
            >
              {/* Bare names, not the "Closed — " forms: the label above already says
                  "Close as", so the qualifier would be said twice (lib/escalation). */}
              {choices.map((s) => (
                <option key={s} value={s}>{t(locale, STATUS_KEY[s])}</option>
              ))}
            </select>
          </div>
          {/* Only `duplicate` needs a target, so the picker appears only for it — a
              permanently visible "duplicate of" select would read as a field every close
              has to answer. Required here mirrors the zod refinement. */}
          {nextStatus === 'duplicate' && (
            <div className={dash.textInputGroup}>
              <label htmlFor="esDuplicateOf" className={dash.formLabel}>{t(locale, 'escDuplicateOf')}</label>
              <select id="esDuplicateOf" name="duplicateOfId" required className={dash.textInput} defaultValue="">
                <option value="">{t(locale, 'escDuplicateOfPlaceholder')}</option>
                {duplicateCandidates.map((e) => <option key={e.id} value={e.id}>#{e.id} — {e.name}</option>)}
              </select>
            </div>
          )}
          <div className={dash.actionRow}>
            <button type="button" onClick={() => setStatusOpen(false)} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>
    </span>
  );
}
