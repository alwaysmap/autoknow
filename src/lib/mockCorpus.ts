// The mock ingestion corpus: authored source DOCUMENTS (not digests) that the seed
// feeds through the app's real ingest boundary, and that the mock connector re-serves
// on refresh so re-ingestion can be watched end to end without a network.
//
// WHY RAW TEXT AND NOT DIGESTS. These are the documents themselves, so with a
// GEMINI_API_KEY set the demo runs the SAME pipeline production does: Gemini distils each
// one, the digest is embedded, and the row carries a real contentHash. Without a key the
// app degrades honestly (lib/gemini) and the text still reads well. Authoring the digests
// instead would be cheaper and would mean the demo never exercised distillation,
// classification, hashing, revisions or embedding at all.
//
// WHY EVERY SOURCE IS VERSIONED. `revisions` is the whole point of the fixture: index 0
// is what the first ingest sees, and each later entry is what a LATER fetch finds. That
// is what lets lib/refresh's real gates run against seeded data — the content hash
// genuinely differs, so a genuine ContextRevision with a genuine delta is appended, and
// an "Updated: …" card genuinely appears in the feed. A bug whose last revision reads
// as fixed extracts `sourceStatus: 'resolved'` and FREEZES its row, which is the
// freshness lifecycle running to completion on demo data.
//
// WHAT THE CONTENT IS FOR. Program and phase timelines already say when things happen.
// These documents carry the three things timelines cannot, and the seed's own numbers
// deliberately corroborate them (a partner whose relationship score is 2 is a partner
// whose threads read badly):
//
//   1. PEOPLE AND RELATIONSHIP DYNAMICS — a sponsor going quiet, an escalation drafted
//      and never sent, a lead rotating off mid-phase, a partner who delivers exactly
//      what was asked and nothing more.
//   2. ONE DEFECT CLASS RECURRING ACROSS PROGRAMS — the audio output-thread priority
//      inversion below appears in FOUR sources under four vocabularies ("no audio
//      output", "sits mute", "clipped chime", "SCHED_FIFO before mixer init") that share
//      almost no keywords. Finding that cluster is a semantic-retrieval problem a
//      substring search cannot solve, so it is the corpus's honest test of whether the
//      embeddings are doing anything (see the fallback-embedding knowledge note: without
//      a real model every score is the same pedestal, and this cluster will NOT surface).
//   3. RISK SIGNALS OFF THE TIMELINE — a standards body changing a rule mid-programme, a
//      supplier quality escape, a bootloader left unlocked in a patch, one person gating
//      several certifications.

import type { SourceKind, TrackingMode } from './sources';

/** One version of a source: what a fetch at that point in time returns. */
export interface MockRevision {
  /**
   * Days before seed time this version became the live content. Load-bearing only at
   * index 0, which dates the ingest (lib/seed); a later refresh stamps the real clock,
   * as it must. The later values keep each source's chronology legible while authoring
   * and are what tests/mockConnector asserts the oldest-first ordering on.
   */
  daysAgo: number;
  text: string;
}

export interface MockSource {
  /** Stable identity. Becomes `sourceRef` as `mock:<key>` — the dedupe key AND the
   *  key the connector reads its revisions back by. */
  key: string;
  url: string;
  /** Recorded at ingest; drives `ContextUrl.type` and hence the refresh cadence. */
  kind: Exclude<SourceKind, 'text'>;
  title: string;
  /** Who brought it in — a real seeded person's email, or a Drive sharer. */
  addedBy: string;
  /** Anchored by NAME; the seed resolves to ids. A phase anchor is authored rather
   *  than inferred so seeding stays deterministic and spends no Gemini on
   *  classifyWithinAnchor. */
  anchor: { program?: string; partner?: string; phase?: string };
  /** Watched sources are re-checked by the cycle; snapshots are events, never re-read. */
  mode: TrackingMode;
  /** 'user' when a human deliberately chose that mode over the inferred default —
   *  a chat THREAD someone decided to keep watching, rather than a sent message. */
  modeSource: 'inferred' | 'user';
  /** Index 0 is the initial ingest; later entries are what a refresh finds. */
  revisions: [MockRevision, ...MockRevision[]];
}

// ---------------------------------------------------------------------------------
// 1. The recurring defect class. Four sources, four vocabularies, one root cause:
//    the audio HAL's output thread runs at default priority and loses the race with
//    the mixer during start-up. Nobody in these threads connects them to each other.
// ---------------------------------------------------------------------------------

