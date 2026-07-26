'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ChartLabel from './ChartLabel';
import Markdown from './Markdown';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import { LEAD_ROLES } from '../lib/builtinTemplates';
import { estimateTextWidth } from '../lib/labelPlacement';
import { updateTemplateMeta, cloneTemplate, saveTemplatePhases } from '../app/actions/templates';
import PhaseDagEditor, { DagEditorNode } from './PhaseDagEditor';
import PhaseTable from './PhaseTable';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './TemplateEditor.module.css';

// Template authoring: meta form + the shared PhaseDagEditor — the SAME card-DAG
// surface that edits a live program's layout builds template layouts. Built-ins are
// read-only (clone to edit) and render the preview + table instead.

export interface EditorPhase {
  id: number;
  name: string;
  description: string | null;
  googleFocus: string | null;
  leadRole: string | null;
  durationWeeks: number;
  isEndPhase: boolean;
  sortOrder: number;
  dependsOn: number[]; // upstream phase-template ids
}

interface TemplateEditorProps {
  template: { id: number; name: string; description: string | null; isBuiltIn: boolean };
  phases: EditorPhase[];
}

// Depth-column preview for the READ-ONLY built-in view: monochrome stations by
// longest-path depth, straight gray edges, the end phase ringed.
export interface DagPreviewPhase {
  id: number;
  name: string;
  isEndPhase: boolean;
  sortOrder: number;
  dependsOn: number[];
}

export function DagPreview({ phases }: { phases: DagPreviewPhase[] }) {
  const locale = useLocale();
  const byId = new Map(phases.map((p) => [p.id, p]));
  const depthMemo = new Map<number, number>();
  const depth = (id: number, seen: Set<number>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = (byId.get(id)?.dependsOn ?? []).filter((d) => byId.has(d));
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((x) => depth(x, seen))) + 1;
    depthMemo.set(id, d);
    return d;
  };
  phases.forEach((p) => depth(p.id, new Set()));

  const columns = new Map<number, DagPreviewPhase[]>();
  for (const p of [...phases].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const d = depthMemo.get(p.id)!;
    columns.set(d, [...(columns.get(d) ?? []), p]);
  }
  const pos = new Map<number, { x: number; y: number }>();
  const COL_W = 168, ROW_H = 34, PAD = 16;
  for (const [d, col] of columns) {
    col.forEach((p, i) => pos.set(p.id, { x: PAD + d * COL_W, y: PAD + 14 + i * ROW_H }));
  }
  const maxDepth = Math.max(0, ...depthMemo.values());
  const maxRows = Math.max(1, ...[...columns.values()].map((c) => c.length));
  const w = PAD * 2 + (maxDepth + 1) * COL_W;
  const h = PAD * 2 + 14 + maxRows * ROW_H;
  // Trim to the WIDTH the column actually has, not to a glyph count: a 17-character name
  // is ~110px in Latin and ~190px in Japanese, and the latter ran straight through the
  // next column's node. The budget is the gap from this label's left edge to the next
  // node's constraint ring, less a hair of breathing room.
  const LABEL_FS = 11, LABEL_DX = 12, RING_R = 8.5;
  const LABEL_MAX_W = COL_W - LABEL_DX - RING_R - 6;
  const truncate = (s: string) => {
    if (estimateTextWidth(s, LABEL_FS) <= LABEL_MAX_W) return s;
    const glyphs = [...s];
    while (glyphs.length > 1 && estimateTextWidth(glyphs.join('') + '…', LABEL_FS) > LABEL_MAX_W) glyphs.pop();
    return glyphs.join('') + '…';
  };

  if (phases.length === 0) return null;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={styles.preview} style={{ maxWidth: w }} aria-label={t(locale, 'templateDagPreview')}>
      {phases.flatMap((p) =>
        p.dependsOn.filter((d) => byId.has(d)).map((d) => {
          const a = pos.get(d)!, b = pos.get(p.id)!;
          return <line key={`${d}-${p.id}`} x1={a.x + 5} y1={a.y} x2={b.x - 8} y2={b.y}
            stroke="var(--border)" strokeWidth={1.6} />;
        }),
      )}
      {phases.map((p) => {
        const c = pos.get(p.id)!;
        return (
          <g key={p.id}>
            {p.isEndPhase && <circle cx={c.x} cy={c.y} r={8.5} fill="none" stroke="var(--chain)" strokeWidth={1.8} />}
            <circle cx={c.x} cy={c.y} r={5} fill="hsl(0, 0%, 25%)" />
            {/* Node names sit on a FIXED grid (COL_W apart, ROW_H down) and `truncate`
                now caps them by width, so two names cannot collide and no de-collision
                pass belongs here. They do cross the dependency edges, which is what
                ChartLabel's halo is for — this was the last hand-rolled `<text>` in the
                sweep (AGENTS lesson 7). */}
            <ChartLabel x={c.x + LABEL_DX} y={c.y + 3.5} fontSize={LABEL_FS} fill="var(--fg)">{truncate(p.name)}</ChartLabel>
            <title>{p.name}</title>
          </g>
        );
      })}
    </svg>
  );
}

