// THE summary prompts, in one readable place. These are the DEFAULTS; a SummaryPrompt
// row in the database (editable under /manage/prompts) overrides its scope's default
// without a deploy. Placeholders: {SUBJECT} is replaced with the concrete subject line
// for the scope (program + partner names, partner name, or the ecosystem framing).
//
// The contract every prompt must keep is stated ONCE, in `CONTRACT` and `sectionsBlock`
// below — the renderer and the citation mapper depend on those words, so a paraphrase up
// here is a second copy free to go stale, and did: it still forbade every percentage
// after `CONTRACT` had been narrowed to hill positions, and still listed `themes` as
// unconditional after `scopeHasThemes` made it scope-dependent.

export type SummaryScope = 'ecosystem' | 'partner' | 'program';

export const SUMMARY_SCOPES: SummaryScope[] = ['ecosystem', 'partner', 'program'];

/**
 * What a refused or failed regeneration leaves standing, for the decline sentence
 * (lib/geminiQuota). Shared by the two surfaces that can refuse the SAME operation — the
 * `regenerateSummary` action and `POST /api/summaries/:scope/:id` — which had drifted to
 * calling the artifact a "briefing" and a "summary" respectively. It lives here, in the
 * vocabulary module both already import, rather than in the action: a `'use server'` file
 * may export nothing but async functions.
 */
export const BRIEFING_SURVIVED = 'the existing briefing is unchanged';

// The machine contract — the renderer and citation mapper depend on every line here.
//
// The percentage rule is narrower than it looks and was sharpened deliberately (#236
// fix 2): what is banned is a HILL POSITION as a number ("Audio HAL is at 60%"), because
// position is a place on a curve and the app never renders it as a figure. A SCHEDULE
// VARIANCE is a different quantity — the ledger beside the brief prints "117% past
// estimate" — so a brief that could not say it was contradicting the page it sits on.
const CONTRACT = `Synthesize ONLY from the numbered evidence records below — do not invent facts. Every bullet must list the evidence record ids it draws from in its "evidence" array, and ONLY there — never write ids or bracketed references like [0, 3] inside the prose itself. Skip a section (empty array) when the evidence has nothing real for it — a thin section is better than a padded one. Never state hill-chart progress as a number ("at 60%") — describe position in words; schedule variance against an estimate IS a number and may be quoted as the evidence gives it.

Each fact appears ONCE, in one place. The tldr states the takeaway; a bullet that restates the tldr in other words is deleted, not reworded. Two bullets in different sections describing the same blocker are one fact told twice — keep the one whose section it belongs to. Sections do not have to be filled: a brief carrying three real facts is three bullets long.`;

// Voice — the ABCD discipline (altitude, brevity, contrast, directness) plus a hard
// ban on the tells of machine-written filler. This is the part the reader feels.
const VOICE = `Write like a sharp human who respects the reader's time, not like an AI. Four rules:
- Altitude: pitch every line at the audience described above. Lead with the conclusion; never set the scene or restate what the subject is.
- Brevity: cut every word that doesn't change what the reader now knows or must do. No preamble, no throat-clearing, no summarizing sentence at the end.
- Contrast: say the hard thing plainly — what is slipping, blocked, at risk, or needs a decision. Being honest about problems is the whole point; do not soften it into mush.
- Directness: facts and specifics over adjectives. Active voice, plain verbs, short sentences. Quote the data — program and partner NAMES, day/week counts, SOP dates, the named blocker. No feelings, no vibes. Prefer "Audio HAL has blocked Ford Evos cert for three weeks; the December 2026 SOP is at risk" over "there are some challenges around audio."
- Dates: write them the way a person says them in a sentence — "August 2027", "end of March", "a December 2026 SOP" — at the coarsest truthful altitude (a target 300 days out is "August 2027", not a to-the-day date the plan cannot support). ISO dates (yyyy-mm-dd) are a TABLE format — they exist to sort and align in a column — so never write one inside a sentence.

Be specific or say nothing. Name the actual programs, partners, and numbers from the evidence — never hide behind vague quantifiers: "several", "a number of", "various", "some", "many", "a few", "key", "ample", "significant", "broadly", "largely". A sentence like "While several key partner programs remain on track with ample timeline buffers, ..." is banned — it asserts nothing; name which programs, how much buffer (in weeks), against which SOP. Do not open with a concessive throat-clearing clause ("While X remains on track, ...") that exists only to soften the real point — lead with the real point.

Never use this filler (it reads as AI slop): delve, leverage, robust, seamless, streamline, spearhead, landscape, ecosystem (as a buzzword), "in today's / the ever-evolving", "it's worth noting", "it is important to note", "furthermore", "moreover", "overall", "at the end of the day", "moving forward", "key stakeholders", holistic, synergy, unlock, empower, tapestry, testament, "a strong foundation". No hedging ("seems", "appears", "may", "likely") when the evidence is definite. No three-adjective lists. No sentence that opens by naming the subject and saying what it is. If a bullet carries neither a concrete fact nor a decision, delete it.`;

