// The model-output parsers must survive whatever a blocked/empty/truncated Gemini
// response yields: '' , partial JSON, wrong types. A bad response may fail a single
// refresh loudly (digest) or degrade to an honest empty state (summary/classify) —
// it must never crash a pipeline with a TypeError deep in digestToText.
import {
  parseDocDigest,
  parseClassification,
  parseRawSummary,
} from '../src/lib/geminiSchemas';

describe('parseDocDigest', () => {
  it('fills missing arrays and coerces a bad sourceStatus', () => {
    const d = parseDocDigest(JSON.stringify({ summary: 'S', sourceStatus: 'weird' }));
    expect(d.summary).toBe('S');
    expect(d.keyTopics).toEqual([]);
    expect(d.entities).toEqual({ partners: [], programs: [], people: [] });
    expect(d.sourceStatus).toBe('not-applicable');
  });

  it('keeps a well-formed digest intact, including the delta', () => {
    const d = parseDocDigest(
      JSON.stringify({
        summary: 'S',
        keyTopics: ['a'],
        decisions: ['b'],
        openQuestions: [],
        entities: { partners: ['P'], programs: [], people: [] },
        sourceStatus: 'resolved',
        delta: 'new thing',
      }),
    );
    expect(d.keyTopics).toEqual(['a']);
    expect(d.sourceStatus).toBe('resolved');
    expect(d.delta).toBe('new thing');
  });

  it('throws (rather than fabricating an empty digest) when there is no summary', () => {
    expect(() => parseDocDigest('')).toThrow(/digest/i);
    expect(() => parseDocDigest('{}')).toThrow(/digest/i);
    expect(() => parseDocDigest('not json at all')).toThrow(/digest/i);
    expect(() => parseDocDigest(JSON.stringify({ summary: '   ' }))).toThrow(/digest/i);
  });
});

describe('parseClassification', () => {
  it('degrades to none on garbage', () => {
    expect(parseClassification('')).toEqual({ kind: 'none', id: null, name: null, confidence: 0 });
    expect(parseClassification('nope')).toEqual({ kind: 'none', id: null, name: null, confidence: 0 });
    expect(parseClassification(JSON.stringify({ kind: 'sandwich', id: 3 }))).toMatchObject({ kind: 'none' });
  });

  it('passes a valid classification through', () => {
    expect(parseClassification(JSON.stringify({ kind: 'project', id: 7, name: 'X', confidence: 0.9 })))
      .toEqual({ kind: 'project', id: 7, name: 'X', confidence: 0.9 });
  });
});

describe('parseRawSummary', () => {
  it('returns null on garbage so callers render an honest empty state', () => {
    expect(parseRawSummary('')).toBeNull();
    expect(parseRawSummary('null')).toBeNull();
    expect(parseRawSummary('broken{')).toBeNull();
    expect(parseRawSummary(JSON.stringify({ tldr: 42 }))).toBeNull();
  });

  it('drops malformed bullets but keeps the rest', () => {
    const s = parseRawSummary(
      JSON.stringify({
        tldr: 'ok',
        progress: [{ text: 'p', evidence: [1] }, { nope: true }],
        risks: 'not-an-array',
        themes: [],
        actions: [{ text: 'a', evidence: 'x' }],
      }),
    );
    expect(s).not.toBeNull();
    expect(s!.tldr).toBe('ok');
    expect(s!.progress).toEqual([{ text: 'p', evidence: [1] }]);
    expect(s!.risks).toEqual([]);
    expect(s!.actions).toEqual([{ text: 'a', evidence: [] }]);
  });
});
