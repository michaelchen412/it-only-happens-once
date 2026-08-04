// The one part of the task parser that is arithmetic rather than language
// (14 · Piece 3, §6). Everything else in `parse-task.ts` is a prompt and a
// schema, and neither can be unit-tested — what CAN be, and must be, is the
// check that catches a contradiction the model demonstrably misses.
//
// THE BUG THIS GUARDS. `tasks` stores one date column, so a weekly rule takes
// its weekday from `due_on`. "team sync every Tuesday, but the first one is on
// the 12th" — a Wednesday — therefore stores *every Wednesday*, silently.
// Asked to spot exactly that, the live model caught it in one phrasing and
// missed it in another, which is why this is code and not a prompt line.
import { describe, expect, it } from 'vitest';
import { weekdayDisagreement } from '../lib/hq/parse-task';

const read = (value: string, from: string) => ({ value, from });

describe('weekdayDisagreement', () => {
  it('says nothing when the date IS the weekday the sentence named', () => {
    // 2026-08-06 is a Thursday.
    expect(weekdayDisagreement(read('weekly', 'every Thursday'), read('2026-08-06', 'every Thursday'))).toBeNull();
  });

  it('names the contradiction, and what will actually happen', () => {
    // 2026-08-12 is a Wednesday; the sentence said Tuesday.
    const note = weekdayDisagreement(read('weekly', 'every Tuesday'), read('2026-08-12', 'the 12th'));
    expect(note).toContain('every Tuesday');
    expect(note).toContain('Wednesday');
    expect(note).toMatch(/repeat on Wednesdays/);
  });

  it('covers biweekly too, and plural weekday names', () => {
    expect(weekdayDisagreement(read('biweekly', 'every other Monday'), read('2026-08-12', 'the 12th'))).toContain(
      'Wednesday',
    );
    expect(weekdayDisagreement(read('weekly', 'on Mondays'), read('2026-08-12', 'the 12th'))).toContain('Wednesday');
  });

  it('stays quiet where the question does not arise', () => {
    // No weekday named — "every month" cannot disagree with a date.
    expect(weekdayDisagreement(read('monthly-date', 'every month'), read('2026-08-12', 'the 12th'))).toBeNull();
    // Presets whose weekday is not derived from the date.
    expect(weekdayDisagreement(read('weekdays', 'every weekday'), read('2026-08-12', 'the 12th'))).toBeNull();
    expect(weekdayDisagreement(read('daily', 'every day'), read('2026-08-12', 'the 12th'))).toBeNull();
    // And nothing to compare.
    expect(weekdayDisagreement(null, read('2026-08-12', 'the 12th'))).toBeNull();
    expect(weekdayDisagreement(read('weekly', 'every Tuesday'), null)).toBeNull();
  });
});
