import { describe, expect, it } from 'vitest';
import { indentFor, INDEX_INDENTS, resolveSet, setHref, type MusicSet } from '../lib/music-sets';

const SETS: MusicSet[] = [
  { slug: 'first', title: 'First', description: '', url: 'https://open.spotify.com/playlist/aaa' },
  { slug: 'second', title: 'Second', description: '', url: 'https://open.spotify.com/playlist/bbb' },
];

describe('resolveSet', () => {
  it('takes a slug that exists', () => {
    expect(resolveSet('second', SETS)).toBe('second');
  });

  /*
   * The room's rule, restated: an empty state has to EXPLAIN itself and a full
   * one demonstrates the mechanism. A column of sentences beside a blank pane
   * asks the reader to guess that pressing one does something — so no selection
   * opens the first set rather than none.
   */
  it('opens the first set when nothing is asked for', () => {
    expect(resolveSet(null, SETS)).toBe('first');
    expect(resolveSet('', SETS)).toBe('first');
  });

  // A shared link outlives a rename or a deletion; showing the page minus one
  // choice beats showing a blank, the same call `parseFeelings` makes.
  it('falls back to the first set for an unknown slug', () => {
    expect(resolveSet('deleted-last-week', SETS)).toBe('first');
  });

  it('survives an empty corpus', () => {
    expect(resolveSet('anything', [])).toBe('');
  });
});

describe('setHref', () => {
  it('adds the first param with ?', () => {
    expect(setHref('first', '/lab/sets')).toBe('/lab/sets?set=first');
  });

  // The bench's base already carries layout and height; a link that dropped
  // them would reset the arrangement under test on every press.
  it('joins onto a base that already has a query', () => {
    expect(setHref('second', '/lab/sets?layout=detail&h=600')).toBe('/lab/sets?layout=detail&h=600&set=second');
  });

  it('encodes a slug', () => {
    expect(setHref('a b', '/x')).toBe('/x?set=a%20b');
  });
});

describe('indentFor', () => {
  it('wraps past the end of the pattern', () => {
    expect(indentFor(0)).toBe(INDEX_INDENTS[0]);
    expect(indentFor(INDEX_INDENTS.length)).toBe(INDEX_INDENTS[0]);
    expect(indentFor(INDEX_INDENTS.length + 2)).toBe(INDEX_INDENTS[2]);
  });

  // Past ~8% a ragged left edge stops reading as composed and starts reading as
  // broken. This is the guard on that judgement, not on the exact numbers.
  it('keeps every indent inside the readable band', () => {
    for (const v of INDEX_INDENTS) {
      expect(Number(v.replace('%', ''))).toBeLessThanOrEqual(8);
    }
  });
});
