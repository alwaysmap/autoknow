'use client';

import React, { createContext, useContext } from 'react';
import type { DateLabelMode } from '../lib/dates';

// Client-side distribution of the date-label preference, exactly as LocaleProvider
// distributes the locale: the root layout resolves the cookie server-side and mounts this,
// so any client component can ask `useDateLabels()` instead of having the mode threaded
// through prop chains that are already ten deep with `locale`.
//
// The context default is the app default ('date'), which is what makes this safe to adopt
// piecemeal: a component rendered outside the provider — a unit test mounting one chart —
// gets today's behaviour rather than an undefined mode to branch on.

const DateLabelsContext = createContext<DateLabelMode>('date');

export function DateLabelsProvider({ mode, children }: { mode: DateLabelMode; children: React.ReactNode }) {
  return <DateLabelsContext.Provider value={mode}>{children}</DateLabelsContext.Provider>;
}

export function useDateLabels(): DateLabelMode {
  return useContext(DateLabelsContext);
}
