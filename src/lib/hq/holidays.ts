// The holidays on the grid — computed from rules, never fetched, never stored.
//
// ⚠ WHY THERE IS NO `holidays` TABLE AND NO DEPENDENCY. Settled with Michael on
// 2026-08-21, and the requirement he actually stated was *"a clean robust way to
// get accurate holiday dates into my calendar that's not going to be weirdly off
// by one day"* — so the whole design is aimed at that one failure mode.
//
// Off-by-one has exactly ONE source in this codebase, and `time.ts` names it in
// its own header: it happens when an INSTANT is converted into a DAY. A holiday
// computed from a rule never becomes an instant. `Date.UTC(y, m, d)` → `ymdOf`
// is pure calendar arithmetic with no zone anywhere in the path, so there is no
// conversion left that could be wrong — not on a machine in California, not on
// the Vercel box whose clock is UTC, not on the day the clocks change.
//
// `date-holidays` — the well-regarded one, 662k downloads a week — was weighed
// and rejected for precisely this. Its API hands back `start` and `end` as JS
// `Date` objects "in local timezone" with the zone taken from the country you
// construct it with, which is the exact material this failure mode is made of;
// you would add a dependency and then write an adapter to strip it back to a
// `Ymd`. It is also ~1.5MB (its own README says so and recommends custom
// builds), pulling `moment-timezone`, `astronomia`, `date-chinese` and
// `jalaali-js` — and `recurrence.ts` already refused `rrule.js` on that same
// argument. Its data is Wikipedia-derived under CC BY-SA 3.0 and REQUIRES
// ATTRIBUTION, which this repo being public makes a real obligation, for
// eighteen dates that have not moved in living memory.
//
// ⚠ THE COST OF THIS CHOICE, STATED SO IT IS NOT A SURPRISE: these rules are
// correct for the UNITED STATES and nowhere else. Mother's Day is the second
// Sunday of May here and Mothering Sunday — Easter-anchored — in Britain. If
// this calendar ever has to be right in two countries, that is the trigger to
// reopen the dependency question, and buying it then would be reasonable.
//
// ⚠ THE LIST IS A CODE EDIT, ON PURPOSE. It is eighteen days chosen by name,
// not a dataset: a table plus an editor would be a migration and a room bought
// to change something roughly never. Add a line here and it is on the grid.
//
// NO SUPABASE IMPORT, pure functions only — same constraint as `calendar.ts` and
// `today.ts`, and load-bearing for the same reason: this module reaches the
// browser bundle.
import { nthWeekdayOf, ymdOf, ymdToUtc, type Ymd } from './time';

/**
 * Weekdays as words, so a rule below reads as the sentence a person would say.
 * 0 = Sunday, matching `getUTCDay` and therefore `nthWeekdayOf`.
 */
const SUN = 0;
const MON = 1;
const THU = 4;

/**
 * How a holiday finds its date in a given year. Three shapes, and every holiday
 * Michael asked for is one of them:
 *
 *   fixed   the same date every year          Christmas, the Fourth of July
 *   nth     the nth weekday of a month        Thanksgiving, Father's Day
 *   easter  an offset from Easter Sunday      Easter itself, at offset 0
 *
 * `nth: -1` means the LAST one — Memorial Day is the last Monday of May, which
 * is not the same as the fourth and differs in about a third of years.
 */
export type HolidayRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nth'; month: number; weekday: number; nth: number }
  | { kind: 'easter'; offset: number };

export interface Holiday {
  /** Stable across renders and years — it is the grid item's id. */
  key: string;
  /** What it says on the day. */
  name: string;
  rule: HolidayRule;
}

/**
 * ⚠ MONTHS HERE ARE 1-INDEXED — January is 1, December is 12.
 *
 * Deliberate, and the single most likely place for the bug this file exists to
 * prevent to be re-introduced. `Date.UTC` and `nthWeekdayOf` both want 0-indexed
 * months, so the tempting move is to write `month: 11` for Christmas and skip a
 * subtraction. That gives a table no human can proofread — and proofreading the
 * table is the entire verification story for a rule nobody can otherwise check.
 *
 * So the table reads the way a person speaks, it matches `people.birth_month`
 * which is already 1–12 for the same reason, and there is EXACTLY ONE `- 1` in
 * this file (in `dateOf`). One conversion in one place cannot disagree with
 * itself.
 *
 * The two groups Michael picked, in calendar order within each. Nothing appears
 * twice: New Year's Day, Thanksgiving and Christmas are federal holidays AND
 * gift days, and a grid that showed them twice would be reporting a duplicate as
 * a fact about the day.
 */
