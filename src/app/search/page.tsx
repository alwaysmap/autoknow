import UnifiedSearch from '../../components/UnifiedSearch';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  lang?: string;
}

export default async function SearchPage(props: { searchParams: Promise<SearchParams> }) {
  const { q, lang } = await props.searchParams;
  const locale = await getLocale(lang);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 820 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{t(locale, 'searchHeading')}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4 }}>
          {t(locale, 'searchIntro')}
        </p>
      </header>
      <UnifiedSearch
        initialQuery={q || ''}
        autoFocus
        placeholder={t(locale, 'searchEverythingPlaceholder')}
      />
    </div>
  );
}
