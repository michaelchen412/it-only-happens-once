// `view` decides which slice of the corpus the Fragment Manager shows. It's
// parsed from a query string, which means a typo or a refactor could silently
// widen it — and the failure is invisible (private rows quietly appear beside
// finished work) rather than loud.
//
// ⚠ THE `notes` VIEW IS GONE (2026-08-03, 14 · Piece 1) — brain dumps have
// their own room, and the manager holds drafts and published. The property
// these tests exist for did not go with it: `?view=notes` must now fall back to
// the working list, which excludes notes by construction, so the dead URL
// cannot show scratch beside pieces on its way out.
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

  it('recognises the one named view', () => {
    expect(view('view=trash')).toBe('trash');
  });

  it('falls back to the working list for anything unrecognised', () => {
    // The important direction: an unknown value must never widen the slice.
    // `view=notes` is in this list deliberately — it was a real view until
    // 14 · Piece 1, so the stale URL is the one most likely to arrive. The page
    // redirects it to /admin/notes before this runs; if that ever stops
    // happening, this is what keeps it from landing on a widened list.
    for (const bad of ['view=', 'view=notes', 'view=all', 'view=NOTES', 'view=note', 'view=everything', 'view=list']) {
      expect(view(bad)).toBe('list');
    }
  });

  it('treats a repeated view param by its first value, not the last', () => {
    // URLSearchParams.get returns the first — pinned so a swap to getAll()
    // couldn't let `?view=list&view=trash` through as trash.
    expect(view('view=list&view=trash')).toBe('list');
  });
});

describe('parseListParams — filters', () => {
  it('ignores a one-character search (it would match nearly everything)', () => {
    expect(parseListParams(new URLSearchParams('q=a')).searching).toBe(false);
    expect(parseListParams(new URLSearchParams('q=ab')).searching).toBe(true);
  });

  it('reports `filtered` so the empty state can tell "no matches" from "nothing yet"', () => {
    expect(parseListParams(new URLSearchParams('')).filtered).toBe(false);
    expect(parseListParams(new URLSearchParams('view=trash')).filtered).toBe(false);
    expect(parseListParams(new URLSearchParams('type=song')).filtered).toBe(true);
  });
});
