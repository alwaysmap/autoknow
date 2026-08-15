'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import type { SelectablePreference } from '../lib/preferences';
import styles from './PrefSelect.module.css';

// The ONE control for a COOKIE-backed preference — today language and date labels, both in
// the user menu. It exists because those two share a mechanism the appearance toggles do
// not: the server reads the value to render, so picking one writes a cookie and refreshes
// the route rather than setting React state. The second one of these was written as a fork
// of the first, stylesheet import and all, which is exactly the "same control in three
// hand-rolled variants" this app keeps consolidating away (AGENTS lesson 7).
//
// UNCONTROLLED (`defaultValue`), and that is the detail that matters: the new value only
// reaches React when the server answers `router.refresh()`, so a `value={current}` select
// re-renders back to the OLD value the instant the change handler returns and holds there
// for the whole round-trip — the picker visibly refusing the choice the user just made.
// Measured on the date-label picker: picking "Date" with the cookie on "week" left the
// select reading "Calendar week" until the refresh landed.
//
// The appearance toggles (theme, style) are deliberately NOT this control: they resolve
// onto <html> before first paint from localStorage and never round-trip (design.md §8c).

export default function PrefSelect<T extends string>({
  pref,
  current,
  label,
  optionLabel,
  afterWrite,
}: {
  /** `SelectablePreference`, not `Preference`: one with no enumerated values cannot BE a
   *  select, and a runtime fallback there would render a one-option dropdown nobody asked
   *  for. The compiler refuses instead. */
  pref: SelectablePreference<T>;
  /** The server-resolved value, for the initial render. */
  current: T;
  /** The control's accessible name — the visible eyebrow is the caller's row label. */
  label: string;
  optionLabel: (value: T) => string;
  /** Anything else the write implies, run after the cookie and before the refresh —
   *  locale uses it to retire its pre-namespace `lang` cookie. */
  afterWrite?: (value: T) => void;
}) {
  const router = useRouter();
  const pick = (raw: string) => {
    // Through the registry's own parser, never a cast: the options came from
    // `pref.values`, and running them back through `parse` keeps the one place that
    // decides what a valid value is the one place, even for a value we just emitted.
    const next = pref.parse(raw);
    document.cookie = `${pref.key}=${next}; path=/; max-age=31536000`;
    afterWrite?.(next);
    router.refresh();
  };
  return (
    <select
      className={styles.select}
      aria-label={label}
      defaultValue={current}
      onChange={(e) => pick(e.target.value)}
    >
      {pref.values.map((v) => (
        <option key={v} value={v}>{optionLabel(v)}</option>
      ))}
    </select>
  );
}
