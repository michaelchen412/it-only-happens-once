// The Google mirror's rules, with no Google in them (docs/plans/13-agenda.md §2;
// ADR-0014).
//
// Everything here is pure so it can be tested against the shapes the live
// calendar actually returns — which is how the two facts below were found, and
// neither was in the plan:
//
//  · **Multi-day events are real and are two of the nine.** "Stay at Hyatt Grand
//    Central" runs 29–31 August; "Stay at Hampton Inn" runs four nights. Google
//    gives all-day events an EXCLUSIVE end date, so a mirror that stored it
//    verbatim would put you in a hotel one night longer than you were.
//  · **The calendar's own zone is not HQ's.** The live calendar is
//    `America/New_York`; `settings.home_timezone` is `America/Los_Angeles`. An
//    11pm New York event is on the previous day in California, so the ONE place
//    that conversion may happen is here, at ingest — otherwise every reader
//    redoes it and one of them gets it wrong.
//
// NO SUPABASE AND NO `astro:env` IMPORT. The HTTP half lives in `gcal.ts`.
import { shiftYmd, utcToZonedTime, utcToZonedYmd, type Ymd } from './time';

/** Only the fields the mirror reads. Google sends far more. */
export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  eventType?: string;
  recurringEventId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

/** A row of `external_events`, as the ingest builds it. */
export interface MirrorRow {
  external_id: string;
  series_id: string;
  title: string | null;
  starts_on: Ymd;
  starts_at: string | null;
  ends_on: Ymd | null;
  ends_at: string | null;
  location: string | null;
  url: string | null;
  event_type: string | null;
  cancelled: boolean;
}

/** How far back the FIRST full sync reaches. Google's own sample uses a year. */
export const SYNC_WINDOW_DAYS = 365;

/**
 * How old the mirror may be before a page opening triggers a sync.
 *
 * Ten minutes, and the number is doing less work than it looks: an incremental
 * sync that finds nothing is one HTTP call returning an empty list, so the cost
 * of being wrong in the cheap direction is nearly zero. What this number really
 * prevents is a sync per navigation while clicking around the Agenda room.
 */
export const RESYNC_AFTER_MINUTES = 10;

/**
 * How old the mirror may be before the page SAYS so.
 *
 * ADR-0014 names staleness as this decision's new silent failure mode: *"if the
 * feed stops refreshing, Today is confidently wrong"*. A day is the threshold
 * because the mirror only refreshes when you open a page — so a gap shorter
 * than that means you were away, not that anything is broken.
 */
export const STALE_AFTER_HOURS = 24;

/**
 * ⚠ GOOGLE'S AUTO-GENERATED BIRTHDAYS ARE DROPPED AT INGEST (§2).
 *
 * HQ derives birthdays from `people.birth_month/day` — deliberately never rows —
 * so a person in both Google Contacts and the roster would produce two entries
 * on the same day, rendered DIFFERENTLY: a read-only mirrored row beside a
 * derived cake. That reads as a bug rather than as a duplicate.
 *
 * HQ's own derivation is strictly better anyway: it knows who the person is and
 * carries their lead time. And the filter keeps the table honest — this mirror
 * holds things other people put in your calendar, which is what it is for.
 *
 * ⚠ IT IS NOT A SMALL FILTER. On the live calendar **31 of 48 events** are one
 * person's birthday, expanded annually to 2057.
 */
export function dropped(e: GoogleEvent): boolean {
  return e.eventType === 'birthday';
}

/** Google says an event is gone by sending it back with this status. */
export const isCancelled = (e: GoogleEvent): boolean => e.status === 'cancelled';

/**
 * One Google event as one mirror row, in the home zone.
 *
 * Returns null when there is nothing to store — a dropped birthday, or a
 * cancellation stub, which arrives from incremental sync carrying an id and a
 * status and no times at all. Those are handled by the caller as an UPDATE:
 * there is nothing to insert, and inventing a date for one would be worse than
 * ignoring it.
 */
