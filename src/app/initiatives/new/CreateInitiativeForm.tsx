'use client';

import { useActionState } from 'react';
import Combobox from '../../../components/Combobox';
import PartnersPicker from './PartnersPicker';
import type { ComboboxOption } from '../../../lib/comboboxOptions';
import { createInitiative } from '../../actions/initiatives';
import type { ActionResult } from '../../../lib/actionResult';
import { t, type Locale } from '../../../lib/i18n';
import styles from './page.module.css';

// Client form so a guarded refusal renders inline instead of vanishing — the
// ActionResult contract (lib/actionResult) exists for exactly this wiring.
export default function CreateInitiativeForm({ templates, partners, locale }: { templates: ComboboxOption[]; partners: ComboboxOption[]; locale: Locale }) {
  const [state, formAction] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => createInitiative(formData),
    {},
  );

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.field}>
        <label data-eyebrow htmlFor="name">{t(locale, 'initiativeNameLabel')}</label>
        <input type="text" id="name" name="name" required placeholder={t(locale, 'initiativeNamePlaceholder')} />
      </div>

      <div className={styles.field}>
        <label data-eyebrow htmlFor="description">{t(locale, 'initiativeDescriptionLabel')}</label>
        <textarea id="description" name="description" rows={3} />
      </div>

      <div className={styles.field}>
        <label data-eyebrow htmlFor="templateId">{t(locale, 'projectTemplateDag')}</label>
        {/* Templates grow with the business — the same unbounded-by-construction call
            as /programs/new (ADR 2026-08-02). The picked template is the SOURCE the
            action snapshot-clones; nothing binds to a shared template. */}
        <Combobox
          id="templateId" name="templateId"
          options={templates}
          emptyLabel={t(locale, 'selectATemplate')}
          required
          aria-label={t(locale, 'projectTemplateDag')}
        />
      </div>

      <div className={styles.field}>
        <label data-eyebrow htmlFor="targetMonth">{t(locale, 'initiativeTargetMonthLabel')}</label>
        <input type="month" id="targetMonth" name="targetMonth" />
      </div>

      <PartnersPicker options={partners} locale={locale} />

      {state.error && (
        <p role="alert" className={styles.formError}>{state.error}</p>
      )}

      <div className={styles.actions}>
        <button type="submit" className={styles.submitBtn}>
          {t(locale, 'createInitiativeButton')}
        </button>
      </div>
    </form>
  );
}
