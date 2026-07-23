'use client';

import { useSyncExternalStore } from 'react';
import { useLocale } from './LocaleProvider';
import { t } from '../lib/i18n';
import { STYLE, readLocalPref, subscribePrefChange, writeLocalPref, type StylePref } from '../lib/preferences';
import styles from './ThemeToggle.module.css';

// The second appearance axis: which STYLE family the app wears, independent of
// light/dark. "standard" is the app as it has always looked; "instrument" trades
// the brand green for pear, rules for tick-mark graticules, and lines up every
// digit. Both families carry the full light/dark/system set, so this control and
// ThemeToggle never need to know about each other.
//
// Same shape as ThemeToggle deliberately (segmented radiogroup, localStorage as
// an external store, custom event so same-page writers notify React) — a second
// preference should not invent a second interaction.

// Unlike the theme there is nothing to resolve — the stored value IS the answer. The key
// and default come from the preferences registry (#31), so the server snapshot below and
// the inline script in layout.tsx can't drift, which would render the wrong row as current
// for one frame (§8c).

// Module scope, like ThemeToggle's `apply`: writing to documentElement from
// inside the component body trips react-hooks/immutability, which is a lint
// ERROR here.
function apply(style: StylePref) {
  document.documentElement.dataset.style = style;
}

export default function StyleToggle() {
  const locale = useLocale();
  const style = useSyncExternalStore(subscribePrefChange, () => readLocalPref(STYLE), () => STYLE.default);

  const choose = (next: StylePref) => {
    writeLocalPref(STYLE, next); // persists + notifies same-tab subscribers
    apply(next);
  };

  const options: Array<{ value: StylePref; label: string; icon: React.ReactNode }> = [
    {
      value: 'standard',
      label: t(locale, 'styleStandard'),
      // A plain rule — the standard style's separator.
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3 12h18" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      value: 'instrument',
      label: t(locale, 'styleInstrument'),
      // The same rule as a graticule — the one thing that visibly changes.
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 9v6M9 9v6M14 9v6M19 9v6" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <div role="radiogroup" aria-label={t(locale, 'styleLabel')} className={styles.group}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={style === o.value}
          aria-label={o.label}
          title={o.label}
          type="button"
          className={styles.option}
          onClick={() => choose(o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
