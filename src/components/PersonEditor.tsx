'use client';

import React, { useId, useState } from 'react';
import { cancelScheduledChange, createPerson, deletePerson, revisePerson } from '../app/actions/people';
import { addPhasePerson } from '../app/actions/phasePeople';
import { t, type Locale } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import dash from './ProjectStatusDashboard.module.css';
import meta from './ProjectMetaHeader.module.css';
import admin from './ProjectAdminControls.module.css';
import KebabMenu from './KebabMenu';
import OverlayDialog from './OverlayDialog';
import Combobox, { toComboboxOptions } from './Combobox';

// Person maintenance behind the title kebab (the app-wide grammar: quiet ⋯ beside
// the name, dialogs for the work) — replaces the old full-width "Profile
// Maintenance & Administration" form farm.
//
// Since #127 E14 there is ONE editor: the Edit dialog carries name, email, company,
// role, notes AND an effective date, and the date's presence decides what the submit
// means (spec #124 §3). The separate "Move to Different Company" dialog is gone —
// its split from Edit forced a typo'd title and a real transfer through different
// doors, and the wrong door wrote fake history.

interface Option {
  id: number;
  name: string;
}

export interface ProgramOption {
  id: number;
  name: string;
  phases: Option[];
}

/** What the Edit dialog opens WITH — the record as the page rendered it, plus the
 *  scheduled-change case, which seeds the change's own values and date. */
interface ReviseSeed {
  name: string;
  email: string;
  notes: string | null;
  /** Today's employer/title (null in a career gap) — or the scheduled change's. */
  partnerId: number | null;
  role: string | null;
  /** ISO day. Non-null only when editing a SCHEDULED change: re-recording at the same
   *  effective date is how one is corrected (ADR a-move-is-an-insert-into-a-timeline). */
  effectiveDate: string | null;
}

/** Readable day for the readout — prose side of the date boundary (design.md §6). */
const readoutDay = (locale: Locale, iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });

