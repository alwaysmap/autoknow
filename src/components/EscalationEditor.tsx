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
import KebabMenu from './KebabMenu';
import OverlayDialog from './OverlayDialog';
import styles from './EscalationEditor.module.css';
import useDialogAction from './useDialogAction';
import Combobox from './Combobox';
import { toComboboxOptions, type NamedRow } from '../lib/comboboxOptions';

// Escalation write surfaces (#245 part a): one shared form for create and edit, plus the
// status control. The LIST header gets a New button in a ⋯ menu — creating is incidental
// to browsing. The DETAIL page does not: see EscalationAdminControls below.
//
// Every field that names another entity is a PICKER over existing rows, never free text
// (AGENTS lesson 3): the three person roles, the partner and the program. That is also why
// the webhook leaves all three people unassigned — a name guessed from a chat digest would
// be exactly the free-text write this rule exists to prevent, with a real person's name on
// the wrong escalation.
//
// `originalRequest` appears in NO form here. It is provenance, and a field that must never
// be edited must not be rendered as an input that could be.

export interface EscalationRecord {
  id: number;
  title: string;
  summary: string | null;
  status: EscalationStatus;
  severity: EscalationSeverity | null;
  orgLevel: EscalationOrgLevel | null;
  /** ISO string, or null — serialized by the server page, since a Date cannot cross
   *  the server/client boundary as a prop. */
  targetDate: string | null;
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
  partners: NamedRow[];
  projects: NamedRow[];
  people: NamedRow[];
}) {
  const locale = useLocale();
  // A person picker three times over, so the three roles cannot drift apart in markup the
  // way three hand-written comboboxes would. `Combobox` (gh-269) replaces the bare
  // `<select>` this used to be: with 15 people in the seed and hundreds in a real
  // deployment, scrolling a closed dropdown to find one name does not scale — this one
  // types "vol" and narrows to it.
  const personPicker = (id: string, name: string, label: string, value: number | null) => (
    <div className={dash.textInputGroup}>
      <label htmlFor={id} data-eyebrow>{label}</label>
      <Combobox
        id={id} name={name}
        options={toComboboxOptions(people)}
        defaultValue={value != null ? String(value) : ''}
        emptyLabel={t(locale, 'escUnassigned')}
        aria-label={label}
      />
    </div>
  );

  return (
    <>
      <div className={dash.textInputGroup}>
        <label htmlFor="efTitle" data-eyebrow>{t(locale, 'escStatement')}</label>
        <input
          id="efTitle" type="text" name="title" required
          placeholder={t(locale, 'escTitlePlaceholder')}
          defaultValue={defaults?.title ?? ''} className={dash.textInput}
        />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="efSummary" data-eyebrow>{t(locale, 'escSummaryLabel')}</label>
        <textarea id="efSummary" name="summary" rows={4} defaultValue={defaults?.summary ?? ''} className={dash.textArea} />
      </div>

      {/* Partner and/or program — at least one, enforced at the zod boundary. Neither is
          marked `required` in the markup, because the requirement is on the PAIR and a
          browser can only express it per field: marking both would demand both. */}
      <div className={dash.textInputGroup}>
        <label htmlFor="efPartner" data-eyebrow>{t(locale, 'partnerLabel')}</label>
        <Combobox
          id="efPartner" name="partnerId"
          options={toComboboxOptions(partners)}
          defaultValue={defaults?.partnerId != null ? String(defaults.partnerId) : ''}
          emptyLabel={t(locale, 'escNoPartner')}
          aria-label={t(locale, 'partnerLabel')}
        />
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="efProject" data-eyebrow>{t(locale, 'programLabel')}</label>
        <Combobox
          id="efProject" name="projectId"
          options={toComboboxOptions(projects)}
          defaultValue={defaults?.projectId != null ? String(defaults.projectId) : ''}
          emptyLabel={t(locale, 'escNoProgram')}
          aria-label={t(locale, 'programLabel')}
        />
      </div>

      {/* Triage. Blank is a real answer — "not yet triaged" — so both keep an empty
          option rather than defaulting to a middle value nobody chose. */}
      <div className={dash.textInputGroup}>
        <label htmlFor="efSeverity" data-eyebrow>{t(locale, 'escSeverityLabel')}</label>
        <select id="efSeverity" name="severity" defaultValue={defaults?.severity ?? ''} className={dash.textInput}>
          <option value="">{t(locale, 'escUntriaged')}</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{t(locale, SEVERITY_KEY[s])}</option>)}
        </select>
      </div>
      <div className={dash.textInputGroup}>
        <label htmlFor="efOrgLevel" data-eyebrow>{t(locale, 'escOrgLevelLabel')}</label>
        <select id="efOrgLevel" name="orgLevel" defaultValue={defaults?.orgLevel ?? ''} className={dash.textInput}>
          <option value="">{t(locale, 'escUntriaged')}</option>
          {ORG_LEVELS.map((o) => <option key={o} value={o}>{t(locale, ORG_LEVEL_KEY[o])}</option>)}
        </select>
      </div>

      <div className={dash.textInputGroup}>
        <label htmlFor="efTarget" data-eyebrow>{t(locale, 'escTargetDate')}</label>
        {/* Blank is a real answer and stays blank — no default. `toISOString().slice(0,10)`
            is the value shape `type="date"` requires. */}
        <input
          id="efTarget" type="date" name="targetDate"
          defaultValue={defaults?.targetDate ? defaults.targetDate.slice(0, 10) : ''}
          className={dash.textInput}
        />
      </div>

      {personPicker('efOwner', 'ownerPersonId', t(locale, 'escOwner'), defaults?.ownerPersonId ?? null)}
      {personPicker('efDecider', 'decisionMakerPersonId', t(locale, 'escDecisionMaker'), defaults?.decisionMakerPersonId ?? null)}
      {personPicker('efRequestedOf', 'requestedOfPersonId', t(locale, 'escRequestedOf'), defaults?.requestedOfPersonId ?? null)}
    </>
  );
}

