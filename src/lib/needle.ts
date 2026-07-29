import { parseHealth } from './health';

// The needle now represents program Health (see lib/health.ts). formatNeedleValue is
// the compatibility shim so existing badge call-sites render the health label.

export function formatNeedleValue(val: string | number | null | undefined): string {
  return parseHealth(val);
}

// ---- Deep-link fragments -------------------------------------------------------
// A program's status history lives in the DETAIL popover on its program page — there
// is no standalone page (`/history/project/:id` was retired 2026-07-20). The popover
// IS a URL (design.md §4b), and this family is the THIRD member of one shape:
// `lib/phase` owns `#phase-:id` and `#phase-:id-progress`, `lib/relationship` owns
// `#relationship-update-:id`, and this owns `#status-update-:id`. The vocabulary lives
// in the domain module, the ROUTE it hangs off lives in `lib/entityHref`.
//
// It used to stop at the log. Every citation under a briefing bullet about the May 1
// update, and every feed row for one status change, wrote the same
// `/programs/:id#status-history` — so a reader who clicked ONE update got the whole
// log and had to find it again by hand (autoknow-51j). The prefix is shared so a
// reader who knows one fragment can guess the other, and neither matches the other's
// target.
//
// The hash never reaches the server, so resolution is necessarily client-side —
// `NeedleGauge` listens via `useHashAddressablePopover`.

/** Opens the program-status log. */
export const STATUS_HISTORY_HASH = 'status-history';

/** Opens the log AND surfaces one update, addressed by its `ProjectState.id`. */
export const statusUpdateHash = (stateId: number): string => `status-update-${stateId}`;

/** `ProjectState.id` out of a `#status-update-:id` fragment (with or without the `#`),
 *  or null when the fragment addresses no single update. */
export const parseStatusUpdateHash = (hash: string): number | null => {
  const m = /^#?status-update-(\d+)$/.exec(hash);
  return m ? parseInt(m[1], 10) : null;
};

/** Does this fragment ask for the status popover at all — the log itself or one update
 *  within it? */
export const isStatusHash = (hash: string): boolean =>
  hash.replace(/^#/, '') === STATUS_HISTORY_HASH || parseStatusUpdateHash(hash) !== null;
