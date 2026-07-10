'use client';

import { useFormStatus } from 'react-dom';
import { regenerateBrief } from '../app/actions/brief';
import styles from './ProgramBrief.module.css';

function SubmitButton({ hasBrief }: { hasBrief: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={styles.refreshBtn}>
      {pending ? 'Synthesizing…' : hasBrief ? 'Refresh' : 'Generate brief'}
    </button>
  );
}

export default function RegenerateBriefButton({ projectId, hasBrief }: { projectId: number; hasBrief: boolean }) {
  return (
    <form action={regenerateBrief}>
      <input type="hidden" name="projectId" value={projectId} />
      <SubmitButton hasBrief={hasBrief} />
    </form>
  );
}
