import { signIn, authConfigured } from '../../auth';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', gap: 20, textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem' }}>AutoKnow</h1>
      <p style={{ color: 'var(--muted, #666)', maxWidth: 420 }}>
        Android Automotive partner & program intelligence. Sign in with your Google
        Workspace account to continue.
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
            style={{ padding: '10px 20px', fontSize: 14, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border, #ddd)' }}
          >
            Sign in with Google
          </button>
        </form>
      ) : (
        <p style={{ color: '#b06000', fontSize: 13, maxWidth: 460 }}>
          Authentication is not configured. Set <code>AUTH_GOOGLE_ID</code>,{' '}
          <code>AUTH_GOOGLE_SECRET</code>, <code>AUTH_SECRET</code>, and{' '}
          <code>AUTH_ALLOWED_DOMAIN</code> to enable Google sign-in. Until then the app
          runs on a stub identity.
        </p>
      )}
    </div>
  );
}