export const HOLIDAYS: readonly Holiday[] = [
  // ── gift and card occasions ───────────────────────────────────────────────
  { key: 'new-years-day', name: 'New Year’s Day', rule: { kind: 'fixed', month: 1, day: 1 } },
  { key: 'valentines', name: 'Valentine’s Day', rule: { kind: 'fixed', month: 2, day: 14 } },
  { key: 'easter', name: 'Easter', rule: { kind: 'easter', offset: 0 } },
  { key: 'mothers-day', name: 'Mother’s Day', rule: { kind: 'nth', month: 5, weekday: SUN, nth: 2 } },
  { key: 'fathers-day', name: 'Father’s Day', rule: { kind: 'nth', month: 6, weekday: SUN, nth: 3 } },
  { key: 'halloween', name: 'Halloween', rule: { kind: 'fixed', month: 10, day: 31 } },
  { key: 'thanksgiving', name: 'Thanksgiving', rule: { kind: 'nth', month: 11, weekday: THU, nth: 4 } },
  { key: 'christmas-eve', name: 'Christmas Eve', rule: { kind: 'fixed', month: 12, day: 24 } },
  { key: 'christmas', name: 'Christmas', rule: { kind: 'fixed', month: 12, day: 25 } },
  { key: 'new-years-eve', name: 'New Year’s Eve', rule: { kind: 'fixed', month: 12, day: 31 } },

  // ── US federal ────────────────────────────────────────────────────────────
  { key: 'mlk-day', name: 'Martin Luther King Jr. Day', rule: { kind: 'nth', month: 1, weekday: MON, nth: 3 } },
  { key: 'presidents-day', name: 'Presidents’ Day', rule: { kind: 'nth', month: 2, weekday: MON, nth: 3 } },
  // ⚠ THE LAST MONDAY, NOT THE FOURTH. May has five Mondays in about a third of
  // years, and in every one of those the fourth Monday is a week early.
  { key: 'memorial-day', name: 'Memorial Day', rule: { kind: 'nth', month: 5, weekday: MON, nth: -1 } },
  { key: 'juneteenth', name: 'Juneteenth', rule: { kind: 'fixed', month: 6, day: 19 } },
  { key: 'independence-day', name: 'Independence Day', rule: { kind: 'fixed', month: 7, day: 4 } },
  { key: 'labor-day', name: 'Labor Day', rule: { kind: 'nth', month: 9, weekday: MON, nth: 1 } },
  {
    key: 'indigenous-peoples-day',
    name: 'Indigenous Peoples’ Day',
    rule: { kind: 'nth', month: 10, weekday: MON, nth: 2 },
  },
  { key: 'veterans-day', name: 'Veterans Day', rule: { kind: 'fixed', month: 11, day: 11 } },
] as const;

/**
 * Easter Sunday, in the Gregorian calendar — the anonymous Gregorian algorithm
 * (Meeus/Jones/Butcher).
 *
 * ⚠ IT IS NOT AN APPROXIMATION and it does not run out. Easter is defined by an
 * ecclesiastical rule — the Sunday after the ecclesiastical full moon on or
 * after 21 March — and this computes that rule exactly, for any Gregorian year.
 * The variable names are the ones every published statement of it uses, kept on
 * purpose: they mean nothing individually, so renaming them to something
 * "clearer" would make it impossible to check this against a reference.
 *
 * It is the ONE holiday here that cannot be read off its own definition, which
 * is why `hq-holidays.test.ts` pins twelve known Easters rather than one.
 */
export function easterSunday(year: number): Ymd {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymdOf(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * What date a holiday falls on in a given year.
 *
 * ⚠ THE ONLY `- 1` IN THIS FILE. `HOLIDAYS` is 1-indexed so a person can read
 * it; `Date.UTC` and `nthWeekdayOf` are 0-indexed. One conversion, here.
 *
 * Never returns null even though `nthWeekdayOf` can: no rule in the table asks
 * for a weekday its month might not have (the highest `nth` is 4, and every
 * month has four of every weekday), so a null would mean the table had been
 * edited into something impossible — and falling back to the last one is a
 * quieter wrong answer than a crash on the Today page at 7am.
 */
export function dateOf(holiday: Holiday, year: number): Ymd {
  const rule = holiday.rule;
  if (rule.kind === 'fixed') return ymdOf(new Date(Date.UTC(year, rule.month - 1, rule.day)));
  if (rule.kind === 'easter') {
    const easter = ymdToUtc(easterSunday(year));
    easter.setUTCDate(easter.getUTCDate() + rule.offset);
    return ymdOf(easter);
  }
  return (
    nthWeekdayOf(year, rule.month - 1, rule.weekday, rule.nth) ?? nthWeekdayOf(year, rule.month - 1, rule.weekday, -1)!
  );
}

/**
 * Every holiday falling in `[from, to]`, inclusive — the one read the calendar
 * makes.
 *
 * ⚠ IT EXPANDS EVERY YEAR THE RANGE TOUCHES, not just `from`'s. A month grid is
 * six weeks, so the December grid reaches into January and the January grid back
 * into December; expanding one year would drop New Year's Day off exactly the
 * two views most likely to be looking for it.
 */
export function holidaysBetween(from: Ymd, to: Ymd): { holiday: Holiday; on: Ymd }[] {
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  const out: { holiday: Holiday; on: Ymd }[] = [];
  for (let year = first; year <= last; year++) {
    for (const holiday of HOLIDAYS) {
      const on = dateOf(holiday, year);
      if (on >= from && on <= to) out.push({ holiday, on });
    }
  }
  return out;
}