const AUDIO_CLUSTER: MockSource[] = [
  {
    key: 'bug-qcom-audio-coldboot',
    url: 'https://buganizer.corp.google.com/issues/889413',
    kind: 'tracker',
    title: 'b/889413 — No audio output for ~9s after cold boot (SA8295P)',
    addedBy: 'sjenkins@qualcomm.com',
    anchor: { program: 'Qualcomm Snapdragon Cockpit Support', phase: 'Audio' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 52,
        text: `Status: Open · Priority: P1 · Component: Automotive > Audio > HAL

Summary
On a cold boot of the SA8295P reference cockpit, the head unit produces no audio at all
for roughly nine seconds after ignition. Navigation prompts issued in that window are
lost silently — they are never queued and never replayed. Warm boot and resume from
suspend are unaffected.

Repro (12/12)
1. Battery disconnect, reconnect, ignition on.
2. Trigger any navigation prompt within 8s of the display lighting up.
3. Observe: no output, no error, no underrun counter movement.

Notes from triage
Sarah Jenkins: this reproduces on two boards and one production-intent sample, so it is
not a bring-up artefact. audioserver is up and accepting binder calls the whole time —
it reports the stream as ACTIVE while nothing reaches the codec. That points at the HAL
rather than the framework.

Kenji asked whether this is the same thing his team logged on their platform. I do not
think so; theirs is a chime timing issue and this is a hard nine-second gap.`,
      },
      {
        daysAgo: 19,
        text: `Status: Open · Priority: P0 · Component: Automotive > Audio > HAL

Summary
On a cold boot of the SA8295P reference cockpit, the head unit produces no audio at all
for roughly nine seconds after ignition. Raised to P0 after the same signature was seen
on a customer vehicle build.

ROOT CAUSE FOUND
The HAL's output thread is created at default scheduling priority and immediately
contends with the mixer's initialisation work. Under the load of a cold start the output
thread loses that race for as long as the mixer takes to settle — nine seconds on this
board, and a shorter but non-zero window on any board. It is a priority inversion, not a
codec or a clocking problem, which is why nothing in the audio path logs an error: from
the framework's point of view the stream really is active.

Consequence worth stating plainly: every platform sharing this HAL has this defect. The
duration varies with board speed, so on faster hardware it presents as a short clipped
or dropped sound rather than a long silence, and would very likely have been filed as a
cosmetic bug somewhere else.

Fix in review as ag/99841.`,
      },
      {
        daysAgo: 4,
        text: `Status: Fixed (merged) · Priority: P0 · Component: Automotive > Audio > HAL

RESOLVED. ag/99841 merged to the Qualcomm branch and verified on three boards: audio is
available 400ms after display-on, down from ~9s. Closing.

Sarah Jenkins: closing this one, but I want to flag for whoever reads it later — the
defect is in shared HAL code, and the fix has ONLY been merged to our branch. Any
programme carrying this HAL still has it. On faster boards it will not look like a
nine-second silence; it will look like a clipped chime or a dropped first prompt, and
nobody will connect that back to here.

I have no visibility into which other programmes carry this code, so I cannot file
against them. Flagging rather than dropping it.`,
      },
    ],
  },
  {
    key: 'chat-ford-evos-startup-mute',
    url: 'https://chat.google.com/room/ford-evos-dev-talk/startup-mute',
    kind: 'chat',
    title: 'Ford Evos dev — "unit sits mute through the whole startup chime"',
    addedBy: 'bob@google.com',
    anchor: { program: 'Ford Evos AAOS Bring-up', phase: 'Audio' },
    mode: 'watched',
    modeSource: 'user',
    revisions: [
      {
        daysAgo: 41,
        text: `#ford-evos-dev-talk

Bob AccountManager: Ford's validation team filed something odd from the drive event.
When you start the car the IVI sits completely mute through what should be the startup
chime. Comes good on its own after a few seconds, no error anywhere.

Bob AccountManager: their words, not mine — "three of the six drivers assumed the unit
was dead and started pressing things". That is the actual problem here. It is not the
missing sound, it is that the vehicle looks broken during the first impression.

Dieter Meyer: we see nothing on the CAN side, audio is not our layer. Amp is enabled and
unmuted the whole time.

Bob AccountManager: Ford are asking whether this blocks their drive-event build. I said
I would find out. Honestly I do not know who owns this — it is not the amp, it is not
CAN, and the framework says the stream is playing.

Dieter Meyer: agreed it is above us. Someone with platform audio context needs to look.

Bob AccountManager: parking it as "investigating" for now. Nobody has picked it up.`,
      },
      {
        daysAgo: 11,
        text: `#ford-evos-dev-talk

Bob AccountManager: Ford's validation team filed something odd from the drive event.
When you start the car the IVI sits completely mute through what should be the startup
chime. Comes good on its own after a few seconds, no error anywhere.

Dieter Meyer: we see nothing on the CAN side, audio is not our layer.

Bob AccountManager: parking it as "investigating" for now. Nobody has picked it up.

--- three weeks later ---

Bob AccountManager: bumping this. Ford asked again in the programme review and I still
do not have an owner for it. It has now been open a month with nobody assigned.

Bob AccountManager: to be clear about the risk — this is on the drive-event build, which
is what their executives will sit in. "Looks broken on start" is not a defect I want to
discover in that room.

Dieter Meyer: I am out from next week for six weeks, so if it does turn out to touch our
integration someone else at Bosch will need to pick it up. I have not had time to hand
over the audio context.`,
      },
    ],
  },
  {
    key: 'chat-honda-chime-clip',
    url: 'https://chat.google.com/room/honda-accord-cockpit/chime-clip',
    kind: 'chat',
    title: 'Honda Accord cockpit — clipped welcome chime on wake',
    addedBy: 'marcusw@google.com',
    anchor: { program: 'Honda Accord AAOS Bring-up', phase: 'HAL Integration' },
    mode: 'watched',
    modeSource: 'user',
    revisions: [
      {
        daysAgo: 33,
        text: `#honda-accord-cockpit

Aiko Tanaka: Small one from Denso's bench testing. On wake from suspend the first part
of the welcome chime is missing — roughly the first 300 milliseconds. The rest plays
normally. It is subtle enough that two of our testers did not notice until it was
pointed out.

Marcus Webb: cosmetic, or does it affect prompts too?

Aiko Tanaka: we have only characterised the chime. Denso's view is that it is a polish
item and they have logged it at low priority against the cockpit integration.

Marcus Webb: agreed, low priority. Not going to spend bring-up time on 300ms of a chime.

Aiko Tanaka: Denso will fix it if we raise it formally, but they will not investigate on
their own initiative. That is roughly how everything works with them — they deliver
exactly the scope in the statement of work and nothing beyond it. Reliable, but it does
mean nothing gets found unless we go looking.`,
      },
    ],
  },
  {
    key: 'gerrit-audio-hal-priority',
    url: 'https://android-review.googlesource.com/c/platform/hardware/interfaces/+/99841',
    kind: 'tracker',
    title: 'ag/99841 — audio: raise output thread priority before mixer init',
    addedBy: 'sjenkins@qualcomm.com',
    anchor: { partner: 'Qualcomm' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 17,
        text: `Change 99841 — Status: Review in progress
audio: raise output thread priority before mixer init

The output thread is created at default priority and races the mixer's initialisation.
Where the mixer takes a long time to settle, the output thread is starved and no frames
reach the codec, while the framework continues to report the stream as ACTIVE. Bind the
output thread to SCHED_FIFO before mixer init so the ordering is guaranteed rather than
incidental.

Files: audio/core/OutputThread.cpp, audio/core/Mixer.cpp

Reviewer comment (sjenkins@): confirmed on SA8295P — 9s silence becomes 400ms.

Reviewer comment (deepak@mediatek.example): this code is shared. We carry it too, on
slower silicon than the reference board, so if anything our exposure is worse. Please do
not merge this only to one branch — it needs to go to the shared branch or every
platform keeps the defect.

Author reply: agreed in principle, but I only have approver rights on our branch. Merging
there so our P0 can close; someone with shared-branch rights will need to take it
onward.`,
      },
      {
        daysAgo: 4,
        text: `Change 99841 — Status: Merged
audio: raise output thread priority before mixer init

Merged to the Qualcomm platform branch.

Reviewer comment (deepak@mediatek.example): reiterating for the record that this landed
on ONE branch. The shared branch still has the original code, so every other programme
built from it still has the defect. No cherry-pick has been proposed.

Reviewer comment (sjenkins@): correct. I have flagged it on b/889413 as well. Neither of
us has visibility into which programmes carry this HAL, so neither of us can raise it
against them.`,
      },
    ],
  },
];

