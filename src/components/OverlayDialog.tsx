'use client';

import React, { useEffect, useId, useRef } from 'react';
import styles from './OverlayDialog.module.css';

// THE overlay container for embedded content (#34). Every `<dialog>` in the app sized and
// dismissed itself differently — 10 sizing rules, 6 close mechanisms — and one used
// `height:` where `max-height:` was meant, so a one-line history rendered as a half-empty
// full-height sheet. This owns all five properties once:
//   (a) locks body scroll while open, RESTORING the prior value on close;
//   (b) resizes with the viewport (`max-height`, never `height`, capped at the safe area);
//   (c) a single scroll region between a fixed header and footer, so the title and the
//       close/confirm actions are always reachable without scrolling;
//   (d) one dismiss contract — backdrop click, Escape, and a consistent × — with a guard;
//   (e) it can never overflow, because the height is a cap and the body scrolls.
//
// Two design.md §4b traps it closes for good:
//   1. `display: flex` on a `<dialog>` overrides the UA `display: none` for the CLOSED
//      state, leaving an invisible full-size overlay that swallows clicks — so the flex is
//      scoped to `.dialog[open]` in the module.
//   2. A click on the dialog's own PADDING reports the dialog as the event target, so
//      `target === dialog` reads as a backdrop click and can discard a half-typed form.
//      Dismiss is decided by the BOUNDING BOX instead (and honours `canClose`).
//
// It never opens a second `<dialog>` from within (§4b: no stacked modals) — an in-place
// form is a mode of the same overlay, passed as `children`.

export interface OverlayDialogProps {
  open: boolean;
  onClose: () => void;
  /** Max content width; the container still caps at the safe viewport. e.g. '30rem', '56rem'. */
  width?: string;
  /** Fixed header content. When set, the container adds the consistent × (needs closeLabel). */
  title?: React.ReactNode;
  /** Accessible label for the × button, e.g. t(locale, 'close'). */
  closeLabel?: string;
  /** Fixed footer, rendered OUTSIDE `children`. Good for actions that aren't a form
   *  submit (a viewer's Close/Update). A `<form>`'s own submit/cancel must stay INSIDE
   *  the `<form>` in `children`, or a footer button won't submit it. */
  footer?: React.ReactNode;
  /** Accessible name when there is no visible title. */
  ariaLabel?: string;
  /** Forwarded to the <dialog> (e2e hooks, e.g. "needle-detail"). */
  dataTestId?: string;
  /** Return false to BLOCK a backdrop/Escape dismiss (e.g. a half-typed note). The × and an
   *  explicit onClose still close it; this only guards the light-dismiss paths. */
  canClose?: () => boolean;
  /** Extra class on the <dialog> — look only, never sizing/positioning. */
  className?: string;
  children: React.ReactNode;
}

export default function OverlayDialog({
  open,
  onClose,
  width = '32rem',
  title,
  closeLabel,
  footer,
  ariaLabel,
  dataTestId,
  canClose,
  className,
  children,
}: OverlayDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // React state drives the native modal.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // (a) Lock body scroll while open, restoring the prior value — not clobbering it.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Mirror native closes (Escape, .close(), the ×) back to React.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onNativeClose = () => onClose();
    d.addEventListener('close', onNativeClose);
    return () => d.removeEventListener('close', onNativeClose);
  }, [onClose]);

  // Escape routes through the native 'cancel' event; honour the guard.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      if (canClose && !canClose()) e.preventDefault();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [canClose]);

  // (d) Backdrop dismiss decided by the BOUNDING BOX, not target-identity (§4b trap 2).
  const onBackdropClick = (e: React.MouseEvent) => {
    const d = ref.current;
    if (!d || e.target !== d) return; // clicks on children carry a child target — ignore
    if (canClose && !canClose()) return;
    const r = d.getBoundingClientRect();
    const inside =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) d.close();
  };

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${className ?? ''}`}
      style={{ ['--overlay-width' as unknown as string]: width }}
      data-testid={dataTestId}
      aria-labelledby={title != null ? titleId : undefined}
      aria-label={title == null ? ariaLabel : undefined}
      onClick={onBackdropClick}
    >
      {title != null ? (
        <header className={styles.header}>
          <div className={styles.titleText} id={titleId}>{title}</div>
          <button
            type="button"
            className={styles.close}
            aria-label={closeLabel ?? 'Close'}
            onClick={() => ref.current?.close()}
          >
            <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
          </button>
        </header>
      ) : null}
      <div className={styles.body}>{children}</div>
      {footer != null ? <div className={styles.footer}>{footer}</div> : null}
    </dialog>
  );
}