export function toRow(e: GoogleEvent, tz: string): MirrorRow | null {
  if (dropped(e)) return null;

  const startDate = e.start?.date;
  const startTime = e.start?.dateTime;
  if (!startDate && !startTime) return null;

  const allDay = !!startDate;
  const starts_on = (allDay ? startDate! : utcToZonedYmd(startTime!, tz)) as Ymd;
  const starts_at = allDay ? null : utcToZonedTime(startTime!, tz);

  let ends_on: Ymd | null = null;
  let ends_at: string | null = null;

  if (allDay && e.end?.date) {
    // ⚠ GOOGLE'S ALL-DAY END IS EXCLUSIVE — a two-night stay from the 29th ends
    // on the 31st in Google's terms. Storing that verbatim puts you in the hotel
    // one night longer than you were, which is the kind of wrong that looks
    // right. This column means the LAST day the thing actually covers.
    const last = shiftYmd(e.end.date as Ymd, -1);
    ends_on = last > starts_on ? last : null;
  } else if (!allDay && e.end?.dateTime) {
    ends_at = utcToZonedTime(e.end.dateTime, tz);
    const endYmd = utcToZonedYmd(e.end.dateTime, tz);
    // An event ending exactly at midnight does NOT reach into the next day —
    // it stops at its boundary. Without this a 9pm–midnight dinner would put a
    // row on tomorrow's cell as well.
    if (endYmd > starts_on && ends_at !== '00:00') ends_on = endYmd;
  }

  return {
    external_id: e.id,
    // ⚠ THE SERIES, NOT THE INSTANCE (§2 wrinkle 1). What a person-tag attaches
    // to: an instance id is not stable across a reschedule, and a recurring
    // personal event is a standing arrangement — the same people are in it
    // every time.
    series_id: e.recurringEventId ?? e.id,
    title: e.summary?.trim() || null,
    starts_on,
    starts_at,
    ends_on,
    ends_at,
    location: e.location?.trim() || null,
    url: e.htmlLink ?? null,
    event_type: e.eventType ?? null,
    cancelled: isCancelled(e),
  };
}

/**
 * Every local date a mirrored row covers.
 *
 * A hotel stay is not an event on the day you checked in — it is where you are
 * for four nights, and a calendar that showed it only on the first day would be
 * answering a different question from "what is my day". Bounded so a malformed
 * range can never expand without limit.
 */
export function spans(row: { starts_on: string; ends_on: string | null }, cap = 60): Ymd[] {
  const out: Ymd[] = [row.starts_on as Ymd];
  if (!row.ends_on || row.ends_on <= row.starts_on) return out;
  let day = row.starts_on as Ymd;
  while (day < row.ends_on && out.length < cap) {
    day = shiftYmd(day, 1);
    out.push(day);
  }
  return out;
}

export interface Staleness {
  /** Old enough, or broken enough, that the page must say so. */
  stale: boolean;
  text: string;
}

/**
 * What Today and the Agenda room say about the mirror — and **they say nothing
 * at all while it is current.**
 *
 * A permanent *"synced 4 minutes ago"* is the status line you read once and
 * ignore for ever, which is what 10-hq.md §10i calls noise. But ADR-0014 makes
 * one demand of this integration in exchange for its simplicity: a stale mirror
 * must not render quietly. So: silence when it is working, one quiet line when
 * it is not.
 *
 * An ERROR speaks immediately rather than waiting out the staleness window. A
 * sync that has been failing since this morning is not "a bit old" — it is
 * broken, and the difference matters on a page whose job is to be trusted.
 */
export function staleness(
  sync: { synced_at: string | null; last_error: string | null; last_error_at?: string | null } | null,
  now: Date = new Date(),
): Staleness | null {
  if (!sync) return null;

  // ⚠ AN ERROR THE MIRROR HAS ALREADY SYNCED PAST IS HISTORY, NOT NEWS. The
  // success path clears `last_error`, so ordinarily this cannot arise — this is
  // the guard for when it does anyway: a row left behind by an older build, or
  // a future writer that records a failure without checking what it lands on.
  // A stuck error string is the one way this line can be permanently wrong in
  // the direction that matters, telling a reader their calendar is broken when
  // it is not, so it is worth a cheap second opinion from the clock.
  //
  // ⚠ THIS IS NOT WHAT FIXED 2026-08-06 and must not be mistaken for it. That
  // failure stamped its error 127ms AFTER the success it raced, so it is newer
  // and would still speak here, correctly by this rule and wrongly in fact.
  // Concurrency is settled by the claim in `actions/calendar.ts`; the clock can
  // only ever settle order, and order was never the problem.
  const failedAt = sync.last_error ? Date.parse(sync.last_error_at ?? '') : NaN;
  const syncedAt = sync.synced_at ? Date.parse(sync.synced_at) : NaN;
  // An error with no timestamp cannot be ruled out, so it speaks. Silence is
  // the wrong default for a mirror ADR-0014 requires to fail loudly.
  const supersededBySuccess = Number.isFinite(failedAt) && Number.isFinite(syncedAt) && syncedAt > failedAt;

  if (sync.last_error && !supersededBySuccess) return { stale: true, text: 'Google couldn’t be reached' };
  // Never synced at all is not stale — it is not set up, and a mirror nobody has
  // configured has nothing to be wrong about.
  if (!sync.synced_at) return null;

  const hours = (now.getTime() - Date.parse(sync.synced_at)) / 3_600_000;
  if (hours < STALE_AFTER_HOURS) return null;
  const days = Math.round(hours / 24);
  return { stale: true, text: `Google last reached ${days === 1 ? 'a day' : `${days} days`} ago` };
}
