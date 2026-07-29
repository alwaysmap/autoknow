'use client';

import { useState } from 'react';
import admin from './ProjectAdminControls.module.css';

// THE server-action runner for a dialog form.
//
// A failed server action must surface INSIDE the dialog: thrown messages are masked in
// production and a throw hits the route error boundary, which unmounts the modal and
// destroys whatever the user had typed. So actions RETURN `{ error }` (lib/actionResult)
// and this renders it in place. `redirect()` on success still propagates as a throw and
// navigates, which is why the runner does not catch.
//
// It lives here because it existed three times over: twice in `PartnerEditor`
// (`NewPartnerButton` and `PartnerAdminControls`, hand-copied) and once more the moment
// `EscalationEditor` needed the same guard. That third copy is what AGENTS lesson 7 asks
// you to notice — the fix for "the same control exists in three hand-rolled variants" is
// not to write the third, so all three now point here.

export interface DialogAction {
  /** True while an action is in flight — every submit/cancel button disables on it. */
  saving: boolean;
  /** The inline error node, or `null`/`false` when there is nothing to show. */
  errorLine: React.ReactNode;
  /** Run `action` with `formData`; returns whether it succeeded, so a caller can close
   *  the dialog only on success. */
  runAction: (
    formData: FormData,
    action: (fd: FormData) => Promise<{ error?: string }>,
  ) => Promise<boolean>;
}

export default function useDialogAction(): DialogAction {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (
    formData: FormData,
    action: (fd: FormData) => Promise<{ error?: string }>,
  ): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const result = await action(formData);
      if (result?.error) {
        setError(result.error);
        return false;
      }
      return true;
    } finally {
      setSaving(false);
    }
  };

  return {
    saving,
    errorLine: error && <p role="alert" className={admin.warningText}>{error}</p>,
    runAction,
  };
}
