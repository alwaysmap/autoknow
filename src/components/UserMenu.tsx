'use client';

import React, { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import ThemeToggle from './ThemeToggle';
import StyleToggle from './StyleToggle';
import LocaleSwitcher from './LocaleSwitcher';
import { initialsOf } from '../lib/people';
import styles from './UserMenu.module.css';

// Google-style session affordance: a circle with the user's initials, nothing else in
// the bar. Clicking opens a small card with the name, email, and the sign-out action.
// When auth is configured but no session exists, the whole thing is a Sign in button.
//
// The card shows a HUMAN NAME ('Dylan Thomas'), never the '@handle': the handle is a
// lookup key, and the initials read off the name (first + last) — so a card showing
// '@dylan' meant the name never made it here, not that the initials rule was wrong.
//
// `photoUrl` is our own /api/me/avatar route, never Google's URL (see that route).
// Initials are not a placeholder to be replaced — they are the resting state, and the
// photo is an enhancement that has to earn its way in by loading.

export default function UserMenu({
  name,
  email,
  photoUrl,
  signedIn,
  authConfigured,
  signInAction,
  signOutAction,
}: {
  name: string;
  email: string;
  photoUrl?: string | null;
  signedIn: boolean;
  authConfigured: boolean;
  signInAction?: () => Promise<void>;
  signOutAction?: () => Promise<void>;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Last-resort fallback only: CurrentUser.name is always populated (lib/auth derives
  // one from the handle when the provider gives none), so this is belt-and-braces.
  const fullName = name.trim() || email.split('@')[0];
  const initials = initialsOf(fullName);
  // A photo that 404s (no picture claim, upstream hiccup) drops back to initials
  // rather than leaving a broken-image glyph in the nav.
  const [photoBroken, setPhotoBroken] = useState(false);
  const face =
    photoUrl && !photoBroken ? (
      // next/image would route this through the optimizer for a 30px same-origin
      // avatar that /api/me/avatar already caches; alt="" because the enclosing
      // control is labelled with the person's name.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        className={styles.photo}
        onError={() => setPhotoBroken(true)}
      />
    ) : (
      initials
    );

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
        aria-label={fullName ? `${fullName} (${email})` : email}
        aria-expanded={open}
        data-testid="user-menu"
        onClick={() => setOpen((v) => !v)}
      >
        {face}
      </button>
      {open && (
        <div className={styles.pop}>
          <div className={styles.popAvatar}>{face}</div>
          <div className={styles.name}>{fullName}</div>
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
