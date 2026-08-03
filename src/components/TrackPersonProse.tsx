'use client';

import React, { createContext, useContext, useState } from 'react';
import { dismissAddress, trackPerson } from '../app/actions/people';
import { inferPartnerFromAddress, type UntrackedContext } from '../lib/untrackedPeople';
import Combobox from './Combobox';
import { toComboboxOptions } from '../lib/comboboxOptions';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import dash from './ProjectStatusDashboard.module.css';
import admin from './ProjectAdminControls.module.css';
import OverlayDialog from './OverlayDialog';
import styles from './TrackPersonProse.module.css';

// The AFFORDANCE half of #126 / #127 E15 — what a claimed mention looks like and what
// clicking it does. The detection is `lib/untrackedPeople` (pure, unit-tested); the
// tracked/dismissed sets come from `lib/untrackedContext` (server). This file is only
// the rendering and the two writes.
//
// QUIET INK, NOT AN ICON (design.md §8c, "icons stay scarce"). At ingestion volume a
// glyph beside every address would carpet the page, so a claimed mention is the prose
// itself, marked at rest by a dotted underline and clickable as a whole — nothing is
// added to the line. It must also never read as PROVENANCE: the ✦ mark says a model
// wrote the words (§8), and this is an action offered ON them, so it borrows none of
// that vocabulary.

/**
 * What a SURFACE hands down to turn the affordance on: the detector's context and the
 * partners its dialog offers. One object because supplying half of it is a page that
 * detects mentions and then cannot create anybody, or a picker with nothing to pick.
 */
/** A partner as the picker and the domain-inference need it. */
export type PartnerOption = { id: number; name: string };

export interface TrackPersonSurface {
  ctx: UntrackedContext;
  partners: PartnerOption[];
}

/** What every claimed mention needs, supplied once per page rather than per mention. */
interface TrackPersonConfig {
  /** Partners for the dialog's picker, and for inferring one from the address domain. */
  partners: PartnerOption[];
  /** The date a new person's first period should START — the MENTION's own date, not
   *  today (#126 decision 3). ISO day. Null when the surface has no date to offer, and
   *  then the dialog says so rather than silently using today. */
  mentionDate: string | null;
}

// A context, because a mention is rendered deep inside a markdown tree it does not own:
// threading three props through every `p`, `li` and `td` would mean the renderer knowing
// about people, which is exactly the coupling this seam exists to avoid.
const TrackPersonCtx = createContext<TrackPersonConfig | null>(null);

export function TrackPersonProvider({ config, children }: {
  config: TrackPersonConfig;
  children: React.ReactNode;
}) {
  return <TrackPersonCtx.Provider value={config}>{children}</TrackPersonCtx.Provider>;
}

/**
 * The create-a-Person form behind a claimed mention. Extracted from `UntrackedMention`
 * because the two sit at different altitudes: one is a word in prose you can click, the
 * other is a form with four fields, a picker, a date prefill and two outcomes.
 *
 * Every prefill is STATED and correctable — the address verbatim, the company inferred
 * from its domain, the date from the mention. A guess presented as a fact is the failure
 * mode; a guess presented as a starting point is the feature.
 */
