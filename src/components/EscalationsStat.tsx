'use client';

import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import StatTile from './StatTile';

// The fourth ecosystem-strip tile (#245 section C): how many escalations are open right
// now, across the whole portfolio. Renders on `/ecosystem` AND `/` — `EcosystemStatStrip`
// is the one component both pages share, so this tile appears on the landing page too,
// which is deliberate: an open escalation is exactly the kind of leadership number
// design.md §2b's strip exists to put in front of the reader before they even search.
//
// `tone='warn'` only when the count is non-zero, the same convention `SopRiskStat` uses —
// zero open escalations is not news; any other number is.

export default function EscalationsStat({ count }: { count: number }) {
  const locale = useLocale();
  return (
    <StatTile
      testId="escalations-stat"
      label={t(locale, 'statsOpenEscalations')}
      value={count.toLocaleString(locale)}
      href="/escalations?status=open"
      title={t(locale, 'statsViewOpenEscalations')}
      tone={count > 0 ? 'warn' : 'default'}
    />
  );
}
