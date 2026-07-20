'use client';

import { useRouter } from 'next/navigation';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';

// An HONEST back affordance: it returns to wherever the user actually came from
// (browser history), not to a hardcoded guess. Direct loads (no in-app history)
// fall back to the entity's own page.

export default function BackLink({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  const locale = useLocale();
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(fallbackHref);
  };
  return (
    <button
      type="button"
      onClick={goBack}
      style={{
        background: 'none', border: 'none', padding: '0', fontSize: '0.8125rem',
        color: 'var(--muted, #666)', cursor: 'pointer', textDecoration: 'underline',
        textUnderlineOffset: 2,
      }}
    >
      {t(locale, 'backLabel')}
    </button>
  );
}
