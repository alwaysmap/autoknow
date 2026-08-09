import { isLocale, LOCALES, type Locale } from './i18n';

// THE preferences registry (#31). Every user preference is declared ONCE here — its
// namespaced key, its storage (and WHY), its validator, and its app default — and the
// inline boot script, the pickers, and any server-side reader all derive from this entry.
// Before this, the theme/style defaults were restated in the inline `layout.tsx` script
// AND each toggle's server snapshot (design.md §8c: "the default lives in TWO places that
// must agree ... or the picker shows the wrong row as current for one frame"), and locale
// added a third literal in a third file. Adding a preference is now one entry.
//
// This module is ISOMORPHIC on purpose — no 'use client', no server-only — so the server
// (locale resolution), the client (the toggles), and the pre-paint boot script string can
// all import the same source of truth.

export type PrefStorage = 'local' | 'cookie';

export interface Preference<T> {
  /** Namespaced storage key (`autoknow-*`, whichever storage). */
  readonly key: string;
  /** Where the value lives, and WHY — a cookie ONLY when the server must read it (SSR). */
  readonly storage: PrefStorage;
  readonly storageReason: string;
  /** The app default. A plain constant, available at render time — §8c requires the
   *  theme/style defaults to be resolvable in the synchronous pre-paint script, which
   *  cannot do an async DB read, so defaults live in config (here), never the DB. */
  readonly default: T;
  /** Validate + coerce a raw stored string into a valid value, falling back to `default`. */
  parse(raw: string | null | undefined): T;
  /** The selectable values, in display order (default first, by convention). For pickers. */
  readonly values?: readonly T[];
}

// ---- Appearance: client-only, resolved in the pre-paint boot script (§8c) ---------------

export type ThemePref = 'system' | 'light' | 'dark';
export const THEME: Preference<ThemePref> = {
  key: 'autoknow-theme',
  storage: 'local',
  storageReason: 'client-only; resolved onto <html> by the pre-paint inline script and never read server-side',
  default: 'system',
  values: ['system', 'light', 'dark'],
  parse: (r) => (r === 'light' || r === 'dark' || r === 'system' ? r : 'system'),
};

export type StylePref = 'instrument' | 'standard';
export const STYLE: Preference<StylePref> = {
  key: 'autoknow-style',
  storage: 'local',
  storageReason: 'client-only; resolved onto <html> by the pre-paint inline script',
  default: 'instrument',
  values: ['instrument', 'standard'],
  parse: (r) => (r === 'standard' ? 'standard' : 'instrument'),
};

// ---- Locale: a COOKIE, because the server must read it to render localized SSR ----------

export const LOCALE: Preference<Locale> = {
  key: 'autoknow-lang',
  storage: 'cookie',
  storageReason: 'the server reads it during SSR to render localized content, so it cannot be client-only localStorage',
  default: 'en',
  values: LOCALES.map((l) => l.code),
  parse: (r) => (isLocale(r) ? r : 'en'),
};
/** The pre-namespace cookie name, still read as a fallback so a returning user keeps their
 *  language across the rename (they never lose it; the next switch writes the new key). */
export const LOCALE_LEGACY_KEY = 'lang';

// ---- Rows per table: client-only view density (DataTable paginates client-side). --------
// Declared here so #29 CONSUMES the registry rather than re-inventing a per-call-site prop.

export const ROWS_PER_TABLE: Preference<number> = {
  key: 'autoknow-rows',
  storage: 'local',
  storageReason: 'client-only view density; the table paginates on the client, no SSR read',
  default: 25,
  values: [10, 25, 50, 100],
  parse: (r) => {
    const n = Number(r);
    return [10, 25, 50, 100].includes(n) ? n : 25;
  },
};

// ---- Collapsed detail sections: client-only view state (autoknow-hcz.15). --------------
// ONE list of section ids, not a key per section: the registry (and reset-all) stays a
// finite catalog, and "collapse Critical Chain" is a claim about the SECTION, not about
// one program — the id is `programs:chain`, never `programs:17:chain`, so a reader who
// tucks a section away sees it tucked away on every program-shaped page.
// Stored comma-separated (ids never contain a comma), so `String(value)` on an array —
// which is what writeLocalPref stores — round-trips through parse unchanged.

