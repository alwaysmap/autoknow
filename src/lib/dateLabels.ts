import { cookies } from 'next/headers';
import type { DateLabelMode } from './dates';
import { DATE_LABELS } from './preferences';

// Server-side resolution of the date-label preference — locale.ts's twin, and deliberately
// its twin: both are cookies precisely because the server has to know them to render, so
// they are read the same way, in the same place (the root layout), and handed down the same
// way (a provider, not a prop chain). Key/default/validator come from the preferences
// registry (#31); nothing here restates them.
//
// No `?dateLabels=` deep-link escape hatch, unlike locale's `?lang=`. A shared link that
// silently overrode how the recipient reads dates would be the opposite of a per-user
// preference, and there is no equivalent of "send this page to a German speaker" here.
export async function getDateLabelMode(): Promise<DateLabelMode> {
  const store = await cookies();
  return DATE_LABELS.parse(store.get(DATE_LABELS.key)?.value);
}
