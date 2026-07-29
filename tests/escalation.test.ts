/** @jest-environment node */
// The escalation domain module (#245): what "closed" means, which status change is legal,
// and how the two triage scales order. Pure — no database, no env.
//
// Each block below pins a decision that has a WRONG obvious alternative, because those are
// the ones a later edit will re-derive incorrectly: closed-means-not-open (rather than a
// four-way comparison somebody has to keep in step), terminal→terminal refused (rather than
// allowed as a harmless re-label), and untriaged sorting LAST (rather than first, which is
// what `null` does by default in most orderings).

import {
  ESCALATION_STATUSES,
  ORG_LEVELS,
  ORG_LEVEL_KEY,
  SEVERITIES,
  SEVERITY_KEY,
  STATUS_DISPLAY_KEY,
  STATUS_KEY,
  TERMINAL_STATUSES,
  UNTRIAGED,
  canTransition,
  isClosed,
  isOpen,
  orgLevelRank,
  severityRank,
  severityToken,
  orgLevelToken,
  type EscalationStatus,
} from '../src/lib/escalation';
import { t } from '../src/lib/i18n';

describe('open vs closed', () => {
  it('treats every terminal state as closed and only `open` as open', () => {
    expect(isOpen('open')).toBe(true);
    expect(isClosed('open')).toBe(false);
    for (const s of TERMINAL_STATUSES) {
      expect(isClosed(s)).toBe(true);
      expect(isOpen(s)).toBe(false);
    }
  });

  it('derives the terminal set from the full list, so a new status cannot miss it', () => {
    // The property, not the literal: TERMINAL_STATUSES is every status except `open`.
    expect(TERMINAL_STATUSES).toEqual(ESCALATION_STATUSES.filter((s) => s !== 'open'));
    expect(TERMINAL_STATUSES).toHaveLength(ESCALATION_STATUSES.length - 1);
  });
});

describe('legal status transitions', () => {
  it('lets an open escalation close as any terminal state', () => {
    for (const s of TERMINAL_STATUSES) expect(canTransition('open', s)).toBe(true);
  });

  it('lets any closed escalation be re-opened', () => {
    for (const s of TERMINAL_STATUSES) expect(canTransition(s, 'open')).toBe(true);
  });

  it('refuses to re-classify a closed escalation in place', () => {
    // resolved → obsolete would silently rewrite the record of HOW it ended. Re-open it
    // and close it again, which leaves both facts true, in order.
    expect(canTransition('resolved', 'obsolete')).toBe(false);
    expect(canTransition('duplicate', 'addressed')).toBe(false);
    for (const from of TERMINAL_STATUSES) {
      for (const to of TERMINAL_STATUSES) {
        if (from !== to) expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('refuses a no-op, so a double-submitted form cannot re-stamp closedAt', () => {
    for (const s of ESCALATION_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
});

describe('triage ordering', () => {
  it('ranks severity worst-first', () => {
    expect(severityRank('s1')).toBeLessThan(severityRank('s2'));
    expect(severityRank('s2')).toBeLessThan(severityRank('s3'));
  });

  it('ranks org level highest-first — who must act, not how bad it is', () => {
    expect(orgLevelRank('exec')).toBeLessThan(orgLevelRank('director'));
    expect(orgLevelRank('director')).toBeLessThan(orgLevelRank('region'));
    expect(orgLevelRank('region')).toBeLessThan(orgLevelRank('team'));
  });

  it('sorts UNTRIAGED after every triaged value, on both scales', () => {
    // The point of the whole ranking: null is "nobody has judged this yet", not "least
    // severe", so it must not float to the top of a list ordered by urgency.
    for (const s of SEVERITIES) expect(severityRank(null)).toBeGreaterThan(severityRank(s));
    for (const o of ORG_LEVELS) expect(orgLevelRank(null)).toBeGreaterThan(orgLevelRank(o));
    expect(severityRank(undefined)).toBe(severityRank(null));
    expect(orgLevelRank(undefined)).toBe(orgLevelRank(null));
  });

  it('gives an untriaged value a filter token that survives a URL round-trip', () => {
    // '' would be indistinguishable from "no filter applied" once it is a query param.
    expect(severityToken(null)).toBe(UNTRIAGED);
    expect(orgLevelToken(null)).toBe(UNTRIAGED);
    expect(UNTRIAGED).not.toBe('');
    expect(severityToken('s1')).toBe('s1');
    expect(orgLevelToken('exec')).toBe('exec');
  });
});

describe('display keys', () => {
  it('has a key for every value on all three scales', () => {
    for (const s of ESCALATION_STATUSES) {
      expect(STATUS_KEY[s]).toBeDefined();
      expect(STATUS_DISPLAY_KEY[s]).toBeDefined();
    }
    for (const s of SEVERITIES) expect(SEVERITY_KEY[s]).toBeDefined();
    for (const o of ORG_LEVELS) expect(ORG_LEVEL_KEY[o]).toBeDefined();
  });

  it('reads a terminal state as CLOSED, in every locale', () => {
    // "Addressed" alone does not say the escalation is over, which is the whole reason
    // STATUS_DISPLAY_KEY exists beside STATUS_KEY. Asserted per locale because the two
    // halves live in the catalog entry — a translator who dropped the qualifier would
    // otherwise ship a status that reads as still-live.
    for (const locale of ['en', 'de', 'ja', 'ko'] as const) {
      for (const s of TERMINAL_STATUSES) {
        const bare = t(locale, STATUS_KEY[s]);
        const display = t(locale, STATUS_DISPLAY_KEY[s]);
        expect(display).not.toBe(bare);
        expect(display.length).toBeGreaterThan(bare.length);
      }
      // `open` is the one status whose two keys are deliberately the same string.
      expect(t(locale, STATUS_DISPLAY_KEY['open' as EscalationStatus]))
        .toBe(t(locale, STATUS_KEY['open' as EscalationStatus]));
    }
  });
});
