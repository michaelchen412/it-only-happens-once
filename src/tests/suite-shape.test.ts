// `src/lib/suite-shape.ts` — the composer's hint line (design.md §13).
// Pure, a leaf module by design, and it had no unit test. Added 2026-08-07.
//
// ⚠ THE POINT OF THIS FILE IS THAT TWO SURFACES CANNOT DISAGREE. The composer
// renders the hint on the server AND recomputes it in the browser when ✕ removes
// a row, so the thresholds exist once. These tests pin the boundaries exactly,
// because the drift this module exists to prevent would be SILENT — the badge
// simply ceasing to agree with the sentence beneath it.
//
// They also pin the contract that these are INSTRUMENTS, never police: an empty
// string means "nothing to say", which is the normal case.
import { describe, it, expect } from 'vitest';
import { suiteHints } from '../lib/suite-shape';

describe('suiteHints — size', () => {
  it('says nothing about an empty suite', () => {
    // A constellation you have just made is not "thin", it is new. Scolding it
    // on creation is the failure mode this branch exists to avoid.
    expect(suiteHints(0, 0).size).toBe('');
    expect(suiteHints(0, 5).size).toBe('');
  });

  it('calls fewer than five thin', () => {
    expect(suiteHints(1, 5).size).toMatch(/thin/);
    expect(suiteHints(4, 5).size).toMatch(/thin/);
  });

  it('says nothing across the comfortable middle', () => {
    for (const n of [5, 8, 12, 15]) expect(suiteHints(n, 5).size).toBe('');
  });

  it('calls more than fifteen heavy, and asks the useful question', () => {
    expect(suiteHints(16, 5).size).toMatch(/heavy/);
    expect(suiteHints(40, 5).size).toMatch(/two constellations fused/);
  });

  it('the boundaries are exactly 5 and 15, not 4 and 16', () => {
    // Written out because these four assertions are the whole contract between
    // the server render and the client recompute.
    expect(suiteHints(4, 5).size).not.toBe('');
    expect(suiteHints(5, 5).size).toBe('');
    expect(suiteHints(15, 5).size).toBe('');
    expect(suiteHints(16, 5).size).not.toBe('');
  });
});

describe('suiteHints — spread', () => {
  it('says nothing about an empty suite, whatever the spread', () => {
    expect(suiteHints(0, 0).spread).toBe('');
    expect(suiteHints(0, 1).spread).toBe('');
  });

  it('calls fewer than three subjects narrow', () => {
    expect(suiteHints(10, 1).spread).toMatch(/narrow/);
    expect(suiteHints(10, 2).spread).toMatch(/narrow/);
  });

  it('says nothing at three or more', () => {
    expect(suiteHints(10, 3).spread).toBe('');
    expect(suiteHints(10, 9).spread).toBe('');
  });
});

describe('the two hints are independent', () => {
  it('a thin suite can still be broad, and a heavy one narrow', () => {
    const thinBroad = suiteHints(2, 7);
    expect(thinBroad.size).toMatch(/thin/);
    expect(thinBroad.spread).toBe('');

    const heavyNarrow = suiteHints(20, 1);
    expect(heavyNarrow.size).toMatch(/heavy/);
    expect(heavyNarrow.spread).toMatch(/narrow/);
  });

  it('a well-shaped suite says nothing at all', () => {
    expect(suiteHints(9, 5)).toEqual({ size: '', spread: '' });
  });
});
