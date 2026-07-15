'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PhaseDagEditor, { DagEditorNode } from './PhaseDagEditor';
import { saveProgramPhases } from '../app/actions/programPhases';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import chrome from './TemplateEditor.module.css';

// Program-instance wrapper around the shared PhaseDagEditor: the same surface that
// builds template layouts updates a live program's layout. Programs store days;
// the editor speaks weeks — converted here, both ways.

export interface ProgramEditorPhase {
  id: number;
  name: string;
  forecastedDuration: number; // days
  progress: number;
  dependsOn: number[];
}

interface ProgramPhaseEditorProps {
  projectId: number;
  projectName: string;
  phases: ProgramEditorPhase[];
}

const toWeeks = (days: number) => Math.round((days / 7) * 10) / 10;
const toDays = (weeks: number) => Math.max(1, Math.round(weeks * 7));

export default function ProgramPhaseEditor({ projectId, projectName, phases }: ProgramPhaseEditorProps) {
  const locale = useLocale();
  const router = useRouter();

  const initial: DagEditorNode[] = phases.map((p) => ({
    id: p.id, name: p.name, weeks: toWeeks(p.forecastedDuration), progress: p.progress, dependsOn: p.dependsOn,
  }));

  const onSave = async (draft: DagEditorNode[]) => {
    const fd = new FormData();
    fd.set('projectId', String(projectId));
    fd.set('payload', JSON.stringify(draft.map((d) => ({
      id: d.id, name: d.name, forecastedDuration: toDays(d.weeks), dependsOn: d.dependsOn,
    }))));
    const result = await saveProgramPhases(fd);
    if (!result.error) router.push(`/programs/${projectId}`);
    return result;
  };

  return (
    <div className={chrome.container}>
      <Link href={`/programs/${projectId}`} className={chrome.backLink}>← {projectName}</Link>
      <div className={chrome.headRow}>
        <h1 className={chrome.title}>{t(locale, 'phasesHeading', { name: projectName })}</h1>
      </div>
      <PhaseDagEditor initial={initial} onSave={onSave} />
    </div>
  );
}
