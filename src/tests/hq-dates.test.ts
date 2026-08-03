// The date arithmetic under Today (11 · Piece 0b).
//
// These are pure functions, which is the whole reason they exist as a module
// rather than as three copies inside three pages — and it means the edge cases
// that actually bite (the 11th/12th/13th, 29 February, a month grid crossing a
// year, a `?date=` that is not a real date) can be asserted here rather than
// discovered on a morning in February.
//
// THE RECURRING BUG THIS FILE GUARDS: a local date is a `YYYY-MM-DD` string,
// never a `Date`. `new Date('2026-08-01')` is midnight UTC, so reading
// `.getDate()` off it returns 31 July anywhere west of Greenwich. Every helper
// does its arithmetic in UTC and formats with `timeZone: 'UTC'`; the assertions
// below are what keep that true, because the failure only appears on a server
// in a different zone from the developer's laptop.
import { describe, expect, it } from 'vitest';
import { dmd, headerDate, monthGrid, monthTitle, nextOccurrence, ordinal, shiftMonth } from '../lib/hq/dates';
import { deviceZoneNote, isValidTimezone, localToday, parseYmd, shiftYmd, ymdOf } from '../lib/hq/time';

describe('ordinal', () => {
  it('handles the ordinary cases', () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th']);
  });

  it('handles the teens, which every naive implementation gets wrong', () => {
    expect([11, 12, 13].map(ordinal)).toEqual(['11th', '12th', '13th']);
  });

  it('resumes after the teens', () => {
    expect([21, 22, 23, 31].map(ordinal)).toEqual(['21st', '22nd', '23rd', '31st']);
  });
});

describe('headerDate', () => {
  it('reads as the day you are standing on', () => {
    expect(headerDate('2026-08-01')).toBe('Saturday, August 1st, 2026');
  });

  it('is not shifted by the machine it runs on', () => {
    // The 1st of a month is where a UTC-vs-local slip shows up as "the 31st of
    // the month before" — the exact bug that makes a check-in land on the
    // wrong day for anyone west of Greenwich.
    expect(headerDate('2026-01-01')).toBe('Thursday, January 1st, 2026');
    expect(headerDate('2026-12-31')).toBe('Thursday, December 31st, 2026');
  });
});

describe('dmd', () => {
  it('omits the year within the same year', () => {
    expect(dmd('2026-11-02', '2026-08-01')).toBe('11/2 Mon');
  });

  it('shows the year otherwise — without it, two years ago reads as last month', () => {
    expect(dmd('2024-07-20', '2026-08-01')).toBe('7/20/24 Sat');
  });
});

describe('nextOccurrence', () => {
  it('stays in this year when the date is still ahead', () => {
    expect(nextOccurrence(11, 2, '2026-08-01')).toBe('2026-11-02');
  });

  it('includes today — a birthday today is not next year', () => {
    expect(nextOccurrence(8, 1, '2026-08-01')).toBe('2026-08-01');
  });

  it('rolls to next year the day after it passes', () => {
    expect(nextOccurrence(7, 31, '2026-08-01')).toBe('2027-07-31');
  });

  it('falls 29 February back to 1 March in a common year', () => {
    expect(nextOccurrence(2, 29, '2026-01-01')).toBe('2026-03-01');
  });

  it('keeps 29 February in a leap year', () => {
    expect(nextOccurrence(2, 29, '2028-01-01')).toBe('2028-02-29');
  });
});

describe('monthGrid', () => {
  it('is always 42 cells, so the page never jumps between months', () => {
    for (const m of ['2026-02-10', '2026-08-01', '2026-11-30']) {
      expect(monthGrid(m)).toHaveLength(42);
    }
  });

  it('starts on the Sunday on or before the 1st', () => {
    // August 2026 begins on a Saturday, so the grid opens on 26 July.
    expect(monthGrid('2026-08-15')[0].ymd).toBe('2026-07-26');
  });

  it('marks the cells that belong to other months', () => {
    const grid = monthGrid('2026-08-15');
    expect(grid[0].outside).toBe(true);
    expect(grid.find((c) => c.ymd === '2026-08-01')?.outside).toBe(false);
    expect(grid.filter((c) => !c.outside)).toHaveLength(31);
  });

  it('crosses a year boundary without losing a day', () => {
    const grid = monthGrid('2026-12-05');
    expect(grid.some((c) => c.ymd === '2027-01-01')).toBe(true);
    expect(grid.filter((c) => !c.outside)).toHaveLength(31);
  });
});