// ---------------------------------------------------------------------------------
// 2. People and relationship dynamics. What the phase data cannot show: attention,
//    sponsorship, trust, and continuity. Corroborates the seeded relationship scores.
// ---------------------------------------------------------------------------------

const RELATIONSHIP_SOURCES: MockSource[] = [
  {
    key: 'doc-stellantis-qbr-notes',
    url: 'https://docs.google.com/document/d/stellantis-stla-qbr-notes',
    kind: 'drive',
    title: 'Stellantis STLA — quarterly business review notes',
    addedBy: 'priyash@google.com',
    anchor: { program: 'Stellantis STLA GAS Rollout', partner: 'Stellantis' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 46,
        text: `Stellantis STLA SmartCockpit — QBR notes
Attendees: Priya Sharma (Google), two Stellantis engineering leads. Executive sponsor
did not attend; no delegate was sent.

Brand matrix
Still unresolved. Which brands take the reference head unit and which get bespoke
skinning has now been open across three consecutive reviews. The engineering leads in
the room were clear that they cannot make this call — it needs the sponsor, and the
sponsor has not attended since the programme started.

What was agreed
Nothing was agreed. The engineering leads took an action to "seek direction", which is
the same action recorded at the last two reviews.

Priya's assessment
The working level is competent and engaged. The blockage is entirely above them. Every
downstream date depends on the brand matrix, so the programme is accumulating schedule
risk while looking, on paper, like it is progressing.

Escalation
I have drafted a note to their VP of Software. Holding it until after the next sync in
case the sponsor turns up.`,
      },
      {
        daysAgo: 20,
        text: `Stellantis STLA SmartCockpit — QBR notes (updated after the follow-up sync)
Attendees: Priya Sharma (Google), two Stellantis engineering leads. Executive sponsor
did not attend. This is the fourth consecutive absence.

Brand matrix
Still unresolved. Now open across four reviews.

Escalation
The drafted note to their VP of Software has NOT been sent. I have been holding it for
six weeks waiting for a sync that would make it unnecessary, and that sync keeps not
happening. Recording that plainly because "escalation drafted" has been in my notes long
enough that it reads like something we did.

Priya's assessment
Unchanged and getting worse. The engineering relationship is fine; the sponsorship
relationship does not exist. I do not think this programme can hit its dates and I do
not think anyone senior on either side currently believes it is at risk, because the
phase reporting looks normal.

New concern
One of the two engineering leads mentioned he is moving to a different programme next
month. If that happens we lose the only continuity we have.`,
      },
    ],
  },
  {
    key: 'chat-volvo-cert-escalation',
    url: 'https://chat.google.com/room/volvo-ex90-programme/cert-escalation',
    kind: 'chat',
    title: 'Volvo EX90 — certification slip escalation thread',
    addedBy: 'lena@continental.example',
    anchor: { program: 'Volvo EX90 AAOS Refresh', partner: 'Volvo Cars' },
    mode: 'watched',
    modeSource: 'user',
    revisions: [
      {
        daysAgo: 38,
        text: `#volvo-ex90-programme

Sven Larsson: I need to be direct. We were told the regression and certification pass
would start on schedule and we built our launch communications around that. It did not
start on schedule and we found out from our own status meeting, not from you.

Lena Fischer: the driver update pass took longer than forecast on our side. I should
have raised it earlier — that is on me.

Sven Larsson: I appreciate that. The issue is not the slip, slips happen. The issue is
that we heard about it late enough that our marketing team had already committed to a
date externally. That has now been walked back and it was visible.

Sven Larsson: my leadership has asked me why we are finding out about Google-side
schedule changes from our own people. I do not have a good answer.

Lena Fischer: understood. I will move to a weekly written status rather than raising
things only when they change.

Sven Larsson: that would help. I want to say clearly that the working relationship is
good and I am not looking to escalate further. But this cost us credibility internally
and it will take a while to rebuild.`,
      },
      {
        daysAgo: 9,
        text: `#volvo-ex90-programme

Sven Larsson: I need to be direct. We were told the regression and certification pass
would start on schedule and we built our launch communications around that.

Lena Fischer: understood. I will move to a weekly written status.

--- four weeks later ---

Lena Fischer: fourth weekly status posted. No changes to forecast this week.

Sven Larsson: thank you — genuinely, the weekly cadence has helped. My leadership has
stopped asking me about it, which is the best signal I can give you.

Sven Larsson: one thing I want to put on the record while it is going well rather than
badly: we are carrying this programme AND the Digital Key programme with the same small
team on our side. If both certification windows land in the same quarter we will not be
able to staff both properly. That is not a complaint about anything that has happened,
it is a warning about something that has not happened yet.`,
      },
    ],
  },
  {
    key: 'doc-hyundai-launch-retro',
    url: 'https://docs.google.com/document/d/hyundai-ioniq-gas-launch-retro',
    kind: 'drive',
    title: 'Hyundai Ioniq GAS — joint launch retrospective',
    addedBy: 'priyash@google.com',
    anchor: { program: 'Hyundai Ioniq GAS Integration', partner: 'Hyundai' },
    mode: 'snapshot',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 27,
        text: `Hyundai Ioniq GAS — joint launch retrospective
Run jointly, both sides in the room, written up together.

What worked
Hyundai brought decision-makers to every review, which meant no question waited more than
a week for an answer. Their engineering leads had authority to commit and used it.

Joint co-marketing of the GAS launch was agreed early and neither side re-litigated it.
This is worth naming because it is unusual — most programmes spend weeks relitigating
scope that was settled months earlier.

What to carry forward
The single practice both sides credited was a named decision-owner per open question,
recorded in the notes with the question. Nothing sat in "someone should decide this".

What did not work
GMS Core enablement was estimated from a previous programme and was optimistic by about
three weeks. The estimate was wrong; the handling of it was good — it was raised the week
it became apparent rather than at the deadline.

Note for the portfolio
Hyundai is the reference for how a partner relationship should run here. Where other
programmes are stalling, the difference is almost never engineering capability; it is
whether someone with authority is in the room.`,
      },
    ],
  },
  {
    key: 'chat-bosch-handover-gap',
    url: 'https://chat.google.com/room/bosch-vhal-integration/handover',
    kind: 'chat',
    title: 'Bosch VHAL — Dieter out six weeks, no handover',
    addedBy: 'clara@google.com',
    anchor: { program: 'Ford Explorer VHAL Integration (Bosch)', partner: 'Bosch', phase: 'Vehicle sensors & VHAL' },
    mode: 'watched',
    modeSource: 'user',
    revisions: [
      {
        daysAgo: 15,
        text: `#bosch-vhal-integration

Clara Operations: Dieter, confirming — you are out from Monday for six weeks?

Dieter Meyer: correct. Back at the start of the next quarter.

Clara Operations: who is covering the VHAL integration while you are out?

Dieter Meyer: formally, my team lead. In practice nobody has the context. The CAN
telemetry calibration work in particular is not written down anywhere — it is in my head
and in a spreadsheet on my machine that I have not shared.

Clara Operations: that is a problem. That work is on the critical path for two
programmes, not one — Ford Explorer and, indirectly, the Evos build that depends on the
same calibration approach.

Dieter Meyer: I agree it is a problem. I have three days left and a release to close. I
can write down either the calibration procedure or the open frame-drop investigation,
realistically not both.

Clara Operations: write down the calibration procedure. The frame-drop investigation has
a bug with the history in it; the calibration knowledge has no other home.

Dieter Meyer: agreed. Will do that Thursday.`,
      },
    ],
  },
];

