import UserMenu from '../components/UserMenu';
import type { Metadata } from "next";
import { Geist, Geist_Mono, Rubik } from "next/font/google";
import Link from 'next/link';
import Search from '../components/Search';
import SwCleanup from '../components/SwCleanup';
import LocaleSwitcher from '../components/LocaleSwitcher';
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
              <Link href="/me" className={styles.navLink}>
                {t(locale, 'navMe')}
              </Link>
              <Link href="/manage" className={styles.navLink}>
                {t(locale, 'navManage')}
              </Link>
            </div>
          </div>
          <div className={styles.rightSection}>
            <SwCleanup />
            <Search />
            <LocaleSwitcher locale={locale} />
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
