'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Markdown from './Markdown';
import { validateTemplateDag } from '../lib/templateDag';
import { LEAD_ROLES } from '../lib/builtinTemplates';
import {
  updateTemplateMeta, cloneTemplate, addPhaseTemplate, updatePhaseTemplate, deletePhaseTemplate,
} from '../app/actions/templates';
import styles from './TemplateEditor.module.css';

// Client editor for one program template: meta form, live DAG validation banner
// (lib/templateDag — the same check instantiation enforces), a depth-column DAG
// preview, and phase CRUD via a <dialog> (design.md §5). Built-ins are read-only.

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

// Depth-column preview: monochrome stations by longest-path depth, straight gray
// edges, the end phase ringed. Read-only — the table below is the editor.
function DagPreview({ phases }: { phases: EditorPhase[] }) {
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

  const columns = new Map<number, EditorPhase[]>();
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
  const truncate = (s: string) => (s.length > 17 ? s.slice(0, 16) + '…' : s);

  if (phases.length === 0) return null;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={styles.preview} style={{ maxWidth: w }} aria-label="Template DAG preview">
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
            {p.isEndPhase && <circle cx={c.x} cy={c.y} r={8.5} fill="none" stroke="#c98a1a" strokeWidth={1.8} />}
            <circle cx={c.x} cy={c.y} r={5} fill="hsl(0, 0%, 25%)" />
            <text x={c.x + 12} y={c.y + 3.5} fontSize={11} fill="var(--fg)">{truncate(p.name)}</text>
            <title>{p.name}</title>
          </g>
        );
      })}
    </svg>
  );
}

