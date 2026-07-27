'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PhaseDagEditor, { type DagEditorNode, type PhaseInvolvement } from './PhaseDagEditor';
import type { InvolvementLink } from './PhaseInvolvementEditor';
import { saveProgramPhases } from '../app/actions/programPhases';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import chrome from './TemplateEditor.module.css';

// Program-instance wrapper around the shared PhaseDagEditor: the same surface that
// builds template layouts updates a live program's layout. Programs store days;
// the editor speaks weeks — converted here, both ways.
//
// A program's phases are real rows, so this wrapper is also where involvement enters
// the editor: partners and people arrive as plain arrays (a Map cannot cross the
// server/client boundary) and become the editor's per-phase lookup here.

export interface ProgramEditorPhase {
  id: number;
  name: string;
  forecastedDuration: number; // days
  progress: number;
  dependsOn: number[];
  description: string | null; // Goal & DoD markdown (template-seeded, program-editable)
  partners: InvolvementLink[]; // PhasePartner rows on this phase
  people: InvolvementLink[]; // PhasePerson rows on this phase
}

interface ProgramPhaseEditorProps {
  projectId: number;
  projectName: string;
  phases: ProgramEditorPhase[];
  allPartners: { id: number; name: string }[]; // the picker's canonical option set
  allPeople: { id: number; name: string }[];
}

const toWeeks = (days: number) => Math.round((days / 7) * 10) / 10;
const toDays = (weeks: number) => Math.max(1, Math.round(weeks * 7));

export default function ProgramPhaseEditor({ projectId, projectName, phases, allPartners, allPeople }: ProgramPhaseEditorProps) {
  const locale = useLocale();
  const router = useRouter();

  const initial: DagEditorNode[] = phases.map((p) => ({
    id: p.id, name: p.name, weeks: toWeeks(p.forecastedDuration), progress: p.progress, dependsOn: p.dependsOn,
    description: p.description,
  }));

  const involvement: PhaseInvolvement = {
    projectId,
    byPhase: new Map(phases.map((p) => [p.id, { partner: p.partners, person: p.people }])),
    options: { partner: allPartners, person: allPeople },
  };

  const onSave = async (draft: DagEditorNode[]) => {
    const fd = new FormData();
    fd.set('projectId', String(projectId));
    fd.set('payload', JSON.stringify(draft.map((d) => ({
      id: d.id, name: d.name, forecastedDuration: toDays(d.weeks), dependsOn: d.dependsOn,
      description: d.description ?? null,
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
      <PhaseDagEditor initial={initial} onSave={onSave} descriptionField involvement={involvement} />
    </div>
  );
}
