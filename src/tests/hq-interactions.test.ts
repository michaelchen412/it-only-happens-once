// The log's derivations (12 · Piece 2).
//
// Two things are worth asserting here, and both guard a claim the interface
// makes on every page:
//
//  · `since()` is the reason a compact date was rejected. A `M/D Ddd` carries
//    no year, so a contact two years old rendered as "7/20 Sat" and READ AS
//    LAST MONTH — found in the people lab, not in review. A duration cannot lie
//    that way, and these tests pin the boundaries where it changes register.
//  · `byLastContact` is §3's "information without accusation": people you are
//    actually in touch with float up and drift sinks on its own. The case that
//    matters most is the one with NO entries — new, not neglected.
import { describe, expect, it } from 'vitest';
import { KINDS, KIND_ICON, byLastContact, since, type LastContact } from '../lib/hq/interactions';

const TODAY = '2026-08-03';

describe('since', () => {
  it('says today and yesterday by name', () => {
    expect(since('2026-08-03', TODAY)).toBe('today');
    expect(since('2026-08-02', TODAY)).toBe('yesterday');
  });

  it('counts days up to three weeks', () => {
    expect(since('2026-07-31', TODAY)).toBe('3 days ago');
    expect(since('2026-07-15', TODAY)).toBe('19 days ago');
  });

  it('switches to weeks, then months, then years', () => {
    expect(since('2026-07-13', TODAY)).toBe('3 weeks ago');
    expect(since('2026-05-05', TODAY)).toBe('3 months ago');
    expect(since('2024-08-03', TODAY)).toBe('2 years ago');
  });

  // THE BUG THIS FORMAT EXISTS TO PREVENT. A compact `M/D Ddd` for a contact
  // two years old reads as three weeks ago, because it carries no year.
  it('never lets a two-year gap read as recent', () => {
    const old = since('2024-07-20', TODAY);
    expect(old).toContain('years ago');
    expect(old).not.toContain('/');
  });

  it('has a phrase for the awkward stretch just past a year', () => {
    // 14 months is neither "12 months" nor "1 year" without sounding wrong.
    expect(since('2025-06-03', TODAY)).toBe('over a year ago');
  });

  it('does not go backwards for a future date — it reads as today', () => {
    // The action refuses a future entry, so this is defence in depth: if one
    // ever exists, "today" is a better lie than "-3 days ago".
    expect(since('2026-09-01', TODAY)).toBe('today');
  });

  it('is not thrown off by a DST boundary', () => {
    expect(since('2026-03-07', '2026-03-09')).toBe('2 days ago');
    expect(since('2026-10-31', '2026-11-02')).toBe('2 days ago');
  });
});

describe('byLastContact', () => {
  const person = (id: string, name: string) => ({ id, display_name: name, sort_name: null });
  const map = (entries: [string, string][]) =>
    new Map<string, LastContact>(entries.map(([id, on]) => [id, { on, count: 1 }]));

  it('floats the most recent to the top', () => {
    const people = [person('a', 'Anwen'), person('b', 'Bram'), person('c', 'Cyrek')];
    const sorted = [...people].sort(
      byLastContact(
        map([
          ['a', '2026-01-01'],
          ['b', '2026-08-01'],
          ['c', '2026-05-01'],
        ]),
      ),
    );
    expect(sorted.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  // NEW, NOT NEGLECTED (§8). Somebody with no entries sorts LAST rather than
  // first: the top of a section is for people there is something to say about.
  // Sorting them first would also be the cold-start bug the provenance audit
  // caught, wearing a different hat.
  it('puts somebody with no entries last, not first', () => {
    const people = [person('new', 'Never logged'), person('old', 'Logged once')];
    const sorted = [...people].sort(byLastContact(map([['old', '2020-01-01']])));
    expect(sorted.map((p) => p.id)).toEqual(['old', 'new']);
  });

  it('falls back to the name when nobody has been logged, so the order is stable', () => {
    const people = [person('c', 'Cyrek'), person('a', 'Anwen'), person('b', 'Bram')];
    const sorted = [...people].sort(byLastContact(new Map()));
    expect(sorted.map((p) => p.display_name)).toEqual(['Anwen', 'Bram', 'Cyrek']);
  });

  it('prefers sort_name in that fallback, as the roster does elsewhere', () => {
    const mum = { id: 'm', display_name: 'Mum', sort_name: 'Abbott, Jane' };
    const arun = { id: 'a', display_name: 'Arun', sort_name: null };
    expect([arun, mum].sort(byLastContact(new Map())).map((p) => p.id)).toEqual(['m', 'a']);
  });
});

describe('the kind vocabulary', () => {
  it('offers exactly the six the enum has', () => {
    expect(KINDS.map((k) => k.key)).toEqual(['hangout', 'call', 'message', 'gift', 'shared', 'note']);
  });

  it('leads with hangout, because the first option should be the common one', () => {
    expect(KINDS[0].key).toBe('hangout');
  });

  // One glyph meaning two things is how a timeline stops being scannable — and
  // `ph:cake` already means a birthday on a person card.
  it('gives every kind its own mark, and none of them the birthday cake', () => {
    const icons = Object.values(KIND_ICON);
    expect(new Set(icons).size).toBe(icons.length);
    expect(icons).not.toContain('ph:cake');
  });
});