// ---------------------------------------------------------------------------------
// 3. Risk signals that live on no timeline — things that will hurt a programme and that
//    no phase, date or buffer anywhere in the app would ever surface.
// ---------------------------------------------------------------------------------

const RISK_SOURCES: MockSource[] = [
  {
    key: 'web-ccc-conformance-bulletin',
    url: 'https://carconnectivity.org/bulletins/dk-conformance-r3-2',
    kind: 'web',
    title: 'CCC bulletin — Digital Key conformance revision 3.2',
    addedBy: 'alice@google.com',
    anchor: { partner: 'Google LLC' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 44,
        text: `Car Connectivity Consortium — Technical Bulletin (DRAFT FOR COMMENT)
Digital Key conformance, revision 3.2

Proposed change to section 7.4, attestation of the secure element provisioning chain.
Revision 3.1 permits provisioning attestation to be asserted by the vehicle manufacturer.
Revision 3.2 as drafted would require the attestation to be produced by the secure
element vendor directly and countersigned.

Status: draft, open for member comment for 30 days. Not yet binding.

Implementation note: implementations certified against 3.1 would remain valid until their
next recertification, at which point 3.2 would apply.`,
      },
      {
        daysAgo: 12,
        text: `Car Connectivity Consortium — Technical Bulletin (RATIFIED)
Digital Key conformance, revision 3.2

Section 7.4, attestation of the secure element provisioning chain, is amended as drafted.
Provisioning attestation MUST be produced by the secure element vendor directly and
countersigned. Manufacturer-asserted attestation is no longer accepted.

Status: RATIFIED. Binding for any certification submission dated more than 90 days from
publication.

Change from the draft: the transition allowance has been shortened. The draft indicated
that 3.1 certifications would stand until next recertification. The ratified text applies
3.2 to any SUBMISSION after the 90-day mark, regardless of when the implementation was
designed. Programmes currently building against 3.1 and expecting to submit after that
date are affected and will need vendor-produced attestation.

Members are advised to confirm with their secure element vendor that countersigned
attestation is available, as not all vendors currently produce it.`,
      },
    ],
  },
  {
    key: 'doc-continental-quality-escape',
    url: 'https://docs.google.com/document/d/continental-cluster-solder-escape',
    kind: 'drive',
    title: 'Continental — cluster board quality escape, lots 44xx',
    addedBy: 'lena@continental.example',
    anchor: { partner: 'Continental' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 23,
        text: `Continental — supplier quality notification
Cluster compute boards, lots 4401 through 4438

Summary
A solder process deviation on one reflow line has been confirmed. Affected boards show
intermittent open joints on the display connector under thermal cycling. The failure does
not present at room temperature and passed end-of-line test, which is why it escaped.

Scope
Approximately 1,900 boards shipped. Of those, roughly 400 went into development and
validation fleets; the remainder are in supplier inventory and have been quarantined.

Field risk
Boards already in validation fleets are the concern. A vehicle that passes validation on
an affected board may show display dropouts in cold-weather testing that will be
attributed to software. We expect at least some existing "intermittent display" reports
to be this, not a driver defect.

Action requested
Programmes using these boards should identify affected units by lot before continuing
cold-weather validation, so that failures are not misattributed. Lot numbers are on the
board silkscreen; there is no software-readable identifier, which makes this tedious.

Programmes known to be using boards from this window: the Volvo refresh fleet and at
least one Stellantis reference unit. There may be others we are not aware of.`,
      },
    ],
  },
  {
    key: 'gerrit-bsp-bootloader-unlocked',
    url: 'https://android-review.googlesource.com/c/platform/bootable/+/100277',
    kind: 'tracker',
    title: 'ag/100277 — BSP: debug bootloader left unlocked in release config',
    addedBy: 'marcusw@google.com',
    anchor: { program: 'GM Ultifi AAOS Migration', phase: 'Compute Board Bring-up' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 30,
        text: `Change 100277 — Status: Review in progress
bsp: enable verbose boot diagnostics for bring-up

Adds verbose boot logging and enables the debug unlock path so the bring-up team can
attach before the kernel hands off.

Reviewer comment (marcusw@): this is fine for bring-up but the change touches the RELEASE
config, not just the eng config. As written, a release build produced from this branch
ships with the bootloader unlock path enabled. That is not a bring-up convenience, that
is a shipped device that can be re-flashed by anyone with physical access.

Reviewer comment (marcusw@): please split — diagnostics in the eng config, nothing in
release. Blocking until that is done.

Author reply: understood, will split.`,
      },
      {
        daysAgo: 6,
        text: `Change 100277 — Status: Abandoned
bsp: enable verbose boot diagnostics for bring-up

Abandoned in favour of ag/100412, which puts the diagnostics in the eng config only and
leaves the release config untouched.

Reviewer comment (marcusw@): confirming the replacement is correct — release config is
unchanged, unlock path is not enabled in release builds. Recording here for the audit
trail that the original version WOULD have shipped an unlocked bootloader, and that it
was caught in review rather than by a process gate. There is no automated check that
would have caught it; the next one may not get a reviewer who reads config diffs.`,
      },
    ],
  },
  {
    key: 'chat-cert-capacity-squeeze',
    url: 'https://chat.google.com/room/gas-cert-coordination/capacity',
    kind: 'chat',
    title: 'GAS cert coordination — "everything routes through Priya"',
    addedBy: 'marcusw@google.com',
    anchor: { partner: 'Google LLC' },
    mode: 'watched',
    modeSource: 'user',
    revisions: [
      {
        daysAgo: 21,
        text: `#gas-cert-coordination

Marcus Webb: Doing a sanity check across the certification windows and I do not like what
I am seeing. Priya is named on the certification phase for Hyundai, Stellantis, the
Polaris Digital Key programme and Nova Compact. Four programmes.

Priya Sharma: that is accurate. Three of those are sequential on paper so it has been
manageable.

Marcus Webb: on paper. If any one of them slips right, they stop being sequential.

Priya Sharma: yes. And the Stellantis one is the most likely to slip, because it is
gated on a decision that has been open for four reviews.

Marcus Webb: so the risk is not "Priya is busy". The risk is that a decision nobody is
tracking as a schedule item, on a programme that reports as healthy, is what determines
whether four certifications collide.

Priya Sharma: that is a fair statement of it. I would add that I am the only person here
who has taken a GAS submission through end to end. If I am the constraint, there is no
second person to hand it to — that is the actual problem, and it is a hiring problem,
not a scheduling one.

Marcus Webb: agreed. Writing that up for the portfolio review. I do not expect it to be
solvable this quarter.`,
      },
    ],
  },
  {
    key: 'doc-mediatek-allocation',
    url: 'https://docs.google.com/document/d/mediatek-dimensity-auto-allocation',
    kind: 'drive',
    title: 'MediaTek — Dimensity Auto allocation outlook',
    addedBy: 'deepak@mediatek.example',
    anchor: { partner: 'MediaTek' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 35,
        text: `MediaTek Dimensity Auto — allocation outlook shared with Google

Current position
Allocation for the current programme set is committed and unchanged.

Next window
Demand from outside automotive has increased on the same process node. Our automotive
allocation is protected contractually for committed volumes, but incremental volume above
committed levels is not guaranteed and lead times for it have moved from 16 to 26 weeks.

What this means for programme planning
Any programme intending to increase first-year volume beyond what was committed at design
win should assume the increase is not available inside 26 weeks. Programmes at or below
committed volume are unaffected.

Deepak's note
Flagging this early rather than at the point of request. The programmes most likely to be
caught are the ones whose first-year volume forecast has grown since design win — the
forecast changing is not itself a signal anyone tracks, so this tends to surface only
when the order is placed and rejected.`,
      },
    ],
  },
];

