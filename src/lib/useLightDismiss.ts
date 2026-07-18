'use client';

import { useEffect, type RefObject } from 'react';

// Backdrop-click-to-close for <dialog>, for engines that lack the native `closedby`
// attribute. A no-op where `closedBy` is supported (the markup uses closedby="any").
// Shared by the person/partner editor dialogs.
export function useLightDismiss(ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !('closedBy' in HTMLDialogElement.prototype)) {
      const onClick = (event: MouseEvent) => {
        if (event.target === dialog) dialog.close();
      };
      dialog.addEventListener('click', onClick);
      return () => dialog.removeEventListener('click', onClick);
    }
  }, [ref]);
}
