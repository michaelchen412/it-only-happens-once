// The universal bar's kind vocabulary (docs/search.md §8).
//
// ⚠ WHAT THIS GUARDS IS A THIRTEENTH KIND, NOT THE TWELVE THAT EXIST. Adding a
// table to `searchEverything` means touching three things that live apart:
// `KindKey` (the union), `KINDS` (the label), and `moreHref` (where a capped
// group goes). TypeScript catches the first two — a `Record<KindKey, …>` will
// not compile with a member missing — and CANNOT catch the third, because
// `moreHref` ends in a `default:` branch that silently absorbs any new key and
// sends it to the Library.
//
// That is the failure this file exists for, and it is the shape the whole
// codebase keeps finding: not an error, just a link quietly pointing at the
// wrong room. `export-tables.test.ts` guards the same class of gap for the
// export's table list, and its comment is the precedent — the standing rule was
// a comment, the comment did not hold, and the test is what made it hold.
import { describe, expect, it } from 'vitest';
import { KINDS, ORDER, moreHref, type KindKey } from '../lib/search-all';

/**
 * Every kind, with the room a capped group must land in.
 *
 * ⚠ SPELLED OUT RATHER THAN DERIVED. Deriving it from `moreHref` would make the
 * test agree with the implementation by construction, which is the one thing a
 * test of a lookup table must not do.
 */
const EXPECTED: Record<KindKey, string> = {
  essay: '/admin/fragments',
  note: '/admin/notes',
  quote: '/admin/fragments',
  task: '/admin/agenda/tasks',
  goal: '/admin/agenda/goals',
  person: '/admin/people',
  constellation: '/admin/constellations',
  set: '/admin/sets',
  song: '/admin/sets',
  subject: '/admin/library',
  work: '/admin/library',
  author: '/admin/library',
};

describe('the kind vocabulary', () => {
  it('ORDER holds every kind exactly once', () => {
    expect(ORDER).toHaveLength(Object.keys(KINDS).length);
    expect(new Set(ORDER).size).toBe(ORDER.length);
    for (const k of Object.keys(KINDS) as KindKey[]) expect(ORDER).toContain(k);
  });

  it('every kind has a non-empty label', () => {
    for (const k of ORDER) expect(KINDS[k].label.trim()).not.toBe('');
  });

  // ⚠ THE ONE THAT CATCHES A NEW KIND. `moreHref`'s `default:` branch would send
  // an unlisted kind to /admin/library without complaint.
  it('every kind sends a capped group to its own room', () => {
    for (const k of ORDER) {
      expect(moreHref(k, 'x'), `${k} lands in the wrong room`).toContain(EXPECTED[k]);
    }
  });

  it('carries the term wherever the destination can receive one', () => {
    // The rooms with a search field of their own — §8e's middle column.
    expect(moreHref('essay', 'sea change')).toBe('/admin/fragments?type=writing&q=sea%20change');
    expect(moreHref('quote', 'sea change')).toBe('/admin/fragments?type=quote&q=sea%20change');
    expect(moreHref('note', 'sea change')).toBe('/admin/notes?q=sea%20change');
  });

  // ⚠ A TERM IS USER TEXT AND A HREF IS A URL. `&`, `#` and `?` in a search term
  // would otherwise start a second query param or a fragment — the same class of
  // bug `search-all.ts` escapes for PostgREST's `or`, one layer out.
  it('encodes a term that would otherwise break the URL', () => {
    const href = moreHref('note', 'a&b?c#d');
    expect(href).toBe('/admin/notes?q=a%26b%3Fc%23d');
    expect(new URL(href, 'https://x.test').searchParams.get('q')).toBe('a&b?c#d');
  });
});