// ---------------------------------------------------------------------------------
// 4. Ordinary programme traffic. The corpus needs a floor of unremarkable material,
//    or every single document is a finding and "notable" stops meaning anything.
// ---------------------------------------------------------------------------------

const ROUTINE_SOURCES: MockSource[] = [
  {
    key: 'doc-ford-evos-arch-review',
    url: 'https://docs.google.com/document/d/ford-evos-architecture-review',
    kind: 'drive',
    title: 'Ford Evos — architecture review record',
    addedBy: 'bob@google.com',
    anchor: { program: 'Ford Evos AAOS Bring-up', phase: 'Architecture lock' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 58,
        text: `Ford Evos AAOS — architecture review record

Decisions taken
Cockpit compute is the Snapdragon SA8295P. Cluster rendering stays on the dedicated
safety domain rather than moving into the AAOS domain; this was debated and closed.
Hypervisor is the partner-supplied option, not the alternative evaluated in the
pre-study.

Open items closed at this review
Display topology, audio routing topology, and the boundary between vehicle HAL and the
body controller are all settled and documented in the linked specifications.

Items intentionally left open
Over-the-air update partitioning, pending a decision on the service model that is not an
engineering decision and sits with Ford's connected services organisation.

Attendance
Full attendance from both sides including decision-makers. All decisions above were taken
in the room.`,
      },
    ],
  },
  {
    key: 'chat-toyota-nfc-progress',
    url: 'https://chat.google.com/room/toyota-highlander-dk/nfc-bringup',
    kind: 'chat',
    title: 'Toyota Highlander DK — NFC driver bring-up going well',
    addedBy: 'alice@google.com',
    anchor: { program: 'Toyota Highlander Digital Key', phase: 'NFC Driver bring-up' },
    mode: 'snapshot',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 26,
        text: `#toyota-highlander-dk

Alice PM: NFC driver bring-up is done and passed the internal antenna characterisation
on the e-TNGA chassis. Nothing dramatic to report, which is the good outcome.

Kenji Sato: agreed. The antenna placement work we did in the pre-study paid off — no
surprises at bring-up, which is not usually how this goes.

Alice PM: moving to secure element configuration next. Kenji, your team is reviewing the
key exchange protocol document this week?

Kenji Sato: yes, review is scheduled. I do not expect issues but I would rather find them
in review than in conformance.

Alice PM: exactly right. Thanks.`,
      },
    ],
  },
  {
    key: 'bug-bosch-can-frame-drops',
    url: 'https://buganizer.corp.google.com/issues/9987211',
    kind: 'tracker',
    title: 'b/9987211 — CAN telemetry frame drops during ADAS calibration',
    addedBy: 'clara@google.com',
    anchor: { program: 'Ford Explorer VHAL Integration (Bosch)', phase: 'Vehicle sensors & VHAL' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 49,
        text: `Status: Open · Priority: P2 · Component: Automotive > Vehicle HAL

Telemetry frames are dropped when ADAS sensor calibration runs during an active ignition
sequence. Outside that overlap the telemetry path is clean.

Dieter Meyer: our reading is that calibration saturates the bus for a short window and
the telemetry publisher has no backpressure handling, so it drops rather than queues.

Proposed approach: add bounded queueing on the publisher, and separately look at whether
calibration needs to run during ignition at all.

Assigned: Dieter Meyer.`,
      },
      {
        daysAgo: 14,
        text: `Status: Open (unassigned) · Priority: P2 · Component: Automotive > Vehicle HAL

Telemetry frames are dropped when ADAS sensor calibration runs during an active ignition
sequence.

Dieter Meyer: bounded queueing on the publisher is implemented and reduces the drop rate
by about 80% but does not eliminate it. The remaining drops happen when calibration and
ignition overlap for longer than the queue depth covers.

The real fix is to not run calibration during ignition, which is a sequencing change in
the calibration scheduler and is not my component.

UNASSIGNING — I am out for six weeks from Monday. The queueing change is merged. The
sequencing change has no owner. Please do not read the 80% improvement as this being
nearly done; the remaining 20% needs a different team and has not been raised with them.`,
      },
    ],
  },
  {
    key: 'doc-gm-ultifi-platform-sync',
    url: 'https://docs.google.com/document/d/gm-ultifi-platform-sync-notes',
    kind: 'drive',
    title: 'GM Ultifi — platform sync notes',
    addedBy: 'marcusw@google.com',
    anchor: { program: 'GM Ultifi AAOS Migration', partner: 'GM' },
    mode: 'watched',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 18,
        text: `GM Ultifi platform sync — notes

Compute board bring-up
Progressing to plan. LG's head unit samples arrived on schedule and the first boot was
achieved the same week, which is ahead of where the previous generation was.

App platform port
Not started, dependent on bring-up completing. No concerns raised.

Carlos's note on scope
GM would like to add a second display variant to the programme. Carlos was explicit that
this is a request, not a commitment, and that he expects it to be assessed on schedule
impact before anyone agrees to it. Recording it here so it does not become an assumed
scope item.

Marcus's note
Worth saying that this is how scope requests should arrive. Compare with programmes where
scope grows without anyone naming it as a change.`,
      },
    ],
  },
  {
    key: 'chat-denso-honda-delivery',
    url: 'https://chat.google.com/room/honda-accord-cockpit/denso-delivery',
    kind: 'chat',
    title: 'Honda Accord — Denso delivery cadence',
    addedBy: 'marcusw@google.com',
    anchor: { program: 'Honda Accord AAOS Bring-up', partner: 'Denso' },
    mode: 'snapshot',
    modeSource: 'inferred',
    revisions: [
      {
        daysAgo: 29,
        text: `#honda-accord-cockpit

Marcus Webb: Denso delivered the HAL integration drop on the committed date, complete and
tested to the agreed scope.

Aiko Tanaka: as always. They have not missed a date on this programme.

Marcus Webb: no complaints at all on delivery. My only observation is that we get exactly
what is in the statement of work — if something is adjacent to their scope and obviously
broken, it comes back untouched with a note saying it was out of scope.

Aiko Tanaka: that is accurate and it is deliberate on their side. It means we have to be
more thorough about what we ask for than we would be with a partner who volunteers
findings.

Marcus Webb: agreed. Not a problem, just something to plan around.`,
      },
    ],
  },
];

