import { cookies } from 'next/headers';
import type { DateLabelMode } from './dates';
import { DATE_LABELS, TABLE_DATE_LABELS } from './preferences';

// Server-side resolution of the date-label preferences — locale.ts's twin, and
// deliberately its twin: all of these are cookies precisely because the server has to know
// them to render, so they are read the same way, in the same place (the root layout), and
// handed down the same way (a provider, not a prop chain). Keys/defaults/validators come
// from the preferences registry (#31); nothing here restates them.
//
// Both are read in ONE call so a caller cannot resolve prose labels and forget table ones,
// which would show up as a table quietly stuck on the app default while everything around
// it followed the reader.
//
// No `?dateLabels=` deep-link escape hatch, unlike locale's `?lang=`. A shared link that
// silently overrode how the recipient reads dates would be the opposite of a per-user
// preference, and there is no equivalent of "send this page to a German speaker" here.
export async function getDateLabelModes(): Promise<{ prose: DateLabelMode; table: DateLabelMode }> {
  const store = await cookies();
  return {
    prose: DATE_LABELS.parse(store.get(DATE_LABELS.key)?.value),
    table: TABLE_DATE_LABELS.parse(store.get(TABLE_DATE_LABELS.key)?.value),
  };
}
