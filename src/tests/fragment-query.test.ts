// `view` decides which slice of the corpus the Fragment Manager shows, and one
// of those slices is the private notes tier. It's parsed from a query string,
// which means a typo or a refactor could silently widen it — and the failure is
// invisible (notes quietly appear beside finished work) rather than loud.
//
// parseListParams is pure, so this is cheap. The RLS half of the same property
// cannot be tested here at all: it needs the real anon key against live
// PostgREST (done by hand 2026-07-30; see docs/plans/09 Piece 2).
import { describe, it, expect } from 'vitest';
import { parseListParams } from '../lib/fragment-query';

const view = (qs: string) => parseListParams(new URLSearchParams(qs)).view;

describe('parseListParams — which slice of the corpus', () => {
  it('defaults to the working list', () => {
    expect(view('')).toBe('list');
    expect(view('type=writing&q=hello')).toBe('list');
  });

  it('recognises the two named views', () => {
    expect(view('view=notes')).toBe('notes');
    expect(view('view=trash')).toBe('trash');
  });

  it('falls back to the working list for anything unrecognised', () => {
    // The important direction: an unknown value must never widen the slice.
    for (const bad of ['view=', 'view=all', 'view=NOTES', 'view=note', 'view=everything', 'view=list']) {
      expect(view(bad)).toBe('list');
    }
  });

  it('treats a repeated view param by its first value, not the last', () => {
    // URLSearchParams.get returns the first — pinned so a swap to getAll()
    // couldn't let `?view=list&view=notes` through as notes.
    expect(view('view=list&view=notes')).toBe('list');
  });
});

describe('parseListParams — filters', () => {
  it('ignores a one-character search (it would match nearly everything)', () => {
    expect(parseListParams(new URLSearchParams('q=a')).searching).toBe(false);
    expect(parseListParams(new URLSearchParams('q=ab')).searching).toBe(true);
  });

  it('reports `filtered` so the empty state can tell "no matches" from "nothing yet"', () => {
    expect(parseListParams(new URLSearchParams('')).filtered).toBe(false);
    expect(parseListParams(new URLSearchParams('view=notes')).filtered).toBe(false);
    expect(parseListParams(new URLSearchParams('type=song')).filtered).toBe(true);
  });
});
