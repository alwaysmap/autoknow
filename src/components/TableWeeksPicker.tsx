'use client';

import React from 'react';
import { t, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { useTableDateLabels } from './DateLabelsProvider';
import { TABLE_DATE_LABELS } from '../lib/preferences';
import type { DateLabelMode } from '../lib/dates';
import PrefSelect from './PrefSelect';

// Whether TABLE cells carry the ISO calendar week (TABLE_DATE_LABELS, #31) — the sibling
// of `DateLabelsPicker`, and separate from it on purpose: a cell is read DOWN a column
// against its neighbours, prose is read across in a sentence, and the same answer does not
// suit both (the registry entry carries the argument).
//
// Same three underlying values as the prose picker, but the OPTIONS are answers to this
// row's own question — "weeks in tables? no / with the date / instead of it" — rather than
// a second copy of "how are dates written".

const OPTION_KEY: Record<DateLabelMode, StringKey> = {
  date: 'tableWeeksOff',
  'date-week': 'tableWeeksWith',
  week: 'tableWeeksOnly',
};

export default function TableWeeksPicker() {
  const locale = useLocale();
  const mode = useTableDateLabels();
  return (
    <PrefSelect
      pref={TABLE_DATE_LABELS}
      current={mode}
      label={t(locale, 'tableWeeksLabel')}
      optionLabel={(v) => t(locale, OPTION_KEY[v])}
    />
  );
}
