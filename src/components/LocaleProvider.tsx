'use client';

import React, { createContext, useContext } from 'react';
import type { Locale } from '../lib/i18n';

// Client-side locale distribution: the root layout resolves the cookie server-side and
// mounts this provider, so any client component can call useLocale() instead of having
// the locale threaded through every prop chain.

const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}