export default function TemplateEditor({ template, phases }: TemplateEditorProps) {
  const sorted = useMemo(() => [...phases].sort((a, b) => a.sortOrder - b.sortOrder), [phases]);
  const byId = new Map(phases.map((p) => [p.id, p]));

  const validation = useMemo(
    () =>
      validateTemplateDag(
        phases.map((p) => ({ id: p.id, isEndPhase: p.isEndPhase, name: p.name })),
        phases.flatMap((p) => p.dependsOn.map((d) => ({ nodeId: p.id, dependsOnId: d }))),
      ),
    [phases],
  );

  // The <dialog> serves both add and edit; a fresh key remounts the form so stale
  // values never leak between opens.
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<EditorPhase | null>(null);
  const [formKey, setFormKey] = useState(0);
  const openDialog = (p: EditorPhase | null) => {
    setEditing(p);
    setFormKey((k) => k + 1);
    dialogRef.current?.showModal();
  };
  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) dialogRef.current?.close();
  };

  if (template.isBuiltIn) {
    return (
      <div className={styles.container}>
        <Link href="/templates" className={styles.backLink}>← Templates</Link>
        <div className={styles.headRow}>
          <h1 className={styles.title}>{template.name}</h1>
          <span className={styles.builtinTag}>Built-in — clone to edit</span>
          <form action={cloneTemplate}>
            <input type="hidden" name="id" value={template.id} />
            <button type="submit" className={styles.primaryBtn}>Clone</button>
          </form>
        </div>
        {template.description && (
          <div className={styles.templateDesc}><Markdown>{template.description}</Markdown></div>
        )}
        <DagPreview phases={phases} />
        <PhaseTable phases={sorted} byId={byId} readOnly onEdit={() => {}} />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Link href="/templates" className={styles.backLink}>← Templates</Link>

      {/* template meta */}
      <form action={updateTemplateMeta} className={styles.metaForm}>
        <input type="hidden" name="id" value={template.id} />
        <div className={styles.metaFields}>
          <input name="name" defaultValue={template.name} className={styles.nameInput}
            aria-label="Template name" required />
          <textarea name="description" defaultValue={template.description ?? ''} rows={2}
            placeholder="Program-level description (markdown)…" className={styles.descInput}
            aria-label="Template description" />
        </div>
        <button type="submit" className={styles.miniBtn}>Save</button>
      </form>

      {/* live DAG validation — same rules instantiation enforces */}
      {!validation.ok && (
        <div className={styles.dagErrors} data-testid="dag-errors">
          {validation.errors.map((e, i) => <div key={i}>{e.message}</div>)}
        </div>
      )}

      <DagPreview phases={phases} />

      <div className={styles.tableHead}>
        <button type="button" className={styles.primaryBtn} onClick={() => openDialog(null)}>Add phase</button>
      </div>
      <PhaseTable phases={sorted} byId={byId} readOnly={false} onEdit={openDialog} />

      {/* add/edit dialog (design.md §5) */}
      <dialog ref={dialogRef} className={styles.dialog} onClick={onBackdrop}>
        <h3 className={styles.dialogTitle}>{editing ? `Edit “${editing.name}”` : 'Add phase'}</h3>
        <form
          key={formKey}
          action={async (fd) => {
            if (editing) await updatePhaseTemplate(fd);
            else await addPhaseTemplate(fd);
            dialogRef.current?.close();
          }}
          className={styles.dialogForm}
        >
          {editing
            ? <input type="hidden" name="id" value={editing.id} />
            : <input type="hidden" name="templateId" value={template.id} />}

          <label className={styles.fieldLabel}>Name
            <input name="name" defaultValue={editing?.name ?? ''} required className={styles.textInput} />
          </label>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Duration (weeks)
              <input name="durationWeeks" type="number" min={1} defaultValue={editing?.durationWeeks ?? 4}
                className={styles.numInput} />
            </label>
            <label className={styles.fieldLabel}>Lead role
              <select name="leadRole" defaultValue={editing?.leadRole ?? ''} className={styles.selectInput}>
                <option value="">—</option>
                {LEAD_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className={styles.checkLabel}>
              <input name="isEndPhase" type="checkbox" defaultChecked={editing?.isEndPhase ?? false} />
              End phase
            </label>
          </div>

          <label className={styles.fieldLabel}>Description — exit outcome + typical activities (markdown)
            <textarea name="description" rows={4} defaultValue={editing?.description ?? ''} className={styles.areaInput} />
          </label>

          <label className={styles.fieldLabel}>Google focus (markdown)
            <textarea name="googleFocus" rows={3} defaultValue={editing?.googleFocus ?? ''} className={styles.areaInput} />
          </label>

          <label className={styles.fieldLabel}>Depends on
            <select name="dependsOn" multiple size={Math.min(6, Math.max(3, phases.length))}
              defaultValue={(editing?.dependsOn ?? []).map(String)} className={styles.multiSelect}>
              {sorted.filter((p) => p.id !== editing?.id).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <div className={styles.dialogActions}>
            <button type="button" className={styles.miniBtn} onClick={() => dialogRef.current?.close()}>Cancel</button>
            <button type="submit" className={styles.primaryBtn}>Save phase</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function PhaseTable({ phases, byId, readOnly, onEdit }: {
  phases: EditorPhase[];
  byId: Map<number, EditorPhase>;
  readOnly: boolean;
  onEdit: (p: EditorPhase) => void;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Phase</th><th>Lead</th><th>Weeks</th><th>Depends on</th>{!readOnly && <th></th>}
        </tr>
      </thead>
      <tbody>
        {phases.map((p) => (
          <tr key={p.id} data-testid="phase-template-row">
            <td>
              <span className={styles.phaseName}>{p.name}</span>
              {p.isEndPhase && <span className={styles.endTag}>End</span>}
            </td>
            <td className={styles.muted}>{p.leadRole ?? '—'}</td>
            <td className={styles.numeric}>{p.durationWeeks}w</td>
            <td className={styles.muted}>
              {p.dependsOn.map((d) => byId.get(d)?.name).filter(Boolean).join(', ') || '—'}
            </td>
            {!readOnly && (
              <td className={styles.rowActions}>
                <button type="button" className={styles.miniBtn} onClick={() => onEdit(p)}>Edit</button>
                <form
                  action={deletePhaseTemplate}
                  className={styles.inlineForm}
                  onSubmit={(e) => { if (!confirm(`Remove the “${p.name}” phase from this template?`)) e.preventDefault(); }}
                >
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className={styles.dangerBtn}>Delete</button>
                </form>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
