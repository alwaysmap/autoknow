'use client';

import React from 'react';
import { t, LOCALES, type Locale } from '../lib/i18n';
import { LOCALE, LOCALE_LEGACY_KEY } from '../lib/preferences';
import PrefSelect from './PrefSelect';

// The ONE locale picker, in the global nav. The cookie write, the route refresh and the
// uncontrolled-select reasoning all live in `PrefSelect` now — this file is the locale's
// share of it: which preference, which labels, and the one thing locale needs that no
// other cookie preference does (retiring the pre-namespace `lang` cookie, so a returning
// user keeps their language across the rename and stops paying for it on the next switch).

const LOCALE_LABELS = new Map(LOCALES.map((l) => [l.code, l.label]));

export default function LocaleSwitcher({ locale }: { locale: Locale }) {
  return (
    <PrefSelect
      pref={LOCALE}
      current={locale}
      label={t(locale, 'settingsLanguage')}
      optionLabel={(code) => LOCALE_LABELS.get(code) ?? code}
      afterWrite={() => { document.cookie = `${LOCALE_LEGACY_KEY}=; path=/; max-age=0`; }}
    />
  );
}