// Section meanings — shared, but each bullet still obeys VOICE.
//
// `risks` carries a DEFINITION now rather than a topic. Across eleven production briefs
// it had degenerated into a constraint slot: nine of them named "the current critical
// chain constraint" as the risk, including one with 322 days of buffer whose only risk
// bullet argued there was no risk, and one with 495 days that listed a dependency truism
// (#236 finding 2). A section with a name and no test is a section the model fills.
//
// `themes` is conditional because on a SINGLE program it has no cross-program pattern to
// find, and became reworded risks in every brief that carried one. It stays where it
// means something: the ecosystem, and a partner's portfolio.
const sectionsBlock = (themes: boolean) => `Sections:
- tldr: the one thing a leader must take away, in 1-3 sentences. Start with it. If the story is what CHANGED since the last brief, lead with the change.
- progress: what actually moved — shipped, unblocked, advanced. Direction of travel, in words.
- risks: what plausibly costs the SOP, the quality of the launch, or the relationship. Apply the test before writing a bullet: if the buffer absorbs it, it is not a risk — say nothing. Being the current constraint is not by itself a risk; name the constraint only when knowing it changes what the reader should do. A risk bullet says what is at stake and roughly how much.${
  themes
    ? '\n- themes: patterns ACROSS the evidence — a blocker recurring across programs, a partner behavior, a systemic gap. Only a pattern spanning more than one program belongs here; a restatement of a risk does not.'
    : '\n- themes: always an empty array for this scope. There is one program here, so there is no cross-program pattern to find, and anything you would write is a risk or a progress bullet in other words.'
}
- actions: the concrete next decisions or unblocks, each naming WHO must act and WHY. Every action's evidence carries two signals — the owner's affiliation (their company, in parentheses after their name) and a "next step" saying which side moves next. Honor both, and KEEP the parenthesized company in the bullet: it is what tells the reader which side the person is on. A partner-side owner acts FOR their own company: name the person and their company, and never tell them to "work with the partner" or "drive the partner" — they ARE the partner. A Google-side item is the program's internal owner's to drive. When the real move is cross-company, frame it as the program's Google-side owner working WITH the named partner contact — never the partner working with itself.

Health, when it is worse than On Track: give the RECORDED reason. If the evidence does not carry one, say plainly that no reason is recorded; if no open action addresses it, say that too — "nothing open addresses this" is itself the signal a leader needs. Naming the constraint is not a reason.

When the evidence contains no ingested source material, say so — this brief reflects only manually entered status, and nobody has fed the system a meeting note or a document. Do not narrate the charts on the page instead.`;

/**
 * Does a brief at this scope have a `themes` section at all? ONE predicate, because the
 * rule has two enforcement points that must never disagree: the prompt below stops asking
 * for the section, and `SummaryPanel` stops rendering it — which is what makes the change
 * visible on the append-only briefs already stored (#236 fix 3).
 */
export const scopeHasThemes = (scope: SummaryScope): boolean => scope !== 'program';

const build = (scope: SummaryScope, role: string, audience: string) =>
  `${role}\n\n${audience}\n\n${VOICE}\n\n${CONTRACT}\n\n${sectionsBlock(scopeHasThemes(scope))}`;

export const DEFAULT_SUMMARY_PROMPTS: Record<SummaryScope, string> = {
  program: build(
    'program',
    `You are writing the leadership brief at the top of the {SUBJECT} program page — the first thing an exec reads when they open it cold.`,
    `Audience: leaders reviewing this specific program. Assume they know the domain — AAOS/GAS, VHAL, BSP, SOP, silicon/OEM/Tier-1 roles — so don't explain the basics. What they need: is it on track for SOP, what is the one thing to act on today, and what decision or unblock is needed now.

The evidence names two different phases and calls neither of them by a word you should reuse loosely. The NEXT UNFINISHED phase on the chain is simply what comes next. The phase to ACT ON is one already past its own estimate — that is the program's constraint today, whatever the buffer says, and it is what the page's own headline names. When the evidence gives you one, it is the story.`,
  ),

  partner: build(
    'partner',
    `You are writing the leadership brief on Google's relationship with {SUBJECT} — relationship health, and how their programs trend as a portfolio.`,
    `Audience: leaders who own this partner relationship. Assume domain fluency. Be honest about where the relationship stands and whether the partner is delivering or dragging across their programs; do not flatter.

Relationship health is a WORD, never a number. The evidence names it — Critical, Strained, Steady, Strong, Exemplary, or Not rated — so write that word. Never render it as a score, a fraction or a rating ("3/5", "3 out of 5", "rated 3", "a 3"): those are the internal coordinates of a scale the reader has never seen, and they say less than the word does.`,
  ),

  ecosystem: build(
    'ecosystem',
    `You are writing the leadership brief for {SUBJECT} — the whole partner ecosystem across every active program and partner.`,
    `Audience: cross-org, cross-functional company leadership who are NOT deep in Android Automotive. Translate technical status into business impact — which launches are at risk, how much consumer capacity (vehicles shipping on time) is threatened, and where leadership attention is most leveraged. Avoid unexplained acronyms; expand one the first time if you must use it. Stay at company altitude — no per-program minutiae unless it moves the ecosystem picture.`,
  ),
};

export function isSummaryScope(v: string): v is SummaryScope {
  return (SUMMARY_SCOPES as string[]).includes(v);
}
