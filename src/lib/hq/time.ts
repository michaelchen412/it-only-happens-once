// The one way anything in HQ computes "today" (docs/plans/archive/11-checkin.md §2).
//
// THE BUG THIS FILE EXISTS TO PREVENT. Postgres `timestamptz` has no notion of
// a day, and neither does a `Date`. "Today" is a LOCAL DATE — the one you woke
// up on — and the moment two surfaces each derive it slightly differently, the
// check-in, "due today" and "overdue" start disagreeing at midnight and nobody
// notices for a week. The only real defence is that there is exactly one
// function to call, so everything is wrong or right together.
//
// The zone is CONFIGURED, in `public.settings`, and read server-side. Never the
// browser: the calendar sync and the nightly backup have no browser, and a
// laptop with a stale clock must not be able to move the day boundary. On
// travel the configured zone still wins — see `deviceZoneNote()` for the quiet
// note that is offered instead of a silent switch.
//
// A local date is passed around as a plain `YYYY-MM-DD` STRING, never a `Date`.
// That is deliberate: `new Date('2026-08-01')` is midnight UTC, and reading
// `.getDate()` off it gives 31 July anywhere west of Greenwich. A string has no
// zone to get wrong, and it is also exactly what Postgres `date` wants.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

/** The `YYYY-MM-DD` local-date string every HQ surface passes around. */
export type Ymd = string;

/**
 * Used when `settings` cannot be read, and as the column default. A real value
 * rather than UTC: UTC would silently roll the day over at 4pm or 5pm local,
 * which is worse than being wrong about the city.
 */
export const FALLBACK_TIMEZONE = 'America/Los_Angeles';

/**
 * Is this an IANA zone name we can trust? Guards a bad row rather than
 * trusting one.
 *
 * The `Intl` check alone is NOT enough, which is worth knowing: ECMA-402 also
 * accepts a numeric offset (`-08:00`, `+0530`) as a `timeZone`, so
 * `new Intl.DateTimeFormat('en-CA', { timeZone: '-08:00' })` constructs
 * happily. An offset is precisely what this design forbids — it is wrong for
 * half of every year, and the whole point of storing a name is that DST is
 * then Postgres's problem and `Intl`'s problem rather than ours. So offsets
 * are refused here rather than being allowed to sit in the column looking
 * valid until the clocks change.
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz || tz === 'Z' || /^[+-]/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * How long a resolved zone is reused before `settings` is read again.
 *
 * ⚠ SIXTY SECONDS IS THE WHOLE ARGUMENT, so it is a named constant rather than
 * a number in a condition. See `homeTimezone`.
 */
const TZ_TTL_MS = 60_000;

let tzCache: { tz: string; at: number } | null = null;

/**
 * The configured home timezone.
 *
 * ⚠ CACHED FOR SIXTY SECONDS, AND THE PREVIOUS COMMENT ARGUED AGAINST CACHING —
 * so read this before "fixing" it back. What it said, and it was right:
 *
 *   *"Deliberately NOT cached in module scope… a cache would mean the `UPDATE`
 *   that this design exists to make sufficient ('moving cities is one UPDATE,
 *   not a redeploy') would not take effect until a serverless instance happened
 *   to recycle. Cheap and always true beats fast and occasionally stale."*
 *
 * That is an argument against an **unbounded** cache and it defeats one. A
 * bounded one is a different object: the worst case is that moving cities takes
 * effect within a minute instead of within a request, and the property the old
 * comment was protecting — that an `UPDATE` is sufficient, that no redeploy is
 * ever needed — survives intact. "Until an instance happens to recycle" is
 * unbounded and unpredictable; sixty seconds is neither.
 *
 * What it buys (24 · Piece 2/8): middleware calls this on EVERY admin request,
 * before `loadAttention` can start, because the day it resolves is what
 * `loadAttention` filters on. So it was a serial round trip — 55–65ms measured
 * — in front of every page in the Observatory, to re-read a single row that
 * changes maybe once a year.
 *
 * ⚠ THE CACHE IS THE RESOLVED ZONE, NOT THE DAY. `localToday` is still computed
 * per call, so midnight still turns on time and `day-turn.ts` keeps working. A
 * cache of `{ tz, ymd }` would freeze the date for a minute, which is exactly
 * the class of bug this module opens by promising to prevent.
 *
 * Never throws. A failure at 7am should give a slightly-wrong day, not a 500.
 */
