/** @jest-environment node */
// A reference to ONE recorded update carries a fragment that opens its log AT that
// update. Partner health got this in #111; program status and phase progress did not, so
// every briefing citation and feed row for a status change wrote the same
// `/programs/:id#status-history` — the reader clicked the receipt under a bullet about
// the May 1 update and had to find it again in a log of near-identical cards
// (autoknow-51j).
//
// Three families, one shape, so a reader who knows one can guess the others and no two
// can match each other's target. These are the pure halves; the popovers' own behaviour
// (opening, highlighting, scrolling) is exercised in the e2e suite.
import {
  STATUS_HISTORY_HASH, statusUpdateHash, parseStatusUpdateHash, isStatusHash,
} from '../src/lib/needle';
import {
  phaseHash, phaseProgressHash, phaseUpdateHash, parsePhaseHash,
  parsePhaseProgressHash, parsePhaseUpdateHash, parsePhaseProgressTarget,
  phaseProgressHref, phaseUpdateHref,
} from '../src/lib/phase';
import { programStatusUpdateHref } from '../src/lib/entityHref';
import { relUpdateHash } from '../src/lib/relationship';

describe('program-status deep-link fragments', () => {
  test('the log and one update share a prefix but never match each other', () => {
    expect(STATUS_HISTORY_HASH).toBe('status-history');
    expect(statusUpdateHash(42)).toBe('status-update-42');
    expect(parseStatusUpdateHash(`#${STATUS_HISTORY_HASH}`)).toBeNull();
  });

  test('parseStatusUpdateHash reads the id with or without the #, and rejects junk', () => {
    expect(parseStatusUpdateHash('#status-update-7')).toBe(7);
    expect(parseStatusUpdateHash('status-update-7')).toBe(7);
    expect(parseStatusUpdateHash('#status-update-')).toBeNull();
    expect(parseStatusUpdateHash('#status-update-abc')).toBeNull();
    expect(parseStatusUpdateHash('#status-history')).toBeNull();
    // Must not swallow a neighbouring section anchor on the same page.
    expect(parseStatusUpdateHash('#activity')).toBeNull();
  });

  test('isStatusHash recognizes both members and nothing else', () => {
    expect(isStatusHash('#status-history')).toBe(true);
    expect(isStatusHash('#status-update-3')).toBe(true);
    expect(isStatusHash('status-history')).toBe(true);
    expect(isStatusHash('status-update-3')).toBe(true);
    expect(isStatusHash('#relationship-update-3')).toBe(false);
    expect(isStatusHash('#phase-3-detail')).toBe(false);
    expect(isStatusHash('')).toBe(false);
  });

  test('the href hangs the fragment off the one program route', () => {
    expect(programStatusUpdateHref(7, 42)).toBe('/programs/7#status-update-42');
  });
});

describe('phase-update deep-link fragments', () => {
  test('the log and one update within it share a prefix and stay distinct', () => {
    expect(phaseHash(218)).toBe('phase-218');
    expect(phaseProgressHash(218)).toBe('phase-218-progress');
    // An update lives IN the log, so addressing one EXTENDS the log's fragment rather
    // than claiming a fourth place (autoknow-51j).
    expect(phaseUpdateHash(218, 9041)).toBe('phase-218-progress-9041');
    // No parser may claim another member's fragment — that is the whole reason the
    // parsers anchor rather than prefix-match, and why `phaseProgressOpenedBy` exists.
    expect(parsePhaseHash('#phase-218-progress')).toBeNull();
    expect(parsePhaseHash('#phase-218-progress-9041')).toBeNull();
    expect(parsePhaseProgressHash('#phase-218-progress-9041')).toBeNull();
    expect(parsePhaseUpdateHash('#phase-218-progress')).toBeNull();
  });

  test('parsePhaseUpdateHash reads BOTH ids, with or without the #', () => {
    expect(parsePhaseUpdateHash('#phase-218-progress-9041')).toEqual({ phaseId: 218, stateId: 9041 });
    expect(parsePhaseUpdateHash('phase-1-progress-2')).toEqual({ phaseId: 1, stateId: 2 });
    expect(parsePhaseUpdateHash('#phase-218-progress-')).toBeNull();
    expect(parsePhaseUpdateHash('#phase-abc-progress-1')).toBeNull();
    expect(parsePhaseUpdateHash('#phase-218')).toBeNull();
  });

  test('parsePhaseProgressTarget answers WHICH phase and WHICH update in one call', () => {
    // One call for both halves, so a caller can never handle `-progress` and forget the
    // addressed form — which is how a close would have left an addressed fragment in the
    // bar, and the next revalidate would have reopened the log.
    expect(parsePhaseProgressTarget('#phase-218-progress')).toEqual({ phaseId: 218, stateId: null });
    expect(parsePhaseProgressTarget('#phase-218-progress-9041')).toEqual({ phaseId: 218, stateId: 9041 });
    expect(parsePhaseProgressTarget('#phase-218')).toBeNull(); // the card, not its log
    expect(parsePhaseProgressTarget('#status-update-3')).toBeNull();
    expect(parsePhaseProgressTarget('')).toBeNull();
  });

  test('the hrefs hang both fragments off the one program route', () => {
    expect(phaseProgressHref(12, 218)).toBe('/programs/12#phase-218-progress');
    expect(phaseUpdateHref(12, 218, 9041)).toBe('/programs/12#phase-218-progress-9041');
  });
});

describe('the three families cannot collide', () => {
  test('no fragment is recognized by more than one family', () => {
    const fragments = [
      relUpdateHash(5),
      statusUpdateHash(5),
      phaseUpdateHash(5, 5),
      phaseProgressHash(5),
    ].map((h) => `#${h}`);
    for (const f of fragments) {
      const claims = [
        parseStatusUpdateHash(f) != null,
        parsePhaseProgressTarget(f) != null,
        /^#relationship-update-\d+$/.test(f),
      ].filter(Boolean).length;
      expect([f, claims]).toEqual([f, 1]);
    }
  });
});