export default function TemplateEditor({ template, phases }: TemplateEditorProps) {
  const locale = useLocale();
  const router = useRouter();
  const sorted = [...phases].sort((a, b) => a.sortOrder - b.sortOrder);
  const byId = new Map(phases.map((p) => [p.id, p]));

  if (template.isBuiltIn) {
    return (
      <div className={styles.container}>
        <Link href="/templates" className={styles.backLink}>{t(locale, 'backToTemplates')}</Link>
        <div className={styles.headRow}>
          <h1 className={styles.title}>{template.name}</h1>
          <span className={styles.builtinTag}>{t(locale, 'builtinCloneToEdit')}</span>
          <form action={cloneTemplate}>
            <input type="hidden" name="id" value={template.id} />
            <button type="submit" className={styles.primaryBtn}>{t(locale, 'clone')}</button>
          </form>
        </div>
        {template.description && (
          <div className={styles.templateDesc}><Markdown>{template.description}</Markdown></div>
        )}
        <DagPreview phases={phases} />
        {/* Built-in view: the read-only shared PhaseTable (see PhaseTable for the
            shared-DataTable rationale). */}
        <PhaseTable
          showLead
          rows={sorted.map((p) => ({
            id: p.id,
            name: p.name,
            isEndPhase: p.isEndPhase,
            weeks: p.durationWeeks,
            dependsOnNames: p.dependsOn.map((d) => byId.get(d)?.name ?? ''),
            leadRole: p.leadRole,
          }))}
        />
      </div>
    );
  }

  // Editable: the shared card-DAG surface (weeks map 1:1 onto durationWeeks).
  const initial: DagEditorNode[] = sorted.map((p) => ({
    id: p.id, name: p.name, weeks: p.durationWeeks, dependsOn: p.dependsOn,
    leadRole: p.leadRole, description: p.description, googleFocus: p.googleFocus,
  }));

  const onSave = async (draft: DagEditorNode[]) => {
    const fd = new FormData();
    fd.set('templateId', String(template.id));
    fd.set('payload', JSON.stringify(draft.map((d) => ({
      id: d.id, name: d.name, weeks: d.weeks, leadRole: d.leadRole ?? null,
      description: d.description ?? null, googleFocus: d.googleFocus ?? null, dependsOn: d.dependsOn,
    }))));
    const result = await saveTemplatePhases(fd);
    if (!result.error) router.refresh(); // re-sync `initial` so dirty resets
    return result;
  };

  return (
    <div className={styles.container}>
      <Link href="/templates" className={styles.backLink}>{t(locale, 'backToTemplates')}</Link>

      {/* template meta */}
      <form action={updateTemplateMeta} className={styles.metaForm}>
        <input type="hidden" name="id" value={template.id} />
        <div className={styles.metaFields}>
          <input name="name" defaultValue={template.name} className={styles.nameInput}
            aria-label={t(locale, 'templateName')} required />
          {/* rich markdown editor; the hidden input feeds the form as `description` */}
          <MarkdownNoteEditor name="description" ariaLabel={t(locale, 'templateDescription')}
            initialMarkdown={template.description ?? ''}
            placeholder={t(locale, 'programLevelDescription')} />
        </div>
        <button type="submit" className={styles.miniBtn}>{t(locale, 'saveBtn')}</button>
      </form>

      <PhaseDagEditor initial={initial} onSave={onSave} templateFields leadRoles={[...LEAD_ROLES]} />
    </div>
  );
}