describe('shiftMonth and monthTitle', () => {
  it('steps months from the first, not from the selected day', () => {
    // Stepping from the 31st is where naive month arithmetic overshoots: "one
    // month before 31 March" becomes 3 March, and the calendar skips February.
    expect(shiftMonth('2026-03-31', -1)).toBe('2026-02-01');
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01');
  });

  it('titles the month it is showing', () => {
    expect(monthTitle('2026-08-01')).toBe('August 2026');
  });
});

describe('parseYmd', () => {
  it('accepts a real date', () => {
    expect(parseYmd('2026-08-01')).toBe('2026-08-01');
  });

  it('rejects a date that does not exist', () => {
    // JS rolls impossible dates forward silently — 2026-02-31 becomes 3 March —
    // so only formatting it back reveals it was never the date asked for.
    expect(parseYmd('2026-02-31')).toBeNull();
    expect(parseYmd('2026-13-01')).toBeNull();
  });

  it('rejects anything that is not the wire format', () => {
    for (const junk of [null, '', 'today', '2026-8-1', '01/08/2026', '2026-08-01T00:00:00Z']) {
      expect(parseYmd(junk)).toBeNull();
    }
  });
});

describe('shiftYmd', () => {
  it('crosses month and year ends by the calendar', () => {
    expect(shiftYmd('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftYmd('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftYmd('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('round-trips', () => {
    expect(shiftYmd(shiftYmd('2026-08-01', 47), -47)).toBe('2026-08-01');
  });
});

describe('localToday', () => {
  it('gives the date where you are, not where the server is', () => {
    // 2026-08-02 05:00 UTC — 10pm on 1 August in Los Angeles, 2pm on the 2nd in
    // Tokyo. One instant, three different answers to "what day is it", which is
    // the whole reason the zone is configured rather than assumed. A server in
    // UTC deciding on its own would file that evening's check-in a day early.
    const instant = new Date('2026-08-02T05:00:00Z');
    expect(localToday('UTC', instant)).toBe('2026-08-02');
    expect(localToday('America/Los_Angeles', instant)).toBe('2026-08-01');
    expect(localToday('Asia/Tokyo', instant)).toBe('2026-08-02');
  });

  it('follows DST, where a hard-coded offset would land on the wrong day', () => {
    // In August, Los Angeles is UTC-7 (PDT), not the UTC-8 it is called. At
    // 07:30 UTC it is 00:30 on 2 August there — while a hard-coded `-08:00`
    // would say 23:30 on the 1st. Different DAY, from the same instant: the
    // exact failure that made storing an IANA name a decision rather than a
    // detail.
    expect(localToday('America/Los_Angeles', new Date('2026-08-02T07:30:00Z'))).toBe('2026-08-02');
    // …and in November the same clock time really is the 1st, because the zone
    // moved and the code did not have to.
    expect(localToday('America/Los_Angeles', new Date('2026-11-02T07:30:00Z'))).toBe('2026-11-01');
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA names', () => {
    expect(isValidTimezone('America/Los_Angeles')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Europe/Lisbon')).toBe(true);
  });

  it('refuses a zone that does not exist', () => {
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });

  it('refuses a numeric offset, which Intl itself would accept', () => {
    // ECMA-402 treats `-08:00` as a valid `timeZone`, so the Intl check alone
    // lets an offset into the column looking healthy — and it is wrong for half
    // of every year. Found by this test, not in review.
    for (const offset of ['-08:00', '+05:30', '+0530', '-08', 'Z']) {
      expect(isValidTimezone(offset), `${offset} is an offset, not a zone`).toBe(false);
    }
  });
});

describe('deviceZoneNote', () => {
  it('says nothing when the device agrees', () => {
    expect(deviceZoneNote('America/Los_Angeles', 'America/Los_Angeles')).toBeNull();
    expect(deviceZoneNote('America/Los_Angeles', undefined)).toBeNull();
  });

  it('names both zones when they differ, and never switches', () => {
    const note = deviceZoneNote('America/Los_Angeles', 'Europe/Lisbon');
    expect(note).toContain('Europe/Lisbon');
    expect(note).toContain('America/Los_Angeles');
  });
});

describe('ymdOf', () => {
  it('reads a UTC-midnight Date back as the date it stands for', () => {
    expect(ymdOf(new Date(Date.UTC(2026, 7, 1)))).toBe('2026-08-01');
  });
});
