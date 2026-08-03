'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import PersonCell from './PersonCell';
import Combobox, { toComboboxOptions } from './Combobox';
import { addPhasePartner, removePhasePartner } from '../app/actions/phasePartners';
import { addPhasePerson, removePhasePerson } from '../app/actions/phasePeople';
import type { ActionResult } from '../lib/actionResult';
import { partnerHref } from '../lib/entityHref';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './PhaseInvolvementEditor.module.css';

// THE control for changing who is involved in a phase — one implementation for
// partners and for people, and one for every surface that offers the edit. It renders
// the CONTENTS of a value cell (chips, then the add affordance), so each host keeps its
// own section grammar: the phase editor's panel gives it a full-width heading, the
// rail's About pane gives it a label column.
//
// It existed three times before this — twice hand-rolled in PhaseTrack (partners and
// people, character for character) and a third, drifted, English-only copy in
// PhaseGraph (AGENTS lesson 7). The divergence was not cosmetic: only PhaseTrack's
// copy said WHY there was nothing left to add, and none of them could show a server
// refusal, so a rejected reference simply did nothing.
//
// Entity references here are pickers over canonical keys (AGENTS lesson 3): the
// <select>'s options ARE the existing rows and its value is the row id. The picker is
// the affordance, never the guarantee — `lib/phaseInvolvement` re-resolves every id
// server-side and refuses a non-match with a sentence, which lands in `error` below.

/** One PhasePartner / PhasePerson row, as the chip that shows it. */
export interface InvolvementLink {
  linkId: number; // the join row — what remove deletes
  entityId: number; // the partner or person it names
  name: string;
  role: string | null;
}

export type InvolvementKind = 'partner' | 'person';

/** Everything that differs between the two kinds, in ONE place — so adding a third,
 *  or renaming a key, is one edit rather than a hunt through a dozen ternaries.
 *  Exported with `sectionLabel` because the HOSTS draw the section around this control
 *  and would otherwise re-hand-roll the very branching this table exists to own. */
export const INVOLVEMENT_KINDS = {
  partner: {
    add: addPhasePartner, remove: removePhasePartner, idField: 'partnerId',
    sectionLabel: 'partnersLabel', pickLabel: 'partnerToInvolve',
    addLabel: 'addPartner', exhaustedLabel: 'allPartnersInvolved',
  },
  person: {
    add: addPhasePerson, remove: removePhasePerson, idField: 'personId',
    sectionLabel: 'peopleLabel', pickLabel: 'personToInvolve',
    addLabel: 'addPerson', exhaustedLabel: 'allPeopleInvolved',
  },
} as const;

interface PhaseInvolvementEditorProps {
  kind: InvolvementKind;
  phaseId: number;
  projectId: number;
  involved: InvolvementLink[];
  /** Every candidate row. The picker's options are exactly this set, minus the joined. */
  options: { id: number; name: string }[];
}

export default function PhaseInvolvementEditor({
  kind, phaseId, projectId, involved, options,
}: PhaseInvolvementEditorProps) {
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const { add, remove, idField, pickLabel, addLabel, exhaustedLabel } = INVOLVEMENT_KINDS[kind];
  const available = options.filter((o) => !involved.some((i) => i.entityId === o.id));

  // Every mutation reports through the same channel, so a server refusal is visible
  // instead of a form that submitted and changed nothing.
  const submitAndReport = async (fd: FormData, action: (f: FormData) => Promise<ActionResult>) => {
    const result = await action(fd);
    setError(result.error ?? '');
    return !result.error;
  };

  return (
    <>
      {involved.map((link) => (
        // a stable hook, because the chip is asserted on from three surfaces and a
        // CSS-module class name is not a contract
        <span key={link.linkId} className={styles.chip} data-testid="involvement-chip">
          {kind === 'partner' ? (
            <Link href={partnerHref(link.entityId)} className={styles.entityLink}>{link.name}</Link>
          ) : (
            /* a person, through the one person cell (#153) — the chip's own ink, but
               the name/route rule lives in one place */
            <PersonCell person={{ id: link.entityId, name: link.name }} className={styles.entityLink} />
          )}
          {link.role && <span className={styles.role}>{link.role}</span>}
          <form
            className={styles.inlineForm}
            action={async (fd) => { await submitAndReport(fd, remove); }}
          >
            <input type="hidden" name="id" value={link.linkId} />
            <input type="hidden" name="projectId" value={projectId} />
            <button type="submit" className={styles.chipRemove}
              title={t(locale, 'removeName', { name: link.name })}
              aria-label={t(locale, 'removeName', { name: link.name })}>✕</button>
          </form>
        </span>
      ))}

      {adding ? (
        <form
          className={styles.addForm}
          action={async (fd) => { if (await submitAndReport(fd, add)) setAdding(false); }}
        >
          <input type="hidden" name="phaseId" value={phaseId} />
          <input type="hidden" name="projectId" value={projectId} />
          <Combobox
            id={`involvement-${kind}-${phaseId}`} name={idField}
            options={toComboboxOptions(available)}
            emptyLabel={t(locale, addLabel)}
            required autoFocus
            className={styles.picker}
            aria-label={t(locale, pickLabel)}
          />
          <input name="role" className={styles.roleInput} placeholder={t(locale, 'role')}
            aria-label={t(locale, 'roleOptional')} />
          <button type="submit" className={styles.miniBtn}>{t(locale, 'add')}</button>
          <button type="button" className={styles.chipRemove} onClick={() => { setAdding(false); setError(''); }}
            aria-label={t(locale, 'cancel')} title={t(locale, 'cancel')}>✕</button>
        </form>
      ) : available.length > 0 ? (
        <button type="button" className={styles.addReveal} onClick={() => setAdding(true)}
          data-testid={`add-${kind}`}
          title={t(locale, pickLabel)} aria-label={t(locale, pickLabel)}>+</button>
      ) : involved.length === 0 ? (
        // never leave the section affordance-less: say WHY there's nothing to add
        <span className={styles.none}>{t(locale, exhaustedLabel)}</span>
      ) : null}

      {error && <span role="alert" className={styles.error}>{error}</span>}
    </>
  );
}
