import type { Metadata } from "next";
import { Geist, Geist_Mono, Rubik } from "next/font/google";
import Link from 'next/link';
import Search from '../components/Search';
import OfflineIndicator from '../components/OfflineIndicator';
import { getCurrentUser } from '../lib/session';
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
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${rubik.variable}`}>
      <body>
        <nav className={styles.navBar}>
          <div className={styles.leftSection}>
            <Link href="/" className={styles.logo}>
              AutoKnow
            </Link>
            <div className={styles.navLinks}>
              <Link href="/" className={styles.navLink}>
                Ecosystem
              </Link>
              <Link href="/programs" className={styles.navLink}>
                Programs
              </Link>
              <Link href="/partners" className={styles.navLink}>
                Partners
              </Link>
              <Link href="/me" className={styles.navLink}>
                Me
              </Link>
              <Link href="/ingest" className={styles.navLink}>
                Ingest
              </Link>
              <Link href="/admin" className={styles.navLink}>
                Dev Console
              </Link>
            </div>
          </div>
          <div className={styles.rightSection}>
            <OfflineIndicator />
            <Search />
            <div className={styles.sessionIndicator}>
              <div className={styles.googleLogo}>G</div>
              <span>{user.email}</span>
              {authConfigured && (
                session?.user ? (
                  <form
                    action={async () => {
                      'use server';
                      await signOut({ redirectTo: '/login' });
                    }}
                  >
                    <button type="submit" style={{ marginLeft: 8, fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline', color: 'inherit' }}>Sign out</button>
                  </form>
                ) : (
                  <form
                    action={async () => {
                      'use server';
                      await signIn('google', { redirectTo: '/' });
                    }}
                  >
                    <button type="submit" style={{ marginLeft: 8, fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline', color: 'inherit' }}>Sign in</button>
                  </form>
                )
              )}
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