/** THE catalog of collapsible sections — membership, not just shape, so a typo'd id at a
 *  call site is a type error and a stored stray is dropped on read. `programs:*` covers
 *  every program-shaped page (the initiative copy page reuses them on purpose — see the
 *  ADR a-collapsed-section-is-a-claim-about-the-section-not-the-entity). */
export const SECTION_IDS = [
  'programs:hill',
  'programs:chain',
  'programs:phases',
  'programs:escalations',
  'programs:activity',
  'partners:programs',
  'partners:initiatives',
  'partners:people',
  'partners:escalations',
  'partners:activity',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const COLLAPSED_SECTIONS: Preference<readonly SectionId[]> = {
  key: 'autoknow-collapsed-sections',
  storage: 'local',
  storageReason: 'client-only view state; the server always renders sections open (neutral snapshot) and never reads it',
  default: [],
  parse: (r) => {
    if (!r) return COLLAPSED_SECTIONS.default; // '' (the default, stringified) and null both mean "none"
    const ids = r.split(',').filter((x): x is SectionId => (SECTION_IDS as readonly string[]).includes(x));
    return ids.length === 0 ? COLLAPSED_SECTIONS.default : ids;
  },
};

/** Every registered preference — drives reset-all and the registry tests. */
export const ALL_PREFERENCES: ReadonlyArray<Preference<unknown>> = [THEME, STYLE, LOCALE, ROWS_PER_TABLE, COLLAPSED_SECTIONS];

// ---- The pre-paint boot script (§8c) ----------------------------------------------------

/**
 * The synchronous inline `<script>` that resolves BOTH appearance preferences onto <html>
 * BEFORE first paint — no flash of the wrong theme or style. Built from the SAME keys and
 * default this registry gives the toggles, so the two can never drift (the §8c landmine).
 * Kept tiny and dependency-free; it must not import React or read anything async.
 *   theme: a stored 'light'/'dark' wins; otherwise follow the OS (`prefers-color-scheme`).
 *   style: a stored 'standard' wins; otherwise the default.
 */
export function appearanceBootScript(): string {
  const themeKey = JSON.stringify(THEME.key);
  const styleKey = JSON.stringify(STYLE.key);
  const styleDefault = JSON.stringify(STYLE.default);
  return (
    `(function(){try{` +
    `var p=localStorage.getItem(${themeKey});` +
    `var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);` +
    `document.documentElement.dataset.theme=d?'dark':'light';` +
    `var s=localStorage.getItem(${styleKey});` +
    `document.documentElement.dataset.style=s==='standard'?'standard':${styleDefault};` +
    `}catch(e){}})();`
  );
}

// ---- Client read / write / reset --------------------------------------------------------

/** One event for every same-tab preference change, so pickers using useSyncExternalStore
 *  re-read without each preference inventing its own event. Cross-tab writes arrive via the
 *  native `storage` event, which localStorage fires only in OTHER tabs. */
export const PREF_EVENT = 'autoknow-pref-change';

export function notifyPrefChange(): void {
  window.dispatchEvent(new Event(PREF_EVENT));
}

export function subscribePrefChange(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(PREF_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(PREF_EVENT, onChange);
  };
}

/** Read a localStorage-backed preference on the client (returns the default on the server
 *  and for any missing/invalid value). Cookie-backed prefs are read server-side instead. */
export function readLocalPref<T>(pref: Preference<T>): T {
  if (typeof window === 'undefined') return pref.default;
  return pref.parse(window.localStorage.getItem(pref.key));
}

export function writeLocalPref<T>(pref: Preference<T>, value: T): void {
  window.localStorage.setItem(pref.key, String(value));
  notifyPrefChange();
}

/** Reset ONE preference to its default by clearing its stored value (so it also follows any
 *  future default change, unlike re-picking the current default value). */
export function resetPreference(pref: Preference<unknown>): void {
  if (pref.storage === 'local') window.localStorage.removeItem(pref.key);
  else document.cookie = `${pref.key}=; path=/; max-age=0`;
}

/** Reset every preference to its default. Appearance re-applies to <html> immediately;
 *  locale (a cookie the server reads) needs the caller to refresh the route afterwards. */
export function resetAllPreferences(): void {
  for (const pref of ALL_PREFERENCES) resetPreference(pref);
  notifyPrefChange();
}
