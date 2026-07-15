import { geminiConfigured } from '../../lib/gemini';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import IngestClient from './IngestClient';

export const dynamic = 'force-dynamic';

export default async function IngestPage() {
  const locale = await getLocale();
  return (
    <div style={{ padding: '32px 40px' }}>
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{t(locale, 'ingestContext')}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4 }}>
          {t(locale, 'ingestIntro')}
        </p>
      </header>
      <IngestClient geminiReady={geminiConfigured} />
    </div>
  );
}
