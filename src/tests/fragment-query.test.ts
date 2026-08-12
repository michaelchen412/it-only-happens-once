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
import { parseListParams, queryFragmentList } from '../lib/fragment-query';
import { FRAGMENT_TYPES } from '../lib/fragments-display';
import { fakeDb, type FakeDb } from './stubs/supabase';

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

  it('accepts each of the three kinds, and nothing else', () => {
    for (const t of FRAGMENT_TYPES) expect(parseListParams(new URLSearchParams(`type=${t}`)).type).toBe(t);
    expect(parseListParams(new URLSearchParams('type=note')).type).toBeNull();
  });
});

describe('parseListParams — the two picker scopes', () => {
  // ⚠ NEITHER IS A URL PARAM, AND THAT IS THE PROPERTY UNDER TEST (plan 39 · §2).
  // `placeable` and `pairable` are properties of the ROOM — a song cannot go in
  // a suite, a quote cannot be paired — and `fragments-panel.astro` sets them.
  // If either ever became readable from the query string, a crafted URL would
  // widen or narrow a picker in a way its own page never intended, and the
  // failure would be silent: a picker offering rows the action then refuses.
  it('never lets the URL set either scope', () => {
    for (const qs of ['placeable=1', 'pairable=1', 'placeable=true&pairable=true', 'mode=pair', 'mode=pick']) {
      const p = parseListParams(new URLSearchParams(qs));
      expect(p.placeable).toBe(false);
      expect(p.pairable).toBe(false);
    }
  });

  it('reads the song to mark pairings against, and defaults it to null', () => {
    expect(parseListParams(new URLSearchParams('')).pairedSong).toBeNull();
    expect(parseListParams(new URLSearchParams('song=  ')).pairedSong).toBeNull();
    expect(parseListParams(new URLSearchParams('song=abc-123')).pairedSong).toBe('abc-123');
  });
});

describe('queryFragmentList — what each picker is allowed to offer', () => {
  const params = (over: Partial<ReturnType<typeof parseListParams>> = {}) => ({
    ...parseListParams(new URLSearchParams('')),
    ...over,
  });
  /** The type predicates applied to the MAIN row query, in order. */
  const typeOps = (db: FakeDb) =>
    db
      .ops('fragments')
      .filter((o) => o.method === 'eq' || o.method === 'neq')
      .filter((o) => o.args[0] === 'type')
      .map((o) => `${o.method}:${o.args[1]}`);

  it('offers writing ONLY when pairing — a quote is something songs.pair refuses', async () => {
    const db = fakeDb({}, { record: true });
    await queryFragmentList(db.client, params({ pairable: true }));
    expect(typeOps(db)).toContain('eq:writing');
    expect(typeOps(db)).not.toContain('neq:song');
  });

  it('still only excludes songs when placing — a quote IS a suite stanza', async () => {
    const db = fakeDb({}, { record: true });
    await queryFragmentList(db.client, params({ placeable: true }));
    expect(typeOps(db)).toContain('neq:song');
    expect(typeOps(db)).not.toContain('eq:writing');
  });

  it('constrains neither in the manager', async () => {
    const db = fakeDb({}, { record: true });
    await queryFragmentList(db.client, params());
    expect(typeOps(db)).toEqual([]);
  });

  it('narrows to writing even if both scopes are somehow set', async () => {
    // Belt and braces on a state the partial cannot produce today. The failure
    // it guards is the widening one: pairable losing to placeable would put
    // quotes in the pair picker.
    const db = fakeDb({}, { record: true });
    await queryFragmentList(db.client, params({ placeable: true, pairable: true }));
    expect(typeOps(db)).toContain('eq:writing');
    expect(typeOps(db)).not.toContain('neq:song');
  });
});

describe('queryFragmentList — marking what is already paired', () => {
  const rows = [
    { id: 'w1', type: 'writing', status: 'draft', paired_song_id: 'song-a' },
    { id: 'w2', type: 'writing', status: 'draft', paired_song_id: 'song-b' },
    { id: 'w3', type: 'writing', status: 'published', paired_song_id: null },
  ];
  const params = (over: Record<string, unknown> = {}) => ({
    ...parseListParams(new URLSearchParams('')),
    ...over,
  });

  it('derives pairedIds from the rows it already has, with no extra query', async () => {
    // ⚠ THE ASYMMETRY WITH `placedIds` IS THE DATA MODEL, not an optimisation:
    // membership is a link table you must go and read, `paired_song_id` is a
    // column on the row. If this ever starts querying, the picker got slower
    // for nothing.
    const db = fakeDb({ fragments: { data: rows } }, { record: true });
    const data = await queryFragmentList(db.client, params({ pairable: true, pairedSong: 'song-a' }));
    expect([...data.pairedIds]).toEqual(['w1']);
    expect(db.ops('fragments').some((o) => o.method === 'eq' && o.args[0] === 'paired_song_id')).toBe(false);
  });

  it('names the OTHER song a pick would steal from, and not the target itself', async () => {
    const db = fakeDb({ fragments: { data: rows } }, { record: true });
    await queryFragmentList(db.client, params({ pairable: true, pairedSong: 'song-a' }));
    // Only song-b is looked up: w1 is ours (pairedIds says so) and w3 is free.
    const lookup = db.ops('fragments').find((o) => o.method === 'in');
    expect(lookup?.args).toEqual(['id', ['song-b']]);
  });

  it('asks nothing about other songs outside pair mode', async () => {
    const db = fakeDb({ fragments: { data: rows } }, { record: true });
    const data = await queryFragmentList(db.client, params());
    expect(data.songTitleById).toEqual({});
    expect(data.pairedIds.size).toBe(0);
  });
});

describe('FRAGMENT_TYPES', () => {
  // ⚠ THE ORDER IS LOAD-BEARING AND IT IS NOW `Object.keys`'s (plans/29 · §3).
  // Four hand-written copies of this list became one derived from `TYPE_META`,
  // which is the right trade — but it moves the toolbar's filter order into a
  // property of that object literal, where nothing else would notice it
  // changing. This is what notices.
  it('is the three kinds, in the order the manager offers them', () => {
    expect(FRAGMENT_TYPES).toEqual(['writing', 'quote', 'song']);
  });
});
