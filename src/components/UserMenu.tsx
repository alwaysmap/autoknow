'use client';

import React, { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import ThemeToggle from './ThemeToggle';
import StyleToggle from './StyleToggle';
import LocaleSwitcher from './LocaleSwitcher';
import styles from './UserMenu.module.css';

// Google-style session affordance: a circle with the user's initials, nothing else in
// the bar. Clicking opens a small card with the name, email, and the sign-out action.
// When auth is configured but no session exists, the whole thing is a Sign in button.

function initialsOf(name: string, email: string): string {
  const source = name.trim() || email.split('@')[0];
  const words = source.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.replace(/^@/, '').slice(0, 2).toUpperCase();
}

export default function UserMenu({
  name,
  email,
  signedIn,
  authConfigured,
  signInAction,
  signOutAction,
}: {
  name: string;
  email: string;
  signedIn: boolean;
  authConfigured: boolean;
  signInAction?: () => Promise<void>;
  signOutAction?: () => Promise<void>;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Auth on, nobody signed in: the affordance IS the sign-in.
  if (authConfigured && !signedIn) {
    return (
      <form action={signInAction}>
        <button type="submit" className={styles.signInBtn}>{t(locale, 'signIn')}</button>
      </form>
    );
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.avatar}
        aria-label={email}
        aria-expanded={open}
        data-testid="user-menu"
        onClick={() => setOpen((v) => !v)}
      >
        {initialsOf(name, email)}
      </button>
      {open && (
        <div className={styles.pop}>
          <div className={styles.popAvatar}>{initialsOf(name, email)}</div>
          <div className={styles.name}>{name}</div>
          <div className={styles.email}>{email}</div>
          {/* Personal settings — they follow the person, not the deployment, so they
              live here rather than in the nav or Manage. */}
          <div className={styles.prefs}>
            <div className={styles.prefRow}>
              <span className={styles.prefLabel}>{t(locale, 'styleLabel')}</span>
              <StyleToggle />
            </div>
            <div className={styles.prefRow}>
              <span className={styles.prefLabel}>{t(locale, 'themeLabel')}</span>
              <ThemeToggle />
            </div>
            <div className={styles.prefRow}>
              <span className={styles.prefLabel}>{t(locale, 'settingsLanguage')}</span>
              <LocaleSwitcher locale={locale} />
            </div>
          </div>
          {authConfigured && signedIn && (
            <form action={signOutAction} className={styles.actionRow}>
              <button type="submit" className={styles.signOutBtn}>{t(locale, 'signOut')}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
