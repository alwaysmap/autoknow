'use client';

import { useActionState } from 'react';
import Combobox from '../../../components/Combobox';
import { toComboboxOptions } from '../../../lib/comboboxOptions';
import { addPartners } from '../../actions/initiatives';
import type { ActionResult } from '../../../lib/actionResult';
import { t, type Locale } from '../../../lib/i18n';
import styles from './page.module.css';

// Add ONE partner from the initiative page (gh-286; "any partner can be added from the
// partner screen or the initiative screen"). The bulk add-via-filters table is part (f)
// — this is the single-pick complement, an entity picker over canonical rows (lesson 3).
// The optional month overrides the initiative's default target for this add only.
export default function AddPartnerForm({
  initiativeId,
  candidates,
  locale,
}: {
  initiativeId: number;
  candidates: { id: number; name: string }[];
  locale: Locale;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => addPartners(formData),
    {},
  );

  if (candidates.length === 0) return null;

  return (
    <form action={formAction} className={styles.addForm}>
      <input type="hidden" name="initiativeId" value={initiativeId} />
      <Combobox
        id="add-partner" name="partnerIds"
        options={toComboboxOptions(candidates)}
        emptyLabel={t(locale, 'selectAPartner')}
        required
        aria-label={t(locale, 'addPartnerToInitiative')}
      />
      <input
        type="month"
        name="targetMonth"
        aria-label={t(locale, 'initiativeTargetMonthLabel')}
        title={t(locale, 'initiativeTargetMonthLabel')}
      />
      <button type="submit" className={styles.addBtn}>{t(locale, 'addPartnerToInitiative')}</button>
      {state.error && <p role="alert" className={styles.formError}>{state.error}</p>}
    </form>
  );
}