function TrackPersonDialog({ open, onClose, address, config, onResolved }: {
  open: boolean;
  onClose: () => void;
  address: string;
  config: TrackPersonConfig;
  onResolved: () => void;
}) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fd: FormData, action: (f: FormData) => Promise<{ error?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action(fd);
      if (result?.error) return setError(result.error);
      onResolved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayDialog open={open} onClose={onClose} width="30rem"
      title={t(locale, 'trackPerson')} closeLabel={t(locale, 'close')}>
      <form action={async (fd) => { await run(fd, trackPerson); }} className={dash.dialogForm}>
        {error && <p role="alert" className={admin.warningText}>{error}</p>}
        <p className={dash.formHint}>{t(locale, 'trackPersonIntro', { a: address })}</p>
        <input type="hidden" name="email" value={address} />
        <div className={dash.textInputGroup}>
          <label htmlFor="tpName" className={dash.formLabel}>{t(locale, 'nameLabel')}</label>
          <input id="tpName" type="text" name="name" required autoFocus className={dash.textInput} />
        </div>
        <div className={dash.textInputGroup}>
          <label htmlFor="tpPartner" className={dash.formLabel}>{t(locale, 'organizationLabel')}</label>
          <Combobox
            id="tpPartner" name="partnerId"
            options={toComboboxOptions(config.partners)}
            // The address-derived guess stays a DEFAULT, not a commitment: it pre-fills the
            // picker and the reader can type over it, which is the same contract the
            // `<select>` had.
            defaultValue={String(inferPartnerFromAddress(address, config.partners) ?? '')}
            emptyLabel={t(locale, 'selectPartner')}
            required
            aria-label={t(locale, 'organizationLabel')}
          />
        </div>
        <div className={dash.textInputGroup}>
          <label htmlFor="tpRole" className={dash.formLabel}>{t(locale, 'roleTitle')}</label>
          <input id="tpRole" type="text" name="role" placeholder={t(locale, 'roleTitlePlaceholder')}
            className={dash.textInput} />
        </div>
        <div className={dash.textInputGroup}>
          <label htmlFor="tpStart" className={dash.formLabel}>{t(locale, 'fromLabel')}</label>
          <input id="tpStart" type="date" name="startDate" required className={dash.textInput}
            defaultValue={config.mentionDate ?? new Date().toISOString().slice(0, 10)} />
          <p className={dash.formHint}>
            {config.mentionDate
              ? t(locale, 'trackPersonDateFromMention')
              : t(locale, 'trackPersonDateUnknown')}
          </p>
        </div>
        <div className={dash.actionRow}>
          {/* "Not a person" sits in the dialog rather than beside every mention: it is
              the rarer answer, and a second control in the prose would double the ink
              the quiet-affordance rule exists to limit. Its form is built HERE, next to
              the button that submits it, rather than on every render of the mention. */}
          <button type="button" disabled={busy} className={dash.cancelBtn}
            onClick={() => {
              const fd = new FormData();
              fd.set('address', address);
              return run(fd, dismissAddress);
            }}>
            {t(locale, 'notAPerson')}
          </button>
          <button type="submit" disabled={busy} className={dash.submitBtn}>
            {busy ? t(locale, 'saving') : t(locale, 'trackPerson')}
          </button>
        </div>
      </form>
    </OverlayDialog>
  );
}

/**
 * One claimed mention: the words as written, and the offer they carry.
 *
 * Renders as PLAIN TEXT when no provider is above it — a surface that has not opted in
 * shows the prose unchanged rather than a dead control, which is what keeps this safe to
 * put in the shared `Markdown` component.
 */
export function UntrackedMention({ address, children }: {
  address: string;
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const config = useContext(TrackPersonCtx);
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState(false);

  if (!config) return <>{children}</>;
  // Once tracked or dismissed the offer is spent, and the words go back to being words.
  // The next load will not claim this mention at all — the address is now on file, or on
  // the ignore list; this is what the reader sees in the meantime.
  if (resolved) return <>{children}</>;

  return (
    <>
      {/* The mention IS the button — see the stylesheet for why an adjacent control
          could not work in prose. The accessible name carries the offer, since the
          visible text is only the address the author wrote. */}
      <button type="button" className={styles.mention} onClick={() => setOpen(true)}
        title={t(locale, 'trackPersonHint', { a: address })}
        aria-label={t(locale, 'trackPersonHint', { a: address })}>
        {children}
      </button>
      <TrackPersonDialog open={open} onClose={() => setOpen(false)} address={address}
        config={config} onResolved={() => { setResolved(true); setOpen(false); }} />
    </>
  );
}
