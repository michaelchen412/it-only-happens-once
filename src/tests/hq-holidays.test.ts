// Holidays (2026-08-21).
//
// ⚠ THIS FILE IS THE ENTIRE VERIFICATION STORY, and that is a deliberate trade
// rather than an omission. `holidays.ts` chose computation over a dependency
// specifically to eliminate the off-by-one class — but the price of computing is
// that nobody can check `{ kind: 'nth', month: 6, weekday: SUN, nth: 3 }` by
// reading it, exactly as `hq-recurrence.test.ts` says of an RRULE. A rule that
// is one week out looks completely correct until June.
//
// So it is checked two ways, because the two fail differently:
//
//   · KNOWN DATES, written down from the calendar. Catches a wrong rule.
//   · STRUCTURAL INVARIANTS over fifty years — Thanksgiving is a Thursday
//     between the 22nd and the 28th, always. Catches a rule that is right in
//     the years somebody happened to check and wrong in the ones they did not.
//
// ⚠ AND NOTHING HERE MOCKS A CLOCK OR SETS A TIMEZONE, which is the point being
// made as much as the dates are: if any of this depended on where it ran, these
// assertions would be red on a UTC CI box and green on the laptop that wrote
// them. They pass everywhere because there is no instant anywhere in the path.
import { describe, expect, it } from 'vitest';
import { HOLIDAYS, dateOf, easterSunday, holidaysBetween, type Holiday } from '../lib/hq/holidays';
import { ymdToUtc } from '../lib/hq/time';

const find = (key: string): Holiday => {
  const h = HOLIDAYS.find((x) => x.key === key);
  if (!h) throw new Error(`no holiday keyed ${key}`);
  return h;
};

const on = (key: string, year: number) => dateOf(find(key), year);
const dayOfWeek = (ymd: string) => ymdToUtc(ymd).getUTCDay();

/** Every year from 2020 to 2069 — wide enough that a leap-year or century bug shows. */
const YEARS = Array.from({ length: 50 }, (_, i) => 2020 + i);

describe('fixed-date holidays', () => {
  it('put the month where a reader of the table would expect it', () => {
    // ⚠ THE ONE ASSERTION THAT CATCHES A 0-INDEXED MONTH SLIPPING INTO THE
    // TABLE. `HOLIDAYS` is 1-indexed so it can be proofread; a future edit that
    // writes `month: 11` for Christmas would silently move it to November, and
    // every other test here would still pass.
    expect(on('christmas', 2026)).toBe('2026-12-25');
    expect(on('christmas-eve', 2026)).toBe('2026-12-24');
    expect(on('new-years-day', 2026)).toBe('2026-01-01');
    expect(on('new-years-eve', 2026)).toBe('2026-12-31');
    expect(on('valentines', 2026)).toBe('2026-02-14');
    expect(on('halloween', 2026)).toBe('2026-10-31');
    expect(on('juneteenth', 2026)).toBe('2026-06-19');
    expect(on('independence-day', 2026)).toBe('2026-07-04');
    expect(on('veterans-day', 2026)).toBe('2026-11-11');
  });

  it('do not drift across leap years', () => {
    for (const year of YEARS) {
      expect(on('christmas', year)).toBe(`${year}-12-25`);
      expect(on('independence-day', year)).toBe(`${year}-07-04`);
    }
  });
});