/** "New escalation" button + create dialog, for the /escalations list header. */
export function NewEscalationButton({
  partners, projects, people,
}: {
  partners: NamedRow[];
  projects: NamedRow[];
  people: NamedRow[];
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
      <OverlayDialog open={open} onClose={() => setOpen(false)} width="52rem"
        title={t(locale, 'newEscalation')} closeLabel={t(locale, 'close')}>
        <form action={async (fd) => { await runAction(fd, createEscalation); }} className={dash.dialogForm}>
          {errorLine}
          <div className={styles.formGrid}>
            <EscalationFormFields partners={partners} projects={projects} people={people} />
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

/**
 * The escalation's own action panel — the two things this page exists to do, ON the page.
 *
 * They used to live behind a ⋯ menu, which is right for a LIST header (one row among many,
 * actions are incidental) and wrong here: a detail page is opened in order to act on the
 * one record it shows, and closing was four interactions deep — kebab, menu item, dialog,
 * select, save. The close reason is now a picker sitting in the open, so the common case is
 * pick-and-press. The kebab is gone rather than kept alongside: two doors to one action is
 * the duplication the reviews here keep deleting.
 *
 * The panel offers exactly the transitions `lib/escalation.canTransition` allows, which is
 * the property the dialog version had and the one worth keeping: a control that offers a
 * change the server action then refuses is `autoknow-aa7` in miniature — a surface forming
 * its own opinion about what the boundary will accept.
 *
 * EDIT stays a dialog, because it is a whole form rather than one decision — but a wide
 * one, in two columns (see `formGrid`): the old 30rem sheet stacked eleven fields into a
 * scrolling column while the page around it sat empty.
 */
export default function EscalationAdminControls({
  escalation, partners, projects, people, duplicateCandidates,
}: {
  escalation: EscalationRecord;
  partners: NamedRow[];
  projects: NamedRow[];
  people: NamedRow[];
  /** Candidates for "duplicate of": every OTHER escalation, whatever its status — a
   *  duplicate of a closed one is an ordinary thing to record. Excluding THIS row is the
   *  caller's job (see the detail page), so the option a row could use to become its own
   *  duplicate never reaches the client. */
  duplicateCandidates: NamedRow[];
}) {
  const locale = useLocale();
  const [editOpen, setEditOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<EscalationStatus>(
    isClosed(escalation.status) ? 'open' : 'resolved',
  );
  // TWO runners, not one: `errorLine` is rendered in two places here (the panel and the
  // dialog), and a shared one would paint a failed edit onto the page behind its own open
  // dialog. Each surface owns its own error.
  const status = useDialogAction();
  const edit = useDialogAction();

  const closed = isClosed(escalation.status);

  return (
    <div className={styles.panel}>
      {status.errorLine}

      {closed ? (
        // A closed escalation offers re-open and nothing else — the same set
        // `canTransition` allows, so the panel cannot offer a change the action refuses.
        <form
          action={async (fd) => { await status.runAction(fd, setEscalationStatus); }}
          className={styles.statusForm}
        >
          <input type="hidden" name="escalationId" value={escalation.id} />
          <input type="hidden" name="status" value="open" />
          <button type="submit" data-testid="escalation-reopen" disabled={status.saving} className={styles.primaryBtn}>
            {status.saving ? t(locale, 'saving') : t(locale, 'escReopen')}
          </button>
        </form>
      ) : (
        <form
          action={async (fd) => { await status.runAction(fd, setEscalationStatus); }}
          className={styles.statusForm}
        >
          <input type="hidden" name="escalationId" value={escalation.id} />
          <label htmlFor="escCloseAs" data-eyebrow>{t(locale, 'escCloseAs')}</label>
          <div className={styles.statusRow}>
            <select
              id="escCloseAs" name="status" className={styles.select}
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as EscalationStatus)}
            >
              {/* Bare names: the label already says "Close as", so the "Closed — " form
                  would say closed twice (lib/escalation). */}
              {TERMINAL_STATUSES.map((s) => (
                <option key={s} value={s}>{t(locale, STATUS_KEY[s])}</option>
              ))}
            </select>
            <button type="submit" data-testid="escalation-close" disabled={status.saving} className={styles.primaryBtn}>
              {status.saving ? t(locale, 'saving') : t(locale, 'escClose')}
            </button>
          </div>
          {/* Only `duplicate` needs a target, so the picker appears only for it — a
              permanently visible one would read as a field every close must answer. */}
          {nextStatus === 'duplicate' && (
            <Combobox
              id="escDuplicateOf" name="duplicateOfId"
              // The id is IN the label, not just the value: escalation titles repeat across
              // programs, so "#42" is often the only thing that distinguishes two rows a
              // reader is choosing between. Hence an inline map rather than
              // `toComboboxOptions`, whose label is the bare name.
              options={duplicateCandidates.map((e) => ({ value: String(e.id), label: `#${e.id} — ${e.name}` }))}
              emptyLabel={t(locale, 'escDuplicateOfPlaceholder')}
              required
              className={styles.select}
              // The accessible name NAMES the field; the prompt is the placeholder above.
              // This picker has no visible label — it is revealed inline by the status
              // choice — so the name is the only thing that says what it is asking for.
              aria-label={t(locale, 'escDuplicateOf')}
            />
          )}
        </form>
      )}

      <button type="button" data-testid="escalation-edit" onClick={() => setEditOpen(true)} className={styles.secondaryBtn}>
        {t(locale, 'escEdit')}
      </button>

      <OverlayDialog open={editOpen} onClose={() => setEditOpen(false)} width="52rem"
        title={t(locale, 'escEdit')} closeLabel={t(locale, 'close')}>
        <form
          action={async (fd) => { if (await edit.runAction(fd, updateEscalation)) setEditOpen(false); }}
          className={dash.dialogForm}
        >
          {edit.errorLine}
          <input type="hidden" name="escalationId" value={escalation.id} />
          <div className={styles.formGrid}>
            <EscalationFormFields defaults={escalation} partners={partners} projects={projects} people={people} />
          </div>
          <div className={dash.actionRow}>
            <button type="button" onClick={() => setEditOpen(false)} disabled={edit.saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
            <button type="submit" disabled={edit.saving} className={dash.submitBtn}>{edit.saving ? t(locale, 'saving') : t(locale, 'save')}</button>
          </div>
        </form>
      </OverlayDialog>
    </div>
  );
}
