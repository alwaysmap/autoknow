import type { ProgramBriefView } from '../lib/brief';
import RegenerateBriefButton from './RegenerateBriefButton';
import styles from './ProgramBrief.module.css';

// The AI-generated program brief (spec §2.12) — the "read this first" slot at the top of
// the program page. Fixed sections, every bullet carrying citations back to the exact
// in-app history page or ingested source it was drawn from. Synthesized only from data
// AutoKnow already stores; degrades to an honest empty state when Gemini is off.

export default function ProgramBrief({
  projectId,
  brief,
  geminiConfigured,
}: {
  projectId: number;
  brief: ProgramBriefView | null;
  geminiConfigured: boolean;
}) {
  if (!geminiConfigured) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Program brief</h2>
        </div>
        <p className={styles.empty}>
          AI briefs are off — no Gemini API key is configured. Set <code>GEMINI_API_KEY</code> to
          enable a daily synthesized summary of this program&apos;s updates.
        </p>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Program brief</h2>
          <RegenerateBriefButton projectId={projectId} hasBrief={false} />
        </div>
        <p className={styles.empty}>
          No brief yet. Generate one to get a synthesized read of this program&apos;s recent
          needle and phase updates, risks, decisions, and partner activity.
        </p>
      </div>
    );
  }

  const generated = new Date(brief.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>Program brief</h2>
        <span className={styles.provenance}>
          Generated {generated} by Gemini · from {brief.sourceCount} records
          {brief.stale && <span className={styles.stale}> · new activity since</span>}
        </span>
        <RegenerateBriefButton projectId={projectId} hasBrief />
      </div>

      <p className={styles.tldr}>{brief.tldr}</p>

      <div className={styles.sections}>
        {brief.body.sections.map((section) => (
          <section key={section.key} className={styles.section}>
            <h3 className={styles.sectionTitle}>{section.title}</h3>
            <ul className={styles.bullets}>
              {section.bullets.map((b, i) => (
                <li key={i} className={styles.bullet}>
                  {b.text}
                  {b.citations.length > 0 && (
                    <span className={styles.citations}>
                      {b.citations.map((c, j) =>
                        c.external ? (
                          <a key={j} href={c.href} target="_blank" rel="noopener noreferrer" className={styles.citation} title={c.label}>
                            {j + 1}
                          </a>
                        ) : (
                          <a key={j} href={c.href} className={styles.citation} title={c.label}>
                            {j + 1}
                          </a>
                        ),
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
