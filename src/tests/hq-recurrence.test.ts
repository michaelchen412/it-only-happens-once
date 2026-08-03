// Recurrence (13 · Piece 1, §4).
//
// ⚠ THE WHOLE POINT OF THESE IS THAT A RECURRENCE CANNOT BE CHECKED BY EYE.
// You cannot read `FREQ=MONTHLY;BYDAY=3MO` and know it means what you meant,
// and a rule that is subtly wrong stays invisible until months of chores have
// been scheduled against it — at which point the wrong answer is already in the
// database, dated. The editor's next-three preview is the human version of this
// file; this is the version that runs on every commit.
//
// The cases that matter are the ones where a plausible implementation is wrong:
// the fortnight that must keep its PHASE after a late answer, the 31st that has
// no February, the "5th Monday" that most months do not have, and the month
// arithmetic that JavaScript rolls forward silently.
import { describe, expect, it } from 'vitest';
import {
  afterCompletion,
  isSupported,
  nextAfter,
  nextOccurrences,
  parse,
  presetLabel,
  presetOf,
  rruleFor,
} from '../lib/hq/recurrence';

// 2026-08-03 is a Monday, and the FIRST Monday of August 2026.
const MON = '2026-08-03';

describe('rruleFor', () => {
  it('anchors the weekday on the date, not on a default', () => {
    expect(rruleFor('weekly', MON)).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(rruleFor('weekly', '2026-08-06')).toBe('FREQ=WEEKLY;BYDAY=TH');
    expect(rruleFor('biweekly', MON)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
  });

  it('anchors the day of the month, and the nth weekday, on the date', () => {
    expect(rruleFor('monthly-date', '2026-08-17')).toBe('FREQ=MONTHLY;BYMONTHDAY=17');
    expect(rruleFor('monthly-nth', MON)).toBe('FREQ=MONTHLY;BYDAY=1MO');
    expect(rruleFor('monthly-nth', '2026-08-17')).toBe('FREQ=MONTHLY;BYDAY=3MO');
  });

  it('⚠ turns a last-week date into the LAST weekday, never a 5th one', () => {
    // 2026-08-31 is the 5th Monday of August. `BYDAY=5MO` exists in RFC 5545
    // and would silently skip most months — a chore that happens four times a
    // year instead of twelve, with nothing on screen saying so.
    expect(rruleFor('monthly-nth', '2026-08-31')).toBe('FREQ=MONTHLY;BYDAY=-1MO');
    expect(rruleFor('monthly-nth', '2026-08-25')).toBe('FREQ=MONTHLY;BYDAY=-1TU');
  });
});

describe('presetOf', () => {
  it('recovers the preset a stored rule came from, for every preset', () => {
    // How the editor re-selects a segment: generate all six and compare, rather
    // than parsing `BYDAY=-1FR` back by hand.
    for (const anchor of [MON, '2026-08-17', '2026-08-31', '2026-02-28']) {
      for (const preset of ['daily', 'weekly', 'biweekly', 'monthly-date', 'monthly-nth', 'weekdays'] as const) {
        expect(presetOf(rruleFor(preset, anchor), anchor)).toBe(preset);
      }
    }
  });

  it('returns null rather than guessing at a rule it did not write', () => {
    expect(presetOf('FREQ=YEARLY', MON)).toBeNull();
    // Right shape, wrong anchor: this rule is not what any preset means for a
    // Monday, and picking the nearest one would silently reschedule the chore.
    expect(presetOf('FREQ=WEEKLY;BYDAY=TH', MON)).toBeNull();
  });
});

describe('presetLabel', () => {
  it('names the actual day, because the label is the only thing you read', () => {
    expect(presetLabel('weekly', MON)).toBe('Every Monday');
    expect(presetLabel('biweekly', '2026-08-06')).toBe('Every other Thursday');
    expect(presetLabel('monthly-date', '2026-08-17')).toBe('Monthly, on the 17th');
    expect(presetLabel('monthly-nth', '2026-08-17')).toBe('Monthly, on the 3rd Monday');
    expect(presetLabel('monthly-nth', '2026-08-31')).toBe('Monthly, on the last Monday');
  });
});

describe('parse', () => {
  it('accepts every rule we generate', () => {
    for (const preset of ['daily', 'weekly', 'biweekly', 'monthly-date', 'monthly-nth', 'weekdays'] as const) {
      expect(isSupported(rruleFor(preset, '2026-08-17'))).toBe(true);
    }
  });

  it('⚠ refuses anything it does not fully understand, rather than ignoring a part', () => {
    // Ignoring a part you did not understand is how a schedule quietly becomes
    // a different schedule. `UNTIL` is the sharpest: dropped, the chore repeats
    // for ever instead of stopping.
    for (const bad of [
      'FREQ=YEARLY',
      'FREQ=WEEKLY;COUNT=4',
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20270101T000000Z',
      'FREQ=MONTHLY',
      'FREQ=MONTHLY;BYDAY=3MO,1TU',
      'FREQ=WEEKLY;BYDAY=XX',
      'FREQ=WEEKLY;INTERVAL=0;BYDAY=MO',
      'FREQ=MONTHLY;BYMONTHDAY=32',
      'FREQ=WEEKLY;BYDAY=3MO',
      'nonsense',
      '',
    ]) {
      expect(isSupported(bad), bad).toBe(false);
    }
  });

  it('reads INTERVAL, defaulting to 1', () => {
    expect(parse('FREQ=DAILY')?.interval).toBe(1);
    expect(parse('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')?.interval).toBe(2);
  });
});

describe('nextOccurrences', () => {
  it('every day, and every weekday skipping the weekend', () => {
    expect(nextOccurrences('FREQ=DAILY', '2026-08-03', 3)).toEqual(['2026-08-04', '2026-08-05', '2026-08-06']);
    // Friday → Monday, not Saturday.
    expect(nextOccurrences(rruleFor('weekdays', '2026-08-07'), '2026-08-07', 3)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ]);
  });

  it('weekly lands on the same weekday, every time', () => {
    const dates = nextOccurrences(rruleFor('weekly', MON), MON, 3);
    expect(dates).toEqual(['2026-08-10', '2026-08-17', '2026-08-24']);
  });

  it('⚠ fortnightly keeps its PHASE — a fortnight, not "some Monday"', () => {
    const dates = nextOccurrences(rruleFor('biweekly', MON), MON, 3);
    expect(dates).toEqual(['2026-08-17', '2026-08-31', '2026-09-14']);
  });

  it('⚠ monthly on the 31st SKIPS the months that have no 31st', () => {
    // RFC 5545 says skip, and skipping is also the honest answer: there is no
    // 31 February to do the chore on. The preview is where you see it happen
    // and change your mind, which is exactly what the preview is for.
    expect(nextOccurrences('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31', 3)).toEqual([
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
  });

  it('monthly on the 3rd Monday finds it in every month', () => {
    const dates = nextOccurrences('FREQ=MONTHLY;BYDAY=3MO', '2026-08-17', 3);
    expect(dates).toEqual(['2026-09-21', '2026-10-19', '2026-11-16']);
    for (const d of dates) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('monthly on the LAST Friday finds it in every month, including February', () => {
    const dates = nextOccurrences('FREQ=MONTHLY;BYDAY=-1FR', '2026-12-25', 3);
    expect(dates).toEqual(['2027-01-29', '2027-02-26', '2027-03-26']);
  });

  it('returns nothing for a rule it cannot expand, rather than a wrong date', () => {
    expect(nextOccurrences('FREQ=YEARLY', MON, 3)).toEqual([]);
    expect(nextAfter('FREQ=YEARLY', MON)).toBeNull();
  });

  it('falls forward to the next named weekday if the anchor has drifted off', () => {
    // A hand-edited row: a Monday rule on a Wednesday date. Better to land on
    // the next Monday than to refuse and leave the task with no next date.
    expect(nextAfter('FREQ=WEEKLY;BYDAY=MO', '2026-08-05')).toBe('2026-08-10');
  });
});

describe('afterCompletion', () => {
  it('counts from the day you ticked it, in the unit you chose', () => {
    expect(afterCompletion('2026-08-03', 3, 'days')).toBe('2026-08-06');
    expect(afterCompletion('2026-08-03', 2, 'weeks')).toBe('2026-08-17');
    expect(afterCompletion('2026-08-03', 1, 'months')).toBe('2026-09-03');
  });

  it('⚠ steps the CALENDAR for months, so the 15th stays the 15th', () => {
    // Adding 30 days walks the date backwards through the year, which is how a
    // monthly chore ends up on the 3rd by December.
    expect(afterCompletion('2026-01-15', 6, 'months')).toBe('2026-07-15');
  });

  it('⚠ clamps to the end of a short month instead of rolling into the next', () => {
    // JS turns 31 February into 3 March on its own — so "every month" from the
    // 31st would gain a day or three a year, silently.
    expect(afterCompletion('2026-01-31', 1, 'months')).toBe('2026-02-28');
    expect(afterCompletion('2026-08-31', 1, 'months')).toBe('2026-09-30');
  });
});
