// How "along the same lines" decides what counts as kin (plan 32 · §6).
//
// ⚠ THE THRESHOLD IS THE WHOLE TEST, and the number was measured rather than
// chosen. "Shares a subject" sounds like kinship and is not: on the bench, one
// quote's ≥1 set was **45 of the 179 published fragments** — a quarter of the
// site behind a control captioned "45 related lines". Subject sizes are wildly
// uneven (mean 14, largest 32) and that quote carried `detachment` (32) and
// `the practice` (20), so sharing one of them said almost nothing. At ≥2 the
// same quote returns 5.
//
// It only became visible once the LABEL stopped lying: the first build capped
// the candidate fetch at 12, so the trigger read "12 related lines" on every
// well-tagged quote — a number that was an artefact of the query. A count that
// is really a constant is worse than no count, because it is the one thing on
// the strip claiming to tell you whether pressing is worth it.
import { describe, it, expect } from 'vitest';
import { rankByOverlap, MIN_OVERLAP } from '../lib/quote-page';

const rows = (pairs: [string, number][]) =>
  pairs.flatMap(([id, n]) => Array.from({ length: n }, () => ({ fragment_id: id })));

describe('rankByOverlap', () => {
  it('DROPS a fragment that shares only one subject, when there are two to share', () => {
    // The 45-of-179 case. `weak` is what a "shares a subject" rule would have
    // put in front of a reader as kin.
    const out = rankByOverlap(
      rows([
        ['weak', 1],
        ['kin', 2],
      ]),
      'self',
      2,
    );
    expect(out).toEqual(['kin']);
  });

  it('falls back to one shared subject when the quote HAS only one', () => {
    // Demanding two would give these quotes no list at all rather than a weak
    // one — and 6 of 77 published quotes are in this case.
    expect(rankByOverlap(rows([['weak', 1]]), 'self', 1)).toEqual(['weak']);
  });

  it('ranks by how much is shared, most first', () => {
    const out = rankByOverlap(
      rows([
        ['two', 2],
        ['four', 4],
        ['three', 3],
      ]),
      'self',
      4,
    );
    expect(out).toEqual(['four', 'three', 'two']);
  });

  it('never includes the quote you are already reading', () => {
    // It shares every one of its own subjects, so it outranks everything.
    expect(
      rankByOverlap(
        rows([
          ['self', 3],
          ['kin', 2],
        ]),
        'self',
        3,
      ),
    ).toEqual(['kin']);
  });

  it('returns nothing rather than a weak list when nothing clears the bar', () => {
    expect(
      rankByOverlap(
        rows([
          ['a', 1],
          ['b', 1],
        ]),
        'self',
        3,
      ),
    ).toEqual([]);
  });

  it('pins the threshold itself, so a future edit has to mean it', () => {
    expect(MIN_OVERLAP).toBe(2);
  });
});
