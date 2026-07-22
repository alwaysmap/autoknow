'use client';

import { useSyncExternalStore } from 'react';

// The RESOLVED theme ('light' | 'dark') for components that must hand the current
// theme to something CSS can't reach — a third-party widget with its own palette
// class, a canvas, an <svg> filter. Anything stylable from CSS should use the
// design tokens under `:root[data-theme=…]` instead and never call this.
//
// `<html data-theme>` is the single source of truth: layout.tsx's inline script
// sets it before first paint and ThemeToggle keeps it current, so observing the
// attribute covers both without duplicating the light/dark/system resolution.
//
// useSyncExternalStore with a NEUTRAL server snapshot (AGENTS lesson 8): the
// server has no theme, so it renders 'light' and the browser corrects on the
// first commit.

export type ResolvedTheme = 'light' | 'dark';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const getSnapshot = (): ResolvedTheme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

const getServerSnapshot = (): ResolvedTheme => 'light';

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
