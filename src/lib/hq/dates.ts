// HQ's date and time registers (docs/plans/10-hq.md §10d).
//
// Two registers, deliberately, because they answer different questions:
//
//   the day you are standing on   `Saturday, August 1st, 2026`   the Today header
//   a future date referred to     `11/2 Mon`                     birthdays, upcoming
//   elapsed time                  `3 weeks ago`                  anything past
//
// A PAST DATE RENDERS AS A DURATION, not a date: "3 weeks ago" answers the
// question being asked and "7/20 Sat" does not. Where a compact date IS shown
// for an old one the year appears — `M/D Ddd` carries no year, and without it a
// two-year-old contact reads as last month. That was found in the people lab,
// not in review.
//
// THIS IS NOT THE BLOG'S REGISTER. `Timestamp.astro` keeps `March 12`, an
// editorial choice in design.md. What HQ reuses is the *interaction* — a clock
// icon and a quiet label, click for the full truth — not the format.
//
// Everything here takes a `YYYY-MM-DD` local-date string and does its calendar
// arithmetic in UTC (see the warning on `ymdToUtc`). Formatting is forced to
// `timeZone: 'UTC'` for the same reason: these are calendar positions, not
// instants, and letting the server's zone into the formatter is exactly how a
// date renders one day early on a machine in Virginia.
import { ymdOf, ymdToUtc, type Ymd } from './time';

const CAL = { timeZone: 'UTC' } as const;

/**
 * `just now` · `20m ago` · `3h ago` · `2d ago` — elapsed time from an INSTANT.
 *
 * `since()` in interactions.ts answers the same question from a calendar date,
 * and the two are deliberately separate rather than one function with a flag.
 * A logged interaction knows only what day it happened, so its finest honest
 * bucket is "yesterday"; a brain dump knows the second it was typed, and on the
 * pile the useful distinction is between one you jotted before breakfast and
 * one from last week. Making a date pretend to a clock is how you get "0 days
 * ago" on a row from this morning.
 *
 * ⚠ AND A DURATION IS ZONE-INDEPENDENT, which is why this one may be rendered
 * on the server without breaking the no-UTC-on-screen rule (scripts/local-time)
 * — "3h ago" is 3h ago in every zone on earth. Only the exact instant behind it
 * needs the device's zone, and that lives in the stamp's hover title.
 */
export function elapsedSince(iso: string, now: number = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '';
  const mins = Math.max(0, (now - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  const years = days / 365;
  return years < 1.75 ? 'over a year ago' : `${Math.round(years)}y ago`;
}

/** 1st/2nd/3rd — but 11th/12th/13th, then 21st/22nd/23rd/31st. */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** `Saturday, August 1st, 2026` — the day you are standing on. */
export function headerDate(ymd: Ymd): string {
  const d = ymdToUtc(ymd);
  const weekday = d.toLocaleDateString('en-US', { ...CAL, weekday: 'long' });
  const month = d.toLocaleDateString('en-US', { ...CAL, month: 'long' });
  return `${weekday}, ${month} ${ordinal(d.getUTCDate())}, ${d.getUTCFullYear()}`;
}

/** `August 2026` — the calendar popover's heading. */
export function monthTitle(ymd: Ymd): string {
  return ymdToUtc(ymd).toLocaleDateString('en-US', { ...CAL, month: 'long', year: 'numeric' });
}

/**
 * `11/2 Mon`, the compact register — with the year (`7/20/24 Sat`) whenever the
 * date is not in `relativeTo`'s year. The year is not decoration: without it
 * this format made a two-year-old last-contact read as three weeks ago.
 */
export function dmd(ymd: Ymd, relativeTo: Ymd): string {
  const d = ymdToUtc(ymd);
  const sameYear = d.getUTCFullYear() === ymdToUtc(relativeTo).getUTCFullYear();
  const year = sameYear ? '' : `/${String(d.getUTCFullYear()).slice(2)}`;
  const dow = d.toLocaleDateString('en-US', { ...CAL, weekday: 'short' });
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}${year} ${dow}`;
}

/** `Saturday, August 1, 2026` — the exact truth behind a stamp, on hover. */
export function fullDate(ymd: Ymd): string {
  return ymdToUtc(ymd).toLocaleDateString('en-US', {
    ...CAL,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * `4:30 PM` from a `HH:MM[:SS]` clock time — HQ's times are 12-hour, always
 * (§10d). `7:30 PM`, never `19:30`.
 *
 * ⚠ NO ZONE CONVERSION, and none is wanted: `tasks.due_time` is a wall-clock
 * time on a local date, not an instant. "4:30 on Tuesday" must stay 4:30
 * wherever you happen to be standing, which is the same reason the column is a
 * `time` beside a `date` rather than half of a `timestamptz`.
 */
export function clockTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The next time a month/day comes round, on or after `from`.
 *
 * A birthday is stored as month + day with no year, so **the weekday does not
 * exist until the occurrence is resolved** — and it rolls to next year the day
 * after it passes. 29 February falls back to 1 March in a common year, which is
 * a choice: the alternative (28 Feb) celebrates it early, and the alternative
 * to that (skip it) drops the person off the page for three years out of four.
 */
export function nextOccurrence(month: number, day: number, from: Ymd): Ymd {
  const fromYear = ymdToUtc(from).getUTCFullYear();
  const make = (year: number): Ymd => {
    const d = new Date(Date.UTC(year, month - 1, day));
    // JS rolls 29 Feb in a common year forward to 1 Mar on its own; the month
    // check is how we notice that happened rather than trusting it silently.
    return d.getUTCMonth() === month - 1 ? ymdOf(d) : ymdOf(new Date(Date.UTC(year, 2, 1)));
  };
  const thisYear = make(fromYear);
  return thisYear >= from ? thisYear : make(fromYear + 1);
}

/**
 * The 42 cells of a month grid, Sunday-first, as local-date strings.
 *
 * Built server-side on purpose. Astro compiles scoped styles to selectors
 * carrying a `data-astro-cid-*` attribute that it stamps onto elements *in the
 * template* — so a grid built with `createElement` silently gets none of its
 * hover, cursor or focus rules. The prototype hit exactly that. Rendering the
 * cells as real markup sidesteps the whole class of bug (10-hq.md §10h, trap 3).
 *
 * Always 42, never 35 or 28: a grid whose height changes with the month makes
 * the page jump under the cursor while you are stepping through it.
 */
export function monthGrid(anchor: Ymd): { ymd: Ymd; day: number; outside: boolean }[] {
  const a = ymdToUtc(anchor);
  const first = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return {
      ymd: ymdOf(d),
      day: d.getUTCDate(),
      outside: d.getUTCMonth() !== first.getUTCMonth(),
    };
  });
}

/** The first of the month `n` months from `ymd`'s — the calendar's `‹ ›`. */
export function shiftMonth(ymd: Ymd, n: number): Ymd {
  const d = ymdToUtc(ymd);
  return ymdOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}
