'use client';

import { useActionState } from 'react';
import Combobox from './Combobox';
import { toComboboxOptions, type NamedRow } from '../lib/comboboxOptions';
import { addPartners } from '../app/actions/initiatives';
import type { ActionResult } from '../lib/actionResult';
import { t, type Locale } from '../lib/i18n';
import styles from './AddToInitiativeForm.module.css';

// "Add to initiative" from the PARTNER side (gh-286 part g): the inverse of the
// initiative page's add form — pick an initiative this partner is not yet in; the same
// addPartners boundary does the write, so the two directions cannot drift.
export default function AddToInitiativeForm({
  partnerId,
  initiatives,
  locale,
}: {
  partnerId: number;
  initiatives: NamedRow[];
  locale: Locale;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => addPartners(formData),
    {},
  );

  if (initiatives.length === 0) return null;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="partnerIds" value={partnerId} />
      <Combobox
        id="add-to-initiative" name="initiativeId"
        options={toComboboxOptions(initiatives)}
        emptyLabel={t(locale, 'selectAnInitiative')}
        required
        aria-label={t(locale, 'addToInitiative')}
      />
      <button type="submit" className={styles.btn}>{t(locale, 'addToInitiative')}</button>
      {state.error && <p role="alert" className={styles.formError}>{state.error}</p>}
    </form>
  );
}
