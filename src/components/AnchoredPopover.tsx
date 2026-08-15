'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { rovingIndex } from '../lib/anchoredPosition';
import { useAnchoredPosition } from '../lib/useAnchoredPosition';
import styles from './AnchoredPopover.module.css';

// ONE anchored-popover control — the shared home for every "a trigger opens a panel
// anchored to it" surface (#24). There were four hand-rolled versions, each hard-coding
// which side the panel opened to, none flipping or clamping to the viewport, disagreeing
// on z-index/padding/radius — and two of them opened OFF-SCREEN at ordinary widths
// (the ⋯ beside a heading, the rightmost DataTable column filter, both unreachable
// because the page correctly refuses to scroll horizontally, §9).
//
// Two hard problems it owns so no call site solves them again:
//   1. PLACEMENT. The panel is rendered in the top layer (the `popover` attribute), so
//      it escapes every `overflow` clip and needs no z-index. The pure positioner in
//      lib/anchoredPosition (unit-tested) then places it below the trigger, FLIPS it
//      above when it would overflow the bottom, and CLAMPS it inside the viewport — the
//      side is a property of where the trigger sits, computed, not authored.
//   2. DISMISS + FOCUS. The trigger is a native popover invoker (`popovertarget`), so the
//      BROWSER toggles the panel: `popover="auto"` gives light-dismiss (outside click or
//      Escape) and one-open-at-a-time, and — because the trigger is the invoker — none of
//      the click-to-toggle double-fire that manual show/hide of an auto popover suffers
//      (a trigger click would light-dismiss the open panel, then a manual toggle would
//      reopen it). Crucially it does NOT close on clicks INSIDE the panel, which is
//      KebabMenu's hard-won rule: unmounting a menu item's <form> would abort its
//      in-flight server action. Focus moves into the panel on open, back to the trigger
//      on close.
//
//      NAVIGATION is the ONE exception, and it is decided here, not per call site: a link
//      that replaces this page dismisses the panel, because a stale menu over the new route
//      is the bug this was reported as. Nothing else inside the panel closes it, so the
//      <form> rule above is untouched. Deliberately not scoped to the `variant` below —
//      a filter panel that navigates is being replaced too
//      ([ADR: Navigation is the one inner activation that dismisses a popover](../../docs/adr/2026-07-26-navigation-is-the-one-inner-activation-that-dismisses.md)).
//
// `variant='menu'` is for action lists (role=menu, arrow-key roving over the items,
// correct `menuitem` roles applied to the focusable children). `variant='panel'` is for
// a settings card or a filter checklist — a labelled region with native tab order, NOT
// a menu (role=menu requires menuitem children; wrapping a form or a checklist in it is
// the a11y bug this replaces).

type ToggleEventLike = Event & { newState?: string };

/** Handed to a render-prop child so an item can dismiss the panel after acting. Most
 *  callers don't need it — `popover="auto"` light-dismiss (outside click / Escape) covers
 *  the common case, links dismiss on their own (see the header), and it must NOT close on
 *  inner clicks generally (that would abort a menu item's in-flight <form>). A <button>
 *  bulk action that mutates what's behind the menu is the remaining exception. */
export interface AnchoredPopoverApi {
  close: () => void;
}

export interface AnchoredPopoverProps {
  /** Render the trigger <button>; spread the given props onto it. They make it a native
   *  popover invoker (`popoverTarget`) and carry the ref + aria-haspopup/expanded. */
  renderTrigger: (triggerProps: {
    ref: React.Ref<HTMLButtonElement>;
    'aria-haspopup': 'menu' | 'dialog';
    'aria-expanded': boolean;
    popoverTarget: string;
  }) => React.ReactNode;
  /** The panel body. A function child receives `{ close }` for items that must dismiss
   *  the panel themselves (see AnchoredPopoverApi). */
  children: React.ReactNode | ((api: AnchoredPopoverApi) => React.ReactNode);
  /** 'menu' → role=menu + arrow-key roving; 'panel' → labelled region, native tabbing. */
  variant?: 'menu' | 'panel';
  /** Accessible name for the panel (required for the panel variant to be announced). */
  panelLabel?: string;
  /** Extra class on the panel — width / padding / look only, NEVER positioning. */
  panelClassName?: string;
  /** Align the panel's start (left) or end (right) edge to the trigger's before clamping. */
  align?: 'start' | 'end';
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AnchoredPopover({
  renderTrigger,
  children,
  variant = 'menu',
  panelLabel,
  panelClassName,
  align = 'start',
}: AnchoredPopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);

