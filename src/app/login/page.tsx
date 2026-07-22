import { signIn, authConfigured } from '../../auth';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const locale = await getLocale();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', gap: '1.25rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem' }}>AutoKnow</h1>
      <p style={{ color: 'var(--muted, #666)', maxWidth: '26.25rem' }}>
        {t(locale, 'loginIntro')}
      </p>
      {authConfigured ? (
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            style={{ padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, borderRadius: '0.5rem', cursor: 'pointer', border: '1px solid var(--border, #ddd)' }}
          >
            {t(locale, 'signInWithGoogle')}
          </button>
        </form>
      ) : (
        <p style={{ color: 'var(--warn)', fontSize: '0.8125rem', maxWidth: '28.75rem' }}>
          {t(locale, 'authNotConfigured')} <code>AUTH_GOOGLE_ID</code>,{' '}
          <code>AUTH_GOOGLE_SECRET</code>, <code>AUTH_SECRET</code>, {t(locale, 'authAnd')}{' '}
          <code>AUTH_ALLOWED_DOMAIN</code> {t(locale, 'authEnableSignin')}
        </p>
      )}
    </div>
  );
}
