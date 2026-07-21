import UserMenu from '../components/UserMenu';
import type { Metadata } from "next";
import { Geist, Geist_Mono, Rubik } from "next/font/google";
import Link from 'next/link';
import SwCleanup from '../components/SwCleanup';
import { LocaleProvider } from '../components/LocaleProvider';
import { getCurrentUser } from '../lib/session';
import { getLocale } from '../lib/locale';
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
  description: "Android Automotive Partner Relationship and Project Tracker",
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

// Resolves BOTH stored appearance preferences to concrete attributes on <html>
// BEFORE first paint — no flash of the wrong theme or the wrong style. The two
// are independent: data-theme is light|dark (resolved from light|dark|system),
// data-style is standard|instrument. Kept tiny and dependency-free; ThemeToggle
// and StyleToggle take over after hydration.
const themeInit = `(function(){try{var p=localStorage.getItem('autoknow-theme');var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';var s=localStorage.getItem('autoknow-style');document.documentElement.dataset.style=s==='instrument'?'instrument':'standard';}catch(e){}})();`;

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
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <LocaleProvider locale={locale}>
        <nav className={styles.navBar}>
          <div className={styles.leftSection}>
            <Link href="/" className={styles.logo}>
              AutoKnow
            </Link>
            <div className={styles.navLinks}>
              <Link href="/ecosystem" className={styles.navLink}>
                {t(locale, 'navEcosystem')}
              </Link>
              <Link href="/programs" className={styles.navLink}>
                {t(locale, 'navPrograms')}
              </Link>
              <Link href="/partners" className={styles.navLink}>
                {t(locale, 'navPartners')}
              </Link>
              <Link href="/people" className={styles.navLink}>
                {t(locale, 'peopleLabel')}
              </Link>
              <Link href="/me" className={styles.navLink}>
                {t(locale, 'navMe')}
              </Link>
            </div>
          </div>
          <div className={styles.rightSection}>
            <SwCleanup />
            <Link href="/manage" className={styles.settingsCog} aria-label={t(locale, 'navManage')} title={t(locale, 'navManage')}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
            <UserMenu
              name={session?.user?.name ?? user.display}
              email={user.email}
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
