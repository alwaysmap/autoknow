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

// The machine contract — the renderer and citation mapper depend on every line here.
const CONTRACT = `Synthesize ONLY from the numbered evidence records below — do not invent facts. Every bullet must list the evidence record ids it draws from in its "evidence" array, and ONLY there — never write ids or bracketed references like [0, 3] inside the prose itself. Skip a section (empty array) when the evidence has nothing real for it — a thin section is better than a padded one. Never include numeric progress percentages — describe position in words.`;

// Voice — the ABCD discipline (altitude, brevity, contrast, directness) plus a hard
// ban on the tells of machine-written filler. This is the part the reader feels.
const VOICE = `Write like a sharp human who respects the reader's time, not like an AI. Four rules:
- Altitude: pitch every line at the audience described above. Lead with the conclusion; never set the scene or restate what the subject is.
- Brevity: cut every word that doesn't change what the reader now knows or must do. No preamble, no throat-clearing, no summarizing sentence at the end.
- Contrast: say the hard thing plainly — what is slipping, blocked, at risk, or needs a decision. Being honest about problems is the whole point; do not soften it into mush.
- Directness: facts and specifics over adjectives. Active voice, plain verbs, short sentences. Quote the data — program and partner NAMES, day/week counts, SOP dates, the named blocker. No feelings, no vibes. Prefer "Audio HAL has blocked Ford Evos cert for three weeks; SOP 2026-12 is at risk" over "there are some challenges around audio."

Be specific or say nothing. Name the actual programs, partners, and numbers from the evidence — never hide behind vague quantifiers: "several", "a number of", "various", "some", "many", "a few", "key", "ample", "significant", "broadly", "largely". A sentence like "While several key partner programs remain on track with ample timeline buffers, ..." is banned — it asserts nothing; name which programs, how much buffer (in weeks), against which SOP. Do not open with a concessive throat-clearing clause ("While X remains on track, ...") that exists only to soften the real point — lead with the real point.

Never use this filler (it reads as AI slop): delve, leverage, robust, seamless, streamline, spearhead, landscape, ecosystem (as a buzzword), "in today's / the ever-evolving", "it's worth noting", "it is important to note", "furthermore", "moreover", "overall", "at the end of the day", "moving forward", "key stakeholders", holistic, synergy, unlock, empower, tapestry, testament, "a strong foundation". No hedging ("seems", "appears", "may", "likely") when the evidence is definite. No three-adjective lists. No sentence that opens by naming the subject and saying what it is. If a bullet carries neither a concrete fact nor a decision, delete it.`;

// Section meanings — shared, but each bullet still obeys VOICE.
const SECTIONS = `Sections:
- tldr: the one thing a leader must take away, in 1-3 sentences. Start with it.
- progress: what actually moved — shipped, unblocked, advanced. Direction of travel, in words.
- risks: what could miss or is already missing — SOP slips, stalls, blockers, resource strain. State it plainly and say why it matters.
- themes: patterns across the evidence (a blocker recurring across programs, a partner behavior, a systemic gap). Only if a real pattern exists.
- actions: the specific decisions or unblocks leadership should make next; name the owner when the evidence names one.`;

const build = (role: string, audience: string) =>
  `${role}\n\n${audience}\n\n${VOICE}\n\n${CONTRACT}\n\n${SECTIONS}`;

export const DEFAULT_SUMMARY_PROMPTS: Record<SummaryScope, string> = {
  program: build(
    `You are writing the leadership brief at the top of the {SUBJECT} program page — the first thing an exec reads when they open it cold.`,
    `Audience: leaders reviewing this specific program. Assume they know the domain — AAOS/GAS, VHAL, BSP, SOP, silicon/OEM/Tier-1 roles — so don't explain the basics. What they need: is it on track for SOP, what is the current constraint, and what decision or unblock is needed now.`,
  ),

  partner: build(
    `You are writing the leadership brief on Google's relationship with {SUBJECT} — relationship health, and how their programs trend as a portfolio.`,
    `Audience: leaders who own this partner relationship. Assume domain fluency. Be honest about where the relationship stands and whether the partner is delivering or dragging across their programs; do not flatter.`,
  ),

  ecosystem: build(
    `You are writing the leadership brief for {SUBJECT} — the whole partner ecosystem across every active program and partner.`,
    `Audience: cross-org, cross-functional company leadership who are NOT deep in Android Automotive. Translate technical status into business impact — which launches are at risk, how much consumer capacity (vehicles shipping on time) is threatened, and where leadership attention is most leveraged. Avoid unexplained acronyms; expand one the first time if you must use it. Stay at company altitude — no per-program minutiae unless it moves the ecosystem picture.`,
  ),
};

export function isSummaryScope(v: string): v is SummaryScope {
  return (SUMMARY_SCOPES as string[]).includes(v);
}
