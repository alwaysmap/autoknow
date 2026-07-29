import UserMenu from '../components/UserMenu';
import NavLinks from '../components/NavLinks';
import NavMark from '../components/NavMark';
import type { Metadata } from "next";
import { Geist, Geist_Mono, Rubik } from "next/font/google";
import Link from 'next/link';
import SwCleanup from '../components/SwCleanup';
import { LocaleProvider } from '../components/LocaleProvider';
import { getCurrentUser } from '../lib/session';
import { allowedAvatarUrl } from '../lib/avatar';
import { getLocale } from '../lib/locale';
import { appearanceBootScript } from '../lib/preferences';
import { t } from '../lib/i18n';
import { auth, signIn, signOut, authConfigured } from '../auth';
import "./globals.css";
import styles from './layout.module.css';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "AutoKnow",
  description: "Android Automotive Partner Relationship and Program Tracker",
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f1ea' },
    { media: '(prefers-color-scheme: dark)', color: '#181b21' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
  const session = authConfigured ? await auth() : null;
  const locale = await getLocale();
  return (
    // data-scroll-behavior: globals.css sets `scroll-behavior: smooth` so in-page
    // jumps ease into place. Next asks for this attribute so its router knows the
    // smoothness is deliberate and restores scroll position instantly on route
    // CHANGES anyway — without it every navigation logs an advisory and a back
    // button can visibly glide instead of landing where it left off.
    <html lang={locale} data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${rubik.variable}`} suppressHydrationWarning>
      <head>
        {/* Resolves BOTH stored appearance preferences onto <html> BEFORE first paint —
            no flash of the wrong theme or style. Derived from the preferences registry so
            its keys/default can't drift from the toggles (§8c). */}
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript() }} />
      </head>
      <body>
        <LocaleProvider locale={locale}>
        <nav className={styles.navBar}>
          <Link href="/" className={styles.logo}>
            <NavMark className={styles.mark} />
            AutoKnow
          </Link>
          {/* The flexible middle: as many links as fit on one row, the rest in a ⋯ menu.
              Labels are localized here (server) and MEASURED client-side (#28), so the
              collapse point is right per locale rather than assumed from English widths. */}
          <NavLinks
            moreLabel={t(locale, 'navMore')}
            items={[
              { href: '/ecosystem', label: t(locale, 'navEcosystem') },
              { href: '/programs', label: t(locale, 'navPrograms') },
              { href: '/partners', label: t(locale, 'navPartners') },
              { href: '/escalations', label: t(locale, 'navEscalations') },
              { href: '/people', label: t(locale, 'peopleLabel') },
              { href: '/me', label: t(locale, 'navMe') },
            ]}
          />
          <div className={styles.rightSection}>
            <SwCleanup />
            <Link href="/manage" className={styles.settingsCog} aria-label={t(locale, 'navManage')} title={t(locale, 'navManage')}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
            <UserMenu
              name={user.name}
              email={user.email}
              // The route, never the googleusercontent URL — that stays server-side.
              // Asking allowedAvatarUrl (rather than just "is there a URL?") keeps this
              // in lockstep with what /api/me/avatar will actually serve: a photo the
              // route would reject must not render an <img> that only 404s.
              photoUrl={allowedAvatarUrl(user.image) ? '/api/me/avatar' : null}
              signedIn={!!session?.user}
              authConfigured={authConfigured}
              signInAction={async () => {
                'use server';
                await signIn('google', { redirectTo: '/' });
              }}
              signOutAction={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            />
          </div>
        </nav>
        {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
