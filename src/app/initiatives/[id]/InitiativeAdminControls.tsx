'use client';

import { useState, useActionState } from 'react';
import KebabMenu from '../../../components/KebabMenu';
import OverlayDialog from '../../../components/OverlayDialog';
import { updateInitiative, archiveInitiative } from '../../actions/initiatives';
import type { ActionResult } from '../../../lib/actionResult';
import { t, type Locale } from '../../../lib/i18n';
import styles from './page.module.css';

// The initiative's own edit affordance (owner call 2026-08-08): a kebab in the title
// row (PageShell actions — §8c, affordances ride INSIDE the heading), opening the one
// modal grammar (OverlayDialog). Editing the TEMPLATE is deliberately absent until the
// propagation mechanism ships (autoknow-hcz.13) — an edit that only affected future
// members would silently violate "all members share the same steps".
export default function InitiativeAdminControls({
  initiativeId,
  name,
  description,
  targetMonth,
  locale,
}: {
  initiativeId: number;
  name: string;
  description: string | null;
  /** 'YYYY-MM' or '' — the form's month-input shape, derived server-side. */
  targetMonth: string;
  locale: Locale;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const r = await updateInitiative(formData);
      if (!r.error) setEditOpen(false);
      return r;
    },
    {},
  );

  return (
    <>
      <KebabMenu ariaLabel={t(locale, 'moreActions')}>
        <button type="button" onClick={() => setEditOpen(true)}>
          {t(locale, 'editInitiative')}
        </button>
        <form
          action={async (formData: FormData) => {
            await archiveInitiative(formData);
          }}
        >
          <input type="hidden" name="initiativeId" value={initiativeId} />
          <button type="submit">{t(locale, 'archiveInitiativeAction')}</button>
        </form>
      </KebabMenu>

      <OverlayDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        width="30rem"
        title={t(locale, 'editInitiative')}
        closeLabel={t(locale, 'close')}
      >
        <form action={formAction} className={styles.editForm}>
          <input type="hidden" name="initiativeId" value={initiativeId} />
          <label htmlFor="edit-name">{t(locale, 'initiativeNameLabel')}</label>
          <input id="edit-name" type="text" name="name" defaultValue={name} required />
          <label htmlFor="edit-description">{t(locale, 'initiativeDescriptionLabel')}</label>
          <textarea id="edit-description" name="description" rows={3} defaultValue={description ?? ''} />
          <label htmlFor="edit-target">{t(locale, 'initiativeTargetMonthLabel')}</label>
          <input id="edit-target" type="month" name="targetMonth" defaultValue={targetMonth} />
          {state.error && <p role="alert" className={styles.formError}>{state.error}</p>}
          <div className={styles.editActions}>
            <button type="button" onClick={() => setEditOpen(false)}>{t(locale, 'cancel')}</button>
            <button type="submit">{t(locale, 'saveChanges')}</button>
          </div>
        </form>
      </OverlayDialog>
    </>
  );
}
