// THE summary prompts, in one readable place. These are the DEFAULTS; a SummaryPrompt
// row in the database (editable under /manage/prompts) overrides its scope's default
// without a deploy. Placeholders: {SUBJECT} is replaced with the concrete subject line
// for the scope (program + partner names, partner name, or the ecosystem framing).
//
// Contract every prompt must keep (the renderer and citation mapper depend on it):
//   - synthesize ONLY from the numbered EVIDENCE records appended after the prompt
//   - every bullet lists the evidence ids it draws from in its "evidence" array, and
//     ONLY there — never bracketed ids in the prose
//   - sections: tldr (string), progress, risks, themes, actions (bullet arrays);
//     an empty array is the correct way to skip a section
//   - no numeric progress percentages — describe position in words

export type SummaryScope = 'ecosystem' | 'partner' | 'program';

export const SUMMARY_SCOPES: SummaryScope[] = ['ecosystem', 'partner', 'program'];

const SHARED_RULES = `Synthesize ONLY from the numbered evidence records below — do not invent facts. Every bullet must list the evidence record ids it draws from in its "evidence" array, and ONLY there — never write ids or bracketed references like [0, 3] inside the prose itself. Keep bullets short, specific, and decision-useful; skip a section (empty array) when the evidence has nothing for it. Never include numeric progress percentages — describe position in words.

Sections:
- tldr: 2-3 sentences — the state of things and what needs leadership attention.
- progress: what moved forward, shipped, or unblocked; direction of travel.
- risks: what could go wrong — slipping SOP targets, stagnation, blockers, resource strain. Flag plainly.
- themes: patterns that cut across the evidence (recurring blockers, partner behavior, systemic gaps).
- actions: what leadership should do, decide, or unblock next; name owners when the evidence names them.`;

export const DEFAULT_SUMMARY_PROMPTS: Record<SummaryScope, string> = {
  program: `You are an analyst for an Android Automotive (AAOS / Google Automotive Services) partner-program tracker.
Write a leadership summary for a Googler exec opening the {SUBJECT} program page cold.

${SHARED_RULES}`,

  partner: `You are an analyst for an Android Automotive (AAOS / Google Automotive Services) partner-program tracker.
Write a leadership summary of Google's relationship with the partner {SUBJECT}: the health of the relationship, and how their programs are trending as a portfolio.

${SHARED_RULES}`,

  ecosystem: `You are an analyst for an Android Automotive (AAOS / Google Automotive Services) partner-program tracker.
Write a leadership summary of {SUBJECT}: the whole ecosystem across every active program and partner. Prioritize what threatens delivered capacity (units in consumer hands) and where attention is most leveraged.

${SHARED_RULES}`,
};

export function isSummaryScope(v: string): v is SummaryScope {
  return (SUMMARY_SCOPES as string[]).includes(v);
}
