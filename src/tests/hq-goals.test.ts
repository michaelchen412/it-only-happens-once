// Goals (13 · Piece 2, §4a).
//
// ⚠ THE ONE FUNCTION HERE CARRIES THE WHOLE ARGUMENT FOR THE FEATURE, and it
// can fail in exactly the way the feature exists to prevent. §4a's claim is
// that a goal is more than a folder because it answers "am I actually spending
// time on what I said mattered?" — an OBSERVATION, never a score.
//
// Two ways that turns into the thing it must not be:
//
//  · THE COLD START. A goal written this morning has no completed tasks, so the
//    naive version greets it with "nothing in 6 weeks" — false, and an
//    accusation on the one surface that may never carry one. It is the same bug
//    the people lab found in drift, arriving from the other direction: with
//    nothing to observe, say nothing.
//  · THE UNIT. At six months, "nothing in 26 weeks" is a number you have to
//    convert before it means anything, on a line that exists to be read at a
//    glance.
import { describe, expect, it } from 'vitest';
import { ACTIVE_CAP, goalSlug, horizonLabel, observationFor, statusLabel } from '../lib/hq/goals';

const TODAY = '2026-08-03';

describe('observationFor', () => {
  it('counts what happened in the window, pluralised', () => {
    expect(observationFor(4, '2026-08-01', TODAY)).toEqual({
      text: '4 tasks done in the last 30 days',
      cold: false,
    });
    expect(observationFor(1, '2026-08-01', TODAY)?.text).toBe('1 task done in the last 30 days');
  });

  it('⚠ says NOTHING AT ALL about a goal with no completed tasks — new, not neglected', () => {
    // THE COLD-START GUARD. Without it, the card you create at 9am is already
    // telling you off by 9:01. Michael's call, 2026-08-03: nothing at all.
    expect(observationFor(0, null, TODAY)).toBeNull();
    // And it stays silent however long the goal has existed: a goal you wrote
    // down in March and have not started is not evidence of anything the system
    // is entitled to name.
    expect(observationFor(0, null, '2027-01-01')).toBeNull();
  });

  it('names the gap only once there is a "recent" to compare against', () => {
    // 2026-06-20 → 2026-08-03 is 44 days: 6 whole weeks.
    expect(observationFor(0, '2026-06-20', TODAY)).toEqual({ text: 'nothing in 6 weeks', cold: true });
  });

  it('switches to months once weeks stop being readable', () => {
    // 2026-01-05 → 2026-08-03 is 210 days. "nothing in 30 weeks" is a number
    // you have to convert before it means anything.
    expect(observationFor(0, '2026-01-05', TODAY)).toEqual({ text: 'nothing in 7 months', cold: true });
  });

  it('⚠ never says "1 months" at the boundary where the unit changes', () => {
    // 2026-06-08 → 2026-08-03 is 56 days: exactly 8 weeks, and 1.8 months.
    // Flooring gives "nothing in 1 months", which is the kind of thing that
    // ships — the same class as Piece 1's "1 days late".
    expect(observationFor(0, '2026-06-08', TODAY)!.text).toBe('nothing in 2 months');
    // And it stays plural everywhere above the boundary.
    for (const on of ['2026-06-01', '2026-05-01', '2026-03-01', '2025-08-03']) {
      expect(observationFor(0, on, TODAY)!.text, on).not.toMatch(/\b1 months\b/);
    }
  });

  it('⚠ a goal with recent activity is never cold, whatever its history', () => {
    // `cold` is what makes the line render quieter. A goal you did something on
    // yesterday must not read as abandoned because it also has old rows.
    expect(observationFor(2, '2024-01-01', TODAY)?.cold).toBe(false);
  });
});

describe('the vocabulary', () => {
  it('caps active goals at five — harder than constellations, because attention is scarcer', () => {
    expect(ACTIVE_CAP).toBe(5);
  });

  it('offers three horizons and not one of them can express a date', () => {
    expect(horizonLabel('this_season')).toBe('this season');
    expect(horizonLabel('this_year')).toBe('this year');
    expect(horizonLabel('next_few_years')).toBe('the next few years');
  });

  it('⚠ carries "Let go" as a status beside the others, not as a delete', () => {
    expect(statusLabel('let_go')).toBe('Let go');
  });

  it('mints a slug, and never an empty one', () => {
    expect(goalSlug('Get back in shape')).toBe('get-back-in-shape');
    // A name in a script `slugify` cannot transliterate would otherwise leave a
    // goal with no address at all.
    expect(goalSlug('目標')).toBe('goal');
  });
});