export async function homeTimezone(sb: SupabaseClient<Database>): Promise<string> {
  const now = Date.now();
  if (tzCache && now - tzCache.at < TZ_TTL_MS) return tzCache.tz;

  const { data } = await sb.from('settings').select('home_timezone').limit(1).maybeSingle();
  const raw = data?.home_timezone;
  const tz = raw && isValidTimezone(raw) ? raw : FALLBACK_TIMEZONE;

  // ⚠ A FAILED READ IS NOT CACHED AS AN ANSWER. `data` is null both when the row
  // says nothing and when the request failed, and pinning the fallback for a
  // minute after one blip would turn a transient error into a minute of the
  // wrong city. Only a zone that actually came out of the column is stored.
  if (raw) tzCache = { tz, at: now };
  return tz;
}

/**
 * Drop the cached zone.
 *
 * ⚠ IT EXISTS FOR `hq-time.test.ts` AND NOTHING ELSE, and it was DELETED on
 * 2026-08-15 before being put back the same day — which is the useful half of
 * the story. It was removed as an unused export, correctly: `homeTimezone` was
 * called by seven action modules and exercised by no test at all, so this was a
 * seam for tests nobody had written, and a helper nothing calls provides no
 * safety. It only reads as though something is covered.
 *
 * The right answer was never "keep the dead helper" or "delete it and move on"
 * — it was to write the test the helper was made for, which is what put it
 * back. What that test pins is small and easy to lose: the TTL, and the rule
 * that A FAILED READ IS NOT CACHED AS AN ANSWER, which stops one blip pinning
 * the fallback zone for a minute and is exactly what a tidy-up of `if (raw)`
 * into `if (tz)` would quietly remove.
 */
export function resetTimezoneCache(): void {
  tzCache = null;
}

/**
 * Today, as a local date in `tz`.
 *
 * `en-CA` because its short date format IS `YYYY-MM-DD` — the one locale that
 * gives the wire format for free, with no reassembly and no chance of a
 * month/day swap.
 */
export function localToday(tz: string, now: Date = new Date()): Ymd {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}

/**
 * Today in the configured zone — the call almost every surface actually wants.
 */