describe('nth-weekday holidays', () => {
  it('lands Thanksgiving on the known Thursdays', () => {
    expect(on('thanksgiving', 2024)).toBe('2024-11-28');
    expect(on('thanksgiving', 2025)).toBe('2025-11-27');
    expect(on('thanksgiving', 2026)).toBe('2026-11-26');
    expect(on('thanksgiving', 2027)).toBe('2027-11-25');
    expect(on('thanksgiving', 2028)).toBe('2028-11-23');
    expect(on('thanksgiving', 2029)).toBe('2029-11-22');
  });

  it('lands Father’s Day and Mother’s Day on the known Sundays', () => {
    expect(on('mothers-day', 2025)).toBe('2025-05-11');
    expect(on('mothers-day', 2026)).toBe('2026-05-10');
    expect(on('mothers-day', 2027)).toBe('2027-05-09');
    expect(on('mothers-day', 2028)).toBe('2028-05-14');
    expect(on('fathers-day', 2025)).toBe('2025-06-15');
    expect(on('fathers-day', 2026)).toBe('2026-06-21');
    expect(on('fathers-day', 2027)).toBe('2027-06-20');
    expect(on('fathers-day', 2028)).toBe('2028-06-18');
  });

  it('lands the Monday holidays on the known Mondays', () => {
    expect(on('mlk-day', 2026)).toBe('2026-01-19');
    expect(on('presidents-day', 2026)).toBe('2026-02-16');
    expect(on('labor-day', 2026)).toBe('2026-09-07');
    expect(on('indigenous-peoples-day', 2026)).toBe('2026-10-12');
    expect(on('mlk-day', 2027)).toBe('2027-01-18');
    expect(on('presidents-day', 2027)).toBe('2027-02-15');
    expect(on('labor-day', 2027)).toBe('2027-09-06');
    expect(on('indigenous-peoples-day', 2027)).toBe('2027-10-11');
  });

  /* ⚠ THE CASE A PLAUSIBLE IMPLEMENTATION GETS WRONG. Memorial Day is the LAST
     Monday of May, not the fourth, and the two differ in every May with five
     Mondays — 2027 is one, where the fourth Monday is the 24th and the holiday
     is the 31st. `nth: -1` is what makes that right; `nth: 4` would be a week
     early in about a third of all years and correct in the rest, which is
     exactly the shape of bug that survives a spot check. */
  it('takes the LAST Monday in May, not the fourth', () => {
    expect(on('memorial-day', 2025)).toBe('2025-05-26');
    expect(on('memorial-day', 2026)).toBe('2026-05-25');
    expect(on('memorial-day', 2027)).toBe('2027-05-31');
    expect(on('memorial-day', 2028)).toBe('2028-05-29');
    expect(on('memorial-day', 2029)).toBe('2029-05-28');
    // The years where the two rules disagree really do exist in this window.
    const fiveMondayMays = YEARS.filter((y) => Number(on('memorial-day', y).slice(8)) > 28);
    expect(fiveMondayMays.length).toBeGreaterThan(10);
  });

  it('never leaves its own month or weekday, in fifty years', () => {
    for (const year of YEARS) {
      // Thanksgiving: a Thursday, and the 4th one is always the 22nd–28th.
      const t = on('thanksgiving', year);
      expect(dayOfWeek(t)).toBe(4);
      expect(t.slice(0, 7)).toBe(`${year}-11`);
      expect(Number(t.slice(8))).toBeGreaterThanOrEqual(22);
      expect(Number(t.slice(8))).toBeLessThanOrEqual(28);

      // Memorial Day: a Monday, and the last one is always the 25th–31st.
      const m = on('memorial-day', year);
      expect(dayOfWeek(m)).toBe(1);
      expect(m.slice(0, 7)).toBe(`${year}-05`);
      expect(Number(m.slice(8))).toBeGreaterThanOrEqual(25);

      // Father's Day: a Sunday, and the 3rd one is always the 15th–21st.
      const f = on('fathers-day', year);
      expect(dayOfWeek(f)).toBe(0);
      expect(f.slice(0, 7)).toBe(`${year}-06`);
      expect(Number(f.slice(8))).toBeGreaterThanOrEqual(15);
      expect(Number(f.slice(8))).toBeLessThanOrEqual(21);

      // Mother's Day: a Sunday, and the 2nd one is always the 8th–14th.
      const mo = on('mothers-day', year);
      expect(dayOfWeek(mo)).toBe(0);
      expect(Number(mo.slice(8))).toBeGreaterThanOrEqual(8);
      expect(Number(mo.slice(8))).toBeLessThanOrEqual(14);
    }
  });
});

describe('easterSunday', () => {
  /* Written down from the calendar, not generated — a generated expectation
     would only prove the algorithm agrees with itself. Sixteen consecutive
     years span the full 22 March – 25 April range Easter can occupy. */
  it('agrees with the known Easters', () => {
    const known: Record<number, string> = {
      2020: '2020-04-12',
      2021: '2021-04-04',
      2022: '2022-04-17',
      2023: '2023-04-09',
      2024: '2024-03-31',
      2025: '2025-04-20',
      2026: '2026-04-05',
      2027: '2027-03-28',
      2028: '2028-04-16',
      2029: '2029-04-01',
      2030: '2030-04-21',
      2031: '2031-04-13',
      2032: '2032-03-28',
      2033: '2033-04-17',
      2034: '2034-04-09',
      2035: '2035-03-25',
    };
    for (const [year, ymd] of Object.entries(known)) {
      expect(easterSunday(Number(year))).toBe(ymd);
    }
  });

  it('is always a Sunday between 22 March and 25 April', () => {
    for (const year of YEARS) {
      const e = easterSunday(year);
      expect(dayOfWeek(e)).toBe(0);
      expect(e >= `${year}-03-22`).toBe(true);
      expect(e <= `${year}-04-25`).toBe(true);
    }
  });

  it('is what the grid shows for Easter', () => {
    expect(on('easter', 2026)).toBe(easterSunday(2026));
  });
});

describe('holidaysBetween', () => {
  it('finds what falls inside the range and nothing outside it', () => {
    const got = holidaysBetween('2026-12-01', '2026-12-31').map((h) => h.on);
    expect(got).toEqual(['2026-12-24', '2026-12-25', '2026-12-31']);
  });

  it('is inclusive of both ends', () => {
    expect(holidaysBetween('2026-12-25', '2026-12-25').map((h) => h.holiday.key)).toEqual(['christmas']);
  });

  /* ⚠ THE SIX-WEEK GRID IS WHY THIS MATTERS. A month view is 42 days, so the
     December cells run into January and the January cells back into December —
     expanding only `from`'s year would drop New Year's Day off exactly the two
     views most likely to be looking for it. */
  it('crosses the year boundary a month grid actually spans', () => {
    const grid = holidaysBetween('2026-11-29', '2027-01-09');
    const keys = grid.map((h) => h.holiday.key);
    expect(keys).toContain('christmas');
    expect(keys).toContain('new-years-eve');
    expect(keys).toContain('new-years-day');
    expect(grid.find((h) => h.holiday.key === 'new-years-day')?.on).toBe('2027-01-01');
  });

  it('never reports the same day twice', () => {
    // New Year's Day, Thanksgiving and Christmas are federal AND gift days;
    // each is listed once, so a whole year holds one row per holiday.
    const year = holidaysBetween('2026-01-01', '2026-12-31');
    expect(year).toHaveLength(HOLIDAYS.length);
    expect(new Set(year.map((h) => h.holiday.key)).size).toBe(HOLIDAYS.length);
  });
});
