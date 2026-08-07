// `src/lib/constellation-colors.ts` — the sky's colour ramp and the slot a new
// constellation takes. Pure, and it had no unit test. Added 2026-08-07.
//
// ⚠ THIS FILE IS ONE CORNER OF A THREE-WAY SEAM the compiler cannot check: the
// slot list here, the `color` CHECK constraint in migration
// `constellation_color_slot`, and the `.cn-*` rules in src/styles/app.css. The
// database and the stylesheet cannot import from here, so the list's shape is
// pinned below — a slot silently added or renamed on this side would be
// accepted by validation and then have no colour to render.
import { describe, it, expect } from 'vitest';
import { COLOR_SLOTS, leastUsedSlot, type ColorSlot } from '../lib/constellation-colors';

describe('COLOR_SLOTS', () => {
  it('is the eight slots, hot → cool, in that order', () => {
    // The order is the ramp (stellar temperature, design.md §13), not an
    // arbitrary list — `leastUsedSlot` breaks ties by taking the hottest, so
    // reordering this changes which colour a new constellation gets.
    expect([...COLOR_SLOTS]).toEqual(['violet', 'ice', 'azure', 'gold', 'amber', 'sand', 'ember', 'rose']);
  });

  it('has no duplicates', () => {
    expect(new Set(COLOR_SLOTS).size).toBe(COLOR_SLOTS.length);
  });

  it('every slot is a bare css-safe token, since it becomes a .cn-* class', () => {
    for (const slot of COLOR_SLOTS) expect(slot).toMatch(/^[a-z]+$/);
  });
});

describe('leastUsedSlot', () => {
  it('takes the hottest slot when nothing is used yet', () => {
    expect(leastUsedSlot([])).toBe('violet');
  });

  it('takes the first UNUSED slot as the sky fills up', () => {
    expect(leastUsedSlot(['violet'])).toBe('ice');
    expect(leastUsedSlot(['violet', 'ice'])).toBe('azure');
    expect(leastUsedSlot(['violet', 'ice', 'azure', 'gold', 'amber', 'sand', 'ember'])).toBe('rose');
  });

  it('wraps to the least-used once every slot is taken, ties → hottest', () => {
    // The ninth constellation cannot have a fresh colour; it should double up
    // on the hottest rather than on whatever happens to be last.
    expect(leastUsedSlot([...COLOR_SLOTS])).toBe('violet');
    expect(leastUsedSlot([...COLOR_SLOTS, 'violet'])).toBe('ice');
  });

  it('genuinely counts uses rather than only checking presence', () => {
    const heavy: ColorSlot[] = ['violet', 'violet', 'violet', 'ice', 'ice', 'azure'];
    // gold is untouched, so it wins over all three of those.
    expect(leastUsedSlot(heavy)).toBe('gold');
  });

  it('ignores nulls, undefined and slots that are not in the ramp', () => {
    // Rows predating the constraint, or a hand-edited value. They must not
    // shift the count, and must not crash the composer.
    expect(leastUsedSlot([null, undefined, 'chartreuse', ''])).toBe('violet');
    expect(leastUsedSlot(['violet', null, 'not-a-slot'])).toBe('ice');
  });

  it('always returns a slot that is actually in the ramp', () => {
    for (const taken of [[], ['violet'], [...COLOR_SLOTS], [null, 'nonsense']]) {
      expect(COLOR_SLOTS).toContain(leastUsedSlot(taken as readonly (string | null)[]));
    }
  });
});
