'use client';

import { useState } from 'react';
import Combobox from '../../../components/Combobox';
import type { ComboboxOption } from '../../../lib/comboboxOptions';
import { t, type Locale } from '../../../lib/i18n';
import styles from './page.module.css';

// Assign partners AT creation (owner call 2026-08-08): the add-one-at-a-time chips
// shape (PhaseInvolvementEditor's grammar — there is deliberately no multi-select
// picker in this app). Each pick is a canonical id; the accumulated set rides in one
// hidden `partnerIds` CSV field, the same wire shape `addPartners` already validates
// at the boundary (lesson 3).
export default function PartnersPicker({ options, locale }: { options: ComboboxOption[]; locale: Locale }) {
  const [picked, setPicked] = useState<ComboboxOption[]>([]);
  // Remount the Combobox after each pick so it clears for the next one.
  const [pickerKey, setPickerKey] = useState(0);

  const remaining = options.filter((o) => !picked.some((p) => p.value === o.value));

  return (
    <div className={styles.field}>
      <label data-eyebrow htmlFor="initial-partners">{t(locale, 'initiativeInitialPartners')}</label>
      <input type="hidden" name="partnerIds" value={picked.map((p) => p.value).join(',')} />
      {picked.length > 0 && (
        <ul className={styles.chips}>
          {picked.map((p) => (
            <li key={p.value} className={styles.chip}>
              {p.label}
              <button
                type="button"
                aria-label={`${t(locale, 'removeFromInitiative')}: ${p.label}`}
                onClick={() => setPicked((prev) => prev.filter((x) => x.value !== p.value))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {remaining.length > 0 && (
        <Combobox
          key={pickerKey}
          id="initial-partners"
          name="partnerPick" // display-only; the committed value is the hidden CSV above
          options={remaining}
          emptyLabel={t(locale, 'selectAPartner')}
          aria-label={t(locale, 'initiativeInitialPartners')}
          onChange={(value) => {
            const option = remaining.find((o) => o.value === value);
            if (!option) return;
            setPicked((prev) => [...prev, option]);
            setPickerKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