/**
 * The submit wrapper every dialog in this file shares: run a server action, keep its
 * refusal INSIDE the dialog, and report whether it succeeded.
 *
 * A thrown error would hit the route error boundary and destroy the user's modal input,
 * so the actions return `{ error }` instead (lib/actionResult) — a `redirect()` on
 * success still propagates as a throw and navigates, which is why `createPerson` does
 * not come through here. `ran` is returned rather than closing the dialog itself so the
 * caller's inline (deferred) form action owns its own open state, which keeps every ref
 * read out of render.
 */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (
    formData: FormData,
    action: (fd: FormData) => Promise<{ error?: string }>,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const result = await action(formData);
      if (result?.error) {
        setError(result.error);
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/**
 * The ONE person editor (#127 E14). The live readout under the date states in plain
 * language what submitting will DO — correct in place, record a change, or schedule
 * one — which is the safeguard that keeps a typo fix from backfilling a fake job
 * change (#124 §3: it adds no control, it states a consequence).
 *
 * Company is optional (a person in a gap has no employer to seed), but a picked
 * company requires a role — the period's column is non-null, and the schema's refine
 * says the same thing server-side.
 */
function EditPersonDialog({ open, onClose, personId, partners, seed }: {
  open: boolean;
  onClose: () => void;
  personId: number;
  partners: Option[];
  seed: ReviseSeed;
}) {
  const locale = useLocale();
  const { busy: saving, error, run } = useAction();
  const [date, setDate] = useState(seed.effectiveDate ?? '');
  // This dialog renders TWICE on a page with a scheduled change — once behind the
  // kebab, once inside ScheduledChange — and OverlayDialog keeps its children mounted
  // whether open or closed. Module-global ids would duplicate, and every label in the
  // second instance would point at the first one's input. Same fix OverlayDialog uses
  // for its own title id.
  const uid = useId();
  const [partnerId, setPartnerId] = useState<string>(seed.partnerId != null ? String(seed.partnerId) : '');

  // ISO compare — string order IS date order for YYYY-MM-DD. UTC like every date
  // surface here (lib/dates); the readout is a courtesy, the server re-derives.
  const todayIso = new Date().toISOString().slice(0, 10);
  const readout =
    date === ''
      ? t(locale, 'reviseCorrects', { n: seed.name })
      : date > todayIso
        ? t(locale, 'reviseSchedules', { d: readoutDay(locale, date) })
        : t(locale, 'reviseRecordsChange', { d: readoutDay(locale, date) });

  return (
    <OverlayDialog open={open} onClose={onClose} width="30rem"
      title={t(locale, 'editDetails')} closeLabel={t(locale, 'close')}>
      <form
        action={async (fd) => { if (await run(fd, revisePerson)) onClose(); }}
        className={dash.dialogForm}
      >
        <input type="hidden" name="personId" value={personId} />
        {error && <p role="alert" className={admin.warningText}>{error}</p>}
        <div className={dash.textInputGroup}>
          <label htmlFor={`${uid}-personName`} className={dash.formLabel}>{t(locale, 'nameLabel')}</label>
          <input id={`${uid}-personName`} type="text" name="name" required defaultValue={seed.name}
            className={dash.textInput} />
        </div>
        <div className={dash.textInputGroup}>
          <label htmlFor={`${uid}-personEmail`} className={dash.formLabel}>{t(locale, 'emailHeader')}</label>
          <input id={`${uid}-personEmail`} type="email" name="email" required defaultValue={seed.email}
            className={dash.textInput} />
        </div>
        <div className={dash.textInputGroup}>
          <label htmlFor={`${uid}-personPartner`} className={dash.formLabel}>{t(locale, 'organizationLabel')}</label>
          {/* `partnerId` is tracked here, not just posted: naming an organization is what
              makes the role field below required. */}
          <Combobox
            id={`${uid}-personPartner`} name="partnerId"
            options={toComboboxOptions(partners)}
            defaultValue={partnerId}
            emptyLabel={t(locale, 'selectPartner')}
            onChange={setPartnerId}
            aria-label={t(locale, 'organizationLabel')}
          />
        </div>
        <div className={dash.textInputGroup}>
          <label htmlFor={`${uid}-personRole`} className={dash.formLabel}>{t(locale, 'roleTitle')}</label>
          <input id={`${uid}-personRole`} type="text" name="role" required={partnerId !== ''}
            defaultValue={seed.role ?? ''} placeholder={t(locale, 'roleTitlePlaceholder')}
            className={dash.textInput} />
        </div>
        <div className={dash.textInputGroup}>
          <label htmlFor={`${uid}-effectiveDate`} className={dash.formLabel}>{t(locale, 'effectiveDate')}</label>
          <input id={`${uid}-effectiveDate`} type="date" name="effectiveDate" value={date}
            onChange={(e) => setDate(e.target.value)} className={dash.textInput} />
          {/* aria-live: the readout ANSWERS the date field as it changes. */}
          <p className={dash.formHint} aria-live="polite">{readout}</p>
        </div>
        <div className={dash.textInputGroup}>
          <label htmlFor={`${uid}-personNotes`} className={dash.formLabel}>{t(locale, 'personNotesLabel')}</label>
          <textarea id={`${uid}-personNotes`} name="notes" rows={3} defaultValue={seed.notes ?? ''}
            placeholder={t(locale, 'personNotesPlaceholder')} className={dash.textArea} />
        </div>
        <div className={dash.actionRow}>
          <button type="button" onClick={onClose} disabled={saving} className={dash.cancelBtn}>{t(locale, 'cancel')}</button>
          <button type="submit" disabled={saving} className={dash.submitBtn}>{saving ? t(locale, 'saving') : t(locale, 'saveChanges')}</button>
        </div>
      </form>
    </OverlayDialog>
  );
}

/**
 * One scheduled change — "moves to Honda on 1 Nov 2026" — with Edit and Cancel
 * (#124 §3: a pending change nobody can see, or cannot un-record, is Class 1 in a
 * new costume). Edit opens the SAME EditPersonDialog seeded with the change's own
 * values and date: re-recording at the same effective date is the correction path,
 * so there is no second editor to drift.
 */
export function ScheduledChange({ personId, affiliationId, partnerName, dateIso, partners, seed }: {
  personId: number;
  affiliationId: number;
  partnerName: string;
  dateIso: string;
  partners: Option[];
  seed: ReviseSeed;
}) {
  const locale = useLocale();
  const [editOpen, setEditOpen] = useState(false);
  const { busy: cancelling, error, run } = useAction();

  return (
    <>
      <span>
        {t(locale, 'scheduledMovesTo', { c: partnerName, d: readoutDay(locale, dateIso) })}
      </span>
      <button type="button" className={admin.inlineAction} onClick={() => setEditOpen(true)}>
        {t(locale, 'editDetails')}
      </button>
      <form
        action={async (fd) => { await run(fd, cancelScheduledChange); }}
      >
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="affiliationId" value={affiliationId} />
        {/* Testid because this Cancel has a namesake: the Edit dialog below is a CHILD
            of this line, so a text selector reaches both. */}
        <button type="submit" data-testid="cancel-scheduled" disabled={cancelling}
          className={admin.inlineAction}>
          {cancelling ? t(locale, 'saving') : t(locale, 'cancelScheduledChange')}
        </button>
      </form>
      {error && <p role="alert" className={admin.warningText}>{error}</p>}
      <EditPersonDialog open={editOpen} onClose={() => setEditOpen(false)}
        personId={personId} partners={partners} seed={seed} />
    </>
  );
}

// name/email/notes are threaded in rather than re-fetched: the Edit dialog seeds from
// the record the page already rendered, so what you see is what the form opens with —
// including today's employer and title, which the unified dialog now carries.
export default function PersonAdminControls({
  personId, personName, personEmail, personNotes, personPartnerId, personRole, partners, programs,
}: {
  personId: number;
  personName: string;
  personEmail: string;
  personNotes: string | null;
  personPartnerId: number | null;
  personRole: string | null;
  partners: Option[];
  programs: ProgramOption[];
}) {
  const locale = useLocale();
  const [assignOpen, setAssignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { busy: saving, error, run: runAction } = useAction();
  const [pickedProgram, setPickedProgram] = useState<number | ''>('');
  const programPhases = programs.find((pr) => pr.id === pickedProgram)?.phases ?? [];

  const errorLine = error && <p role="alert" className={admin.warningText}>{error}</p>;

  return (
    <span className={meta.actions}>
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
        <button type="button" data-testid="add-to-program" onClick={() => { setPickedProgram(''); setAssignOpen(true); }}>
          {t(locale, 'addToProgram')}
        </button>
        <button type="button" data-testid="edit-person" onClick={() => setEditOpen(true)}>
          {t(locale, 'editDetails')}
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
          <div className={dash.textInputGroup}>
            <label htmlFor="assignProgram" className={dash.formLabel}>{t(locale, 'programLabel')}</label>
            {/* Posts `projectId` itself. The `<select>` this replaced could not — it had no
                `name`, because its value also has to drive the phase list below, so a
                separate hidden input carried the same number to the server. One control
                owning both jobs is one fewer place for them to disagree. */}
            {/* `key` remounts the picker each time the dialog opens, and it is load-bearing:
                `OverlayDialog` keeps children mounted while closed (see `EditPersonDialog`'s
                `uid` note above), and `Combobox` reads `defaultValue` once into state. Without it the
                `setPickedProgram('')` beside `setAssignOpen(true)` resets only THIS
                component — the picker would reopen still showing the last program and
                still posting its id, while the phase list below it, driven by the state
                that did reset, sat empty and disabled. */}
            <Combobox
              key={assignOpen ? 'open' : 'closed'}
              id="assignProgram" name="projectId"
              options={toComboboxOptions(programs)}
              defaultValue={pickedProgram ? String(pickedProgram) : ''}
              emptyLabel={t(locale, 'selectProgram')}
              required
              onChange={(v) => setPickedProgram(v ? parseInt(v, 10) : '')}
              aria-label={t(locale, 'programLabel')}
            />
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

      <EditPersonDialog open={editOpen} onClose={() => setEditOpen(false)} personId={personId}
        partners={partners}
        seed={{ name: personName, email: personEmail, notes: personNotes,
          partnerId: personPartnerId, role: personRole, effectiveDate: null }} />

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
 *  and the partner page's People SECTION heading — so the two never drift into hand-rolled
 *  variants. (It rode in a sidebar card until #127 E12 moved that list to a DataTable.)
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
            <Combobox
              id="npPartner" name="partnerId"
              options={toComboboxOptions(partners)}
              defaultValue={defaultPartnerId != null ? String(defaultPartnerId) : ''}
              emptyLabel={t(locale, 'selectPartner')}
              required
              aria-label={t(locale, 'newOrganization')}
            />
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
