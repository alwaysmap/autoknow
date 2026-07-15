import { cookies } from 'next/headers';
import { isLocale, type Locale } from './i18n';

// Server-side locale resolution: the `lang` cookie (written by the global switcher in
// the nav) is the app-wide source of truth; `?lang=` still wins where a page passes it
// in (deep links). Server components call this and pass the result to t().
export async function getLocale(langParam?: string | string[] | undefined): Promise<Locale> {
  if (typeof langParam === 'string' && isLocale(langParam)) return langParam;
  const store = await cookies();
  const v = store.get('lang')?.value;
  return isLocale(v) ? v : 'en';
}
