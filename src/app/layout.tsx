import UserMenu from '../components/UserMenu';
import type { Metadata } from "next";
import { Geist, Geist_Mono, Rubik } from "next/font/google";
import Link from 'next/link';
import Search from '../components/Search';
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
  themeColor: '#f4f1ea',
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
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} ${rubik.variable}`}>
      <body>
        <LocaleProvider locale={locale}>
        <nav className={styles.navBar}>
          <div className={styles.leftSection}>
            <Link href="/" className={styles.logo}>
              AutoKnow
            </Link>
            <div className={styles.navLinks}>
              <Link href="/" className={styles.navLink}>
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
            <Search />
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