/** The whole authored corpus, in the order the seed ingests it. */
export const MOCK_CORPUS: MockSource[] = [
  ...AUDIO_CLUSTER,
  ...RELATIONSHIP_SOURCES,
  ...RISK_SOURCES,
  ...ROUTINE_SOURCES,
];

export const MOCK_REF_PREFIX = 'mock:';

/** `sourceRef` for a corpus entry — the identity the connector reads revisions back by. */
export const mockSourceRef = (key: string): string => `${MOCK_REF_PREFIX}${key}`;

/**
 * `sourceVersion` for revision n. The version string IS the fixture cursor: the row
 * records which authored revision it currently holds, so the connector can serve the
 * next one without any extra state. Same role a Drive version or an ETag plays for a
 * real connector, which is why it rides the existing column.
 */
export const mockVersion = (index: number): string => `v${index}`;

/** The revision index a `sourceVersion` refers to; 0 for anything unparseable. */
export function mockVersionIndex(sourceVersion: string | null | undefined): number {
  const m = /^v(\d+)$/.exec(sourceVersion ?? '');
  return m ? Number(m[1]) : 0;
}

const BY_REF = new Map(MOCK_CORPUS.map((s) => [mockSourceRef(s.key), s]));

export function mockSourceByRef(sourceRef: string | null | undefined): MockSource | null {
  return (sourceRef && BY_REF.get(sourceRef)) || null;
}