export async function today(sb: SupabaseClient<Database>): Promise<{ tz: string; ymd: Ymd }> {
  const tz = await homeTimezone(sb);
  return { tz, ymd: localToday(tz) };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `?date=` parameter, validated into a real local date.
 *
 * Returns `null` for anything that is not a calendar date that exists, so the
 * caller falls back to today rather than rendering a page about 31 February.
 * The round-trip check is what catches those: JS rolls impossible dates forward
 * silently, so `2026-02-31` becomes 3 March and only formatting it back reveals
 * that it was never the date asked for.
 */
export function parseYmd(raw: string | null): Ymd | null {
  if (!raw || !YMD.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return ymdOf(dt) === raw ? raw : null;
}

/** `YYYY-MM-DD` for a Date, read in UTC — the inverse of `ymdToUtc`. */
export function ymdOf(dt: Date): Ymd {
  return dt.toISOString().slice(0, 10);
}

/**
 * A local date as a UTC-midnight `Date`, purely so JS's calendar arithmetic
 * (weekday, month length, "30 days later") can be borrowed.
 *
 * ⚠ The result is NOT an instant in time and must never be formatted with a
 * timezone or compared against `Date.now()`. It is a calendar position wearing
 * a `Date` costume, and reading it in UTC is what keeps that honest.
 */
export function ymdToUtc(ymd: Ymd): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** `n` days from a local date. Handles month and year ends via the calendar. */
export function shiftYmd(ymd: Ymd, n: number): Ymd {
  const dt = ymdToUtc(ymd);
  dt.setUTCDate(dt.getUTCDate() + n);
  return ymdOf(dt);
}

/**
 * Whole days from `a` to `b`, both local dates. Negative if `b` is earlier.
 *
 * ⚠ THROUGH `ymdToUtc`, WHICH IS WHY IT SURVIVES DST. Both operands become
 * UTC-midnight calendar positions before subtracting, so a span crossing a
 * clock change is still a whole number of days — where subtracting two local
 * instants would give 23.0 or 25.0 hours and round to the wrong answer twice a
 * year. `Math.round` then absorbs nothing but floating-point dust.
 *
 * Lived in `people.ts` until 2026-08-04 and was imported from there by `today`,
 * `drift`, `goals` and `interactions`, while `tasks.ts` quietly kept a second
 * copy by a different route. It is generic calendar arithmetic, so it belongs
 * beside `shiftYmd` rather than inside a domain module.
 */
export function daysBetween(a: Ymd, b: Ymd): number {
  return Math.round((ymdToUtc(b).getTime() - ymdToUtc(a).getTime()) / 86_400_000);
}

/**
 * The nth `weekday` of a month, as a local date — `nth: -1` for the LAST one.
 *
 * `month` is 0-INDEXED, like `Date.UTC`, because both callers are already
 * holding one of those. `weekday` is 0 = Sunday, like `getUTCDay`. Returns null
 * when the month has no nth such weekday — there is no fifth Monday in most
 * Februaries — and never for `-1`, because a last one always exists.
 *
 * ⚠ LIFTED OUT OF `recurrence.ts` (2026-08-21), where it was private and
 * expanded `FREQ=MONTHLY;BYDAY=3MO`. `holidays.ts` needs the identical
 * arithmetic for "the third Sunday of June", and the alternative was a second
 * copy — which is precisely the mistake `daysBetween` above already documents,
 * having been imported out of `people.ts` while `tasks.ts` "quietly kept a
 * second copy by a different route". Generic calendar arithmetic belongs beside
 * `shiftYmd`, not inside a domain module.
 *
 * ⚠ BYTE-IDENTICAL TO THE VERSION IT REPLACES, deliberately. Every recurring
 * task in the database is scheduled through this; a tidy-up here reschedules
 * them all, silently, and `hq-recurrence.test.ts` is what would notice.
 */
export function nthWeekdayOf(year: number, month: number, weekday: number, nth: number): Ymd | null {
  if (nth > 0) {
    const first = new Date(Date.UTC(year, month, 1));
    const shift = (weekday - first.getUTCDay() + 7) % 7;
    const d = new Date(Date.UTC(year, month, 1 + shift + (nth - 1) * 7));
    return d.getUTCMonth() === month ? ymdOf(d) : null;
  }
  const last = new Date(Date.UTC(year, month + 1, 0));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return ymdOf(new Date(Date.UTC(year, month, last.getUTCDate() - back)));
}

/**
 * How far ahead of UTC `tz` is at a given instant, in milliseconds.
 *
 * There is no direct API for this, so it is read back out of a formatter: ask
 * `Intl` what the wall clock says in `tz`, pretend that reading is UTC, and the
 * difference is the offset. It is the standard trick and it is DST-correct by
 * construction, because the formatter already applied the rules for that date.
 */
function offsetMs(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  // `hour` comes back as "24" at midnight in some ICU builds under hour12:false.
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - at.getTime();
}

/**
 * A wall-clock time on a local date, in `tz`, as a real instant.
 *
 * This is what turns "I went to bed at 11:35" into the `timestamptz` the schema
 * wants. **Two passes, deliberately:** the offset depends on the instant, and
 * the instant is what we are solving for, so the first pass guesses with the
 * offset at the naive time and the second corrects it. One pass is wrong for
 * the couple of hours after a DST change — which is precisely the night whose
 * sleep record you would least like to be silently an hour out.
 */
export function zonedTimeToUtc(ymd: Ymd, hhmm: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const guess = naive - offsetMs(tz, new Date(naive));
  return new Date(naive - offsetMs(tz, new Date(guess)));
}

/** An instant read back as `HH:MM` on the wall clock in `tz`. */
export function utcToZonedTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** An instant read back as the local DATE in `tz`. */
export function utcToZonedYmd(iso: string, tz: string): Ymd {
  return localToday(tz, new Date(iso));
}

/**
 * An instant as a 12-hour clock time in `tz` — `12:41 AM`.
 *
 * **NOTHING IN THIS PROJECT EVER RENDERS UTC** (Michael's rule, 2026-08-02). A
 * timestamp on screen is a time a person is meant to recognise, and "12:41 AM
 * UTC" is not a time anybody has ever been awake for. Server-rendered stamps go
 * through here in the configured home zone; `src/scripts/local-time.ts` then
 * rewrites them into whatever zone the reader's device is actually in, which is
 * the only zone that answers "when did I do that?".
 *
 * Note this is display only, and it does not contradict the day boundary being
 * server-side: the browser may say what o'clock it was, never what day it was.
 */
export function clockIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/**
 * The quiet travel note (§2): if the browser is somewhere else, say so — never
 * switch. A silent switch mid-trip corrupts the sleep series exactly at the
 * boundary, doubling or skipping a day, and does it invisibly.
 *
 * Runs client-side, so it takes the device zone as an argument rather than
 * reading it here; the server has no business asking.
 */
export function deviceZoneNote(configured: string, device: string | undefined): string | null {
  if (!device || device === configured) return null;
  return `Your device says ${device}. Days here are still counted in ${configured}.`;
}