  // Placement, and staying placed while open, come from the shared hook — the same one
  // `Combobox` uses, so the flip/clamp behaviour cannot drift between the two
  // (autoknow-9yx). `position` is returned because the BROWSER decides when this panel
  // opens (the `toggle` event below), so it has to be placed at that instant.
  const position = useAnchoredPosition(triggerRef, panelRef, { active: open, align });

  const items = useCallback((): HTMLElement[] => {
    const panel = panelRef.current;
    if (!panel) return [];
    return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
  }, []);

  // The browser owns open/close (the trigger's `popovertarget`); we react to the toggle:
  // place the panel, apply menu semantics, move focus in on open and back to the trigger
  // on close, and mirror the state so the trigger's aria-expanded is right.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onToggle = (e: ToggleEventLike) => {
      const isOpen = e.newState === 'open';
      setOpen(isOpen);
      if (isOpen) {
        position();
        if (variant === 'menu') {
          items().forEach((el, i) => {
            if (!el.getAttribute('role')) el.setAttribute('role', 'menuitem');
            el.tabIndex = i === 0 ? 0 : -1;
          });
        }
        items()[0]?.focus();
      } else {
        triggerRef.current?.focus();
      }
    };
    panel.addEventListener('toggle', onToggle as EventListener);
    return () => panel.removeEventListener('toggle', onToggle as EventListener);
  }, [position, items, variant]);

  // Programmatic close (the render-prop `close`) flips state; this effect carries it to
  // the native popover. Native closes (Escape / outside click) already leave it hidden, so
  // the `:popover-open` guard makes that path a no-op. Reading the ref in an EFFECT is
  // allowed — the lint rule only forbids ref reads during render, which is exactly why
  // `close` is pure setState rather than a hidePopover() handed across the render boundary.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !open && panel.matches(':popover-open')) panel.hidePopover();
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  // Dismiss-on-navigate (see the header). Delegated on the panel so it covers links a call
  // site renders however it likes — next/link, a plain <a>, one nested in a row wrapper —
  // and so it costs nothing when the panel holds no links at all.
  //
  // `e.defaultPrevented` is deliberately NOT consulted: next/link preventDefaults in its own
  // onClick to run the client-side navigation itself, and React dispatches that handler
  // before this one bubbles, so the flag is TRUE in precisely the case that must close.
  // What IS excluded is every anchor activation the BROWSER would send somewhere other than
  // this page, because there the menu the reader opened is still the menu they are looking
  // at. (An `<a href="#">` used as a fake button would still dismiss — no panel has one, and
  // a non-navigating anchor is already the wrong element.)
  const dismissOnNavigate = (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a[href]');
    // React bubbles along the REACT tree, so a portal rendered by a child would reach this
    // handler from outside the panel's DOM; `contains` keeps the rule to our own panel.
    if (!link || !panelRef.current?.contains(link)) return;
    // Any of these has the browser take the link elsewhere — new tab, new window, download.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const linkTarget = link.getAttribute('target');
    if (link.hasAttribute('download') || (linkTarget && linkTarget !== '_self')) return;
    close();
  };

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (variant !== 'menu') return;
    const list = items();
    if (list.length === 0) return;
    const cur = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (idx: number) => {
      const target = list[idx];
      if (!target) return;
      e.preventDefault();
      list.forEach((el) => (el.tabIndex = el === target ? 0 : -1));
      target.focus();
    };
    if (e.key === 'ArrowDown') focusAt(rovingIndex(cur, 1, list.length));
    else if (e.key === 'ArrowUp') focusAt(rovingIndex(cur, -1, list.length));
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(list.length - 1);
  };

  return (
    <>
      {renderTrigger({
        ref: triggerRef,
        'aria-haspopup': variant === 'menu' ? 'menu' : 'dialog',
        'aria-expanded': open,
        popoverTarget: panelId,
      })}
      {/* popover + fixed position = top layer, so it clears every overflow clip and needs
          no z-index; the positioner sets left/top. */}
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        role={variant === 'menu' ? 'menu' : 'group'}
        aria-label={panelLabel}
        className={`${styles.panel} ${panelClassName ?? ''}`}
        onClick={dismissOnNavigate}
        onKeyDown={onPanelKeyDown}
      >
        {typeof children === 'function'
          ? (children as (api: AnchoredPopoverApi) => React.ReactNode)({ close })
          : children}
      </div>
    </>
  );
}
