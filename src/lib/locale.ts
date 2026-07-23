import { cookies } from 'next/headers';
import { isLocale, type Locale } from './i18n';
import { LOCALE, LOCALE_LEGACY_KEY } from './preferences';

// Server-side locale resolution: the locale cookie (written by the global switcher in the
// nav) is the app-wide source of truth; `?lang=` still wins where a page passes it in (deep
// links). Server components call this and pass the result to t(). Key/default/validator
// come from the preferences registry (#31).
export async function getLocale(langParam?: string | string[] | undefined): Promise<Locale> {
  if (typeof langParam === 'string' && isLocale(langParam)) return langParam;
  const store = await cookies();
  // The namespaced cookie, falling back to the pre-rename `lang` so a returning user keeps
  // their language until the next switch rewrites it under the new key.
  const raw = store.get(LOCALE.key)?.value ?? store.get(LOCALE_LEGACY_KEY)?.value;
  return LOCALE.parse(raw);
}
