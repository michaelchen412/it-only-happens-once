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

// ── "More on x · y →" ───────────────────────────────────────────────────────
//
// The strip's last row links to the feed's subject filter, which STACKS (AND).
// ⚠ For 57 of 131 published fragments — 44% — that combination is unique, so
// the link landed on a page holding exactly one thing: the piece you were just
// reading. Michael, 2026-08-10: *"can it not say 'more on tag x tag x tag' if
// there isnt actually any other posts with that combo? … often times the exact
// combination of tags results in only one result — the exact thing we were just
// reading."*
//
// THIRD INSTANCE OF ONE SHAPE, which is why it is worth a named test rather than
// a conditional: the author door (`others > 0`), "Appears in" minus the
// constellation you are standing in, and this. A door back to where you already
// are is not a door — and each one read as a feature until its count was checked.
describe('the whole-signature count', () => {
  /** What `getQuoteNeighbourhoods` computes: rows carrying EVERY subject. */
  const whole = (rows: { fragment_id: string }[], selfId: string, subjectCount: number) => {
    const tally = new Map<string, number>();
    for (const r of rows) if (r.fragment_id !== selfId) tally.set(r.fragment_id, (tally.get(r.fragment_id) ?? 0) + 1);
    return [...tally.values()].filter((n) => n === subjectCount).length;
  };

  it('is ZERO when nobody else carries the whole combination', () => {
    // `partial` shares two of three subjects — it is kin, and it is NOT what
    // `?subject=a,b,c` returns. The link must not render.
    expect(whole(rows([['partial', 2]]), 'self', 3)).toBe(0);
  });

  it('counts only fragments carrying EVERY subject, not the most', () => {
    expect(
      whole(
        rows([
          ['all', 3],
          ['most', 2],
          ['one', 1],
        ]),
        'self',
        3,
      ),
    ).toBe(1);
  });

  it('never counts the fragment being read — it is always its own perfect match', () => {
    // Without the guard this is 1 for everything, and the link never hides.
    expect(whole(rows([['self', 3]]), 'self', 3)).toBe(0);
  });

  it('a single-subject fragment still needs someone else to share it', () => {
    expect(whole(rows([['other', 1]]), 'self', 1)).toBe(1);
    expect(whole(rows([['self', 1]]), 'self', 1)).toBe(0);
  });
});
