'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeLocationChange } from './locationHash';

// #35/#40/#111's popover contract, extracted once (nnu) after NeedleGauge and
// RelationshipScale each hand-rolled it and had already started to drift: RelationshipScale
// wrote its "am I open" ref EAGERLY on open/close, NeedleGauge did not, and would
// redundantly re-run its own opening the one time it still called an internal opener
// synchronously. PhaseTrack's own popover is a third variant of the same shape with no
// guard at all — not migrated here (out of scope for nnu), but this is the one hook it
// should eventually sit on too, so the guard and the hash-listener contract cannot
// diverge a third way.
//
// Two things live together here because every caller needs both together, never one
// alone: which hash OPENS this popover (and optionally which sub-item it ADDRESSES), and
// whether a dismissal (× / Escape / backdrop) may proceed without confirming — a stray
// close must never silently drop an in-progress edit, while a pristine form should never
// nag.

export interface UseHashAddressablePopoverOptions {
  /** Does this hash open the popover at all? */
  matchesHash: (hash: string) => boolean;
  /** Extract the single sub-item this hash addresses, for a family member that can deep-
   *  link to ONE update (RelationshipScale) rather than just the log (NeedleGauge). */
  parseAddressed?: (hash: string) => number | null;
  /** The bare hash (no `#`) `openDetail()` writes when the resting row's own control
   *  opens the popover, rather than a link elsewhere in the app. */
  hashToWrite: string;
  /** Reset the edit form's fields — called on every fresh open, whichever path opened it. */
  onOpen: () => void;
  /** Has the (possibly still-open) form changed anything worth protecting? Recomputed by
   *  the caller every render from its own field state; read fresh on every dismiss. */
  fieldsDirty: boolean;
  /** Localized confirm-before-discarding prompt — resolved by the caller (`t()`), not
   *  hardcoded here, so this hook stays free of an i18n dependency. */
  confirmMessage: string;
  /** Rebinds the hash-listener effect — pass `[history]` (or whatever prop feeds the
   *  form's reset values) so a stale closure can never re-prefill from a superseded
   *  server value after a revalidate. */
  deps: unknown[];
}

export interface UseHashAddressablePopoverResult {
  open: boolean;
  /** The one sub-item a deep link addressed, or null for "just the log" / no such link
   *  arrived. Always null when `parseAddressed` is not given. */
  addressed: number | null;
  /** Opens the popover AND writes `hashToWrite`, for a resting-row control that is
   *  itself the opener (RelationshipScale's DETAIL) rather than a `<Link>` elsewhere
   *  whose navigation the hash listener already reacts to (NeedleGauge's, #168). */
  openDetail: () => void;
  closeDetail: () => void;
  /** `active`: is the thing being guarded (the inline update form) actually open right
   *  now? A closed form has nothing to protect regardless of `fieldsDirty`. */
  mayDismiss: (active: boolean) => boolean;
}

export function useHashAddressablePopover({
  matchesHash, parseAddressed, hashToWrite, onOpen, fieldsDirty, confirmMessage, deps,
}: UseHashAddressablePopoverOptions): UseHashAddressablePopoverResult {
  const [open, setOpenState] = useState(false);
  const [addressed, setAddressed] = useState<number | null>(null);
  // `history.replaceState` is patched (lib/locationHash) to notify listeners
  // SYNCHRONOUSLY, so `openDetail`'s own hash write re-enters the hash-listener effect
  // below in the SAME tick — before React has committed the render that would update
  // this ref from `open` state. Written eagerly alongside `setOpenState` so the
  // listener always sees the true live value instead of finding "not open yet" and
  // redundantly re-running the whole opening.
  const openRef = useRef(false);
  const setOpen = (next: boolean) => {
    openRef.current = next;
    setOpenState(next);
  };

  const openDetail = () => {
    onOpen();
    setOpen(true);
    // The resting row's own control always opens the LOG, never a single addressed
    // update — only an incoming hash (the effect below) can set that.
    setAddressed(null);
    const want = `#${hashToWrite}`;
    if (window.location.hash !== want) window.history.replaceState(null, '', want);
  };
  const closeDetail = () => {
    setOpen(false);
    setAddressed(null);
    if (matchesHash(window.location.hash)) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  // Deep link: arriving with a matching hash opens the popover directly, so a shared
  // URL or a feed/briefing citation lands on the record itself. Runs once per mount
  // and on every in-page hash change — Next's `<Link>` navigates via `pushState`,
  // which does not fire `hashchange` (#40), so subscribeLocationChange covers both.
  useEffect(() => {
    const openIfHashed = () => {
      const hash = window.location.hash;
      if (!matchesHash(hash)) return;
      // Set even when already open: a second addressed link (a different update)
      // while the popover is showing should still move the highlight/scroll target.
      if (parseAddressed) setAddressed(parseAddressed(hash));
      if (!openRef.current) {
        onOpen();
        setOpen(true);
      }
    };
    openIfHashed();
    return subscribeLocationChange(openIfHashed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const mayDismiss = (active: boolean) => !(active && fieldsDirty) || window.confirm(confirmMessage);

  return { open, addressed, openDetail, closeDetail, mayDismiss };
}
