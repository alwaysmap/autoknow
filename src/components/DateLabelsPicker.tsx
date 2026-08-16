'use client';

import React from 'react';
import { t, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { useDateLabels } from './DateLabelsProvider';
import { DATE_LABELS } from '../lib/preferences';
import type { DateLabelMode } from '../lib/dates';
import PrefSelect from './PrefSelect';

// How a DAY is written in prose, readouts and chart captions — date, date + calendar
// week, or the week alone (DATE_LABELS, #31). NOT table cells: `TableWeeksPicker` is the
// sibling that answers for those, and the registry entry carries why they are two controls.
// A cookie, so it wears `PrefSelect`, the shared control for that class of preference.

const OPTION_KEY: Record<DateLabelMode, StringKey> = {
  date: 'dateLabelsDate',
  'date-week': 'dateLabelsDateWeek',
  week: 'dateLabelsWeek',
};

export default function DateLabelsPicker() {
  const locale = useLocale();
  const mode = useDateLabels();
  return (
    <PrefSelect
      pref={DATE_LABELS}
      current={mode}
      label={t(locale, 'dateLabelsLabel')}
      optionLabel={(v) => t(locale, OPTION_KEY[v])}
    />
  );
}
