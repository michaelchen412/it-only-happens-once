// The Google mirror's rules (13 · Piece 3, §2; ADR-0014).
//
// ⚠ EVERY FIXTURE BELOW IS A SHAPE THE LIVE CALENDAR ACTUALLY RETURNED, copied
// out of a real `events.list` on 2026-08-03 rather than imagined. That matters
// more here than anywhere else in this codebase: this module's whole job is to
// be right about somebody else's data format, and the two bugs it exists to
// prevent were both found by reading the real response, not the plan.
//
//  · **Google's all-day end date is EXCLUSIVE.** "Stay at Hyatt Grand Central"
//    is `2025-08-29 → 2025-08-31`, which is two nights, not three. Stored
//    verbatim it would put him in the hotel a night longer than he was.
//  · **The calendar's zone is not HQ's.** The live calendar is New York;
//    `home_timezone` is Los Angeles. A late-evening New York event is on the
//    PREVIOUS day in California, and the grid counts days in California.
import { describe, expect, it } from 'vitest';
import { STALE_AFTER_HOURS, dropped, spans, staleness, toRow, type GoogleEvent } from '../lib/hq/mirror';
import type { Ymd } from '../lib/hq/time';

const LA = 'America/Los_Angeles';

describe('dropped', () => {
  it('⚠ drops Google’s auto-generated birthdays, which are most of the calendar', () => {
    // 31 of 48 events on the live calendar are one person's birthday, expanded
    // annually to 2057. HQ derives birthdays from `people.birth_month/day` and
    // renders them as a cake rather than a row — so a person in both places
    // would produce two entries on one day, drawn DIFFERENTLY. That reads as a
    // bug, not as a duplicate.
    expect(dropped({ id: 'x', eventType: 'birthday', start: { date: '2027-04-12' } })).toBe(true);
    expect(dropped({ id: 'x', eventType: 'fromGmail', start: { date: '2026-07-12' } })).toBe(false);
    expect(dropped({ id: 'x', eventType: 'default' })).toBe(false);
    // No `eventType` at all is not a birthday. Absence is not a match.
    expect(dropped({ id: 'x' })).toBe(false);
  });

  it('and `toRow` refuses them too, so the filter cannot be forgotten at a call site', () => {
    expect(toRow({ id: 'x', eventType: 'birthday', start: { date: '2027-04-12' } }, LA)).toBeNull();
  });
});

describe('toRow — a timed event', () => {
  // Verbatim from the live calendar.
  const flight: GoogleEvent = {
    id: 'gcal-flight',
    status: 'confirmed',
    summary: 'Flight to Newark (UA 1830)',
    location: 'Phoenix PHX',
    htmlLink: 'https://www.google.com/calendar/event?eid=abc',
    eventType: 'fromGmail',
    start: { dateTime: '2026-06-24T14:40:00-04:00', timeZone: 'America/New_York' } as GoogleEvent['start'],
    end: { dateTime: '2026-06-24T19:35:00-04:00', timeZone: 'America/New_York' } as GoogleEvent['end'],
  };

  it('⚠ converts into the HOME zone, once, here', () => {
    const row = toRow(flight, LA)!;
    // 14:40 New York is 11:40 in California. The conversion happens at ingest
    // and nowhere else — a mirror of instants would make every reader redo it,
    // and the grid counts days in the home zone.
    expect(row.starts_on).toBe('2026-06-24');
    expect(row.starts_at).toBe('11:40');
    expect(row.ends_at).toBe('16:35');
    // Same day either way, so no span.
    expect(row.ends_on).toBeNull();
  });

  it('keeps the link, the place and the type, and drops nothing else', () => {
    const row = toRow(flight, LA)!;
    expect(row.url).toBe(flight.htmlLink);
    expect(row.location).toBe('Phoenix PHX');
    expect(row.event_type).toBe('fromGmail');
    expect(row.cancelled).toBe(false);
  });

  it('⚠ carries the SERIES as the tag subject, not the instance', () => {
    // An instance id is not stable — reschedule the series in Google and any
    // annotation keyed on it orphans silently. A one-off is its own series.
    expect(toRow(flight, LA)!.series_id).toBe('gcal-flight');
    const instance = { ...flight, id: 'abc_20260731T170000Z', recurringEventId: 'abc' };
    const row = toRow(instance, LA)!;
    expect(row.external_id).toBe('abc_20260731T170000Z');
    expect(row.series_id).toBe('abc');
  });

  it('⚠ puts a late New York evening on the CALIFORNIA day it is actually on', () => {
    // 00:15 on the 28th in New York is 21:15 on the 27th in California. Both
    // are true; only one of them is the day the grid is counting.
    const movie: GoogleEvent = {
      id: 'm',
      summary: 'Regretting You',
      eventType: 'fromGmail',
      start: { dateTime: '2025-10-28T00:15:00-04:00' },
      end: { dateTime: '2025-10-28T01:15:00-04:00' },
    };
    const row = toRow(movie, LA)!;
    expect(row.starts_on).toBe('2025-10-27');
    expect(row.starts_at).toBe('21:15');
    expect(row.ends_on).toBeNull();
  });

  it('does not let an event that ends at midnight reach into tomorrow', () => {
    // Otherwise a 9pm–midnight dinner puts a phantom row on the next cell.
    const row = toRow(
      { id: 'd', start: { dateTime: '2026-08-03T21:00:00-07:00' }, end: { dateTime: '2026-08-04T00:00:00-07:00' } },
      LA,
    )!;
    expect(row.ends_at).toBe('00:00');
    expect(row.ends_on).toBeNull();
  });
});

describe('toRow — an all-day event', () => {
  // Verbatim: a real two-night stay.
  const stay: GoogleEvent = {
    id: 'gcal-hyatt',
    summary: 'Stay at Hyatt Grand Central New York',
    eventType: 'fromGmail',
    location: 'Hyatt Grand Central New York, New York',
    start: { date: '2025-08-29' },
    end: { date: '2025-08-31' },
  };

  it('⚠ subtracts Google’s EXCLUSIVE end date — two nights, not three', () => {
    const row = toRow(stay, LA)!;
    expect(row.starts_on).toBe('2025-08-29');
    expect(row.ends_on).toBe('2025-08-30');
    // All day is the ABSENCE of a time, the same as everywhere else in HQ —
    // there is no boolean here that could contradict it.
    expect(row.starts_at).toBeNull();
    expect(row.ends_at).toBeNull();
  });

  it('gives a single-day all-day event no span at all', () => {
    const row = toRow({ id: 'x', start: { date: '2026-07-12' }, end: { date: '2026-07-13' } }, LA)!;
    expect(row.ends_on).toBeNull();
  });

  it('⚠ does NOT convert an all-day date into a zone', () => {
    // A date has no instant, so there is nothing to convert. Running it through
    // a zone is how a bare date becomes the day before somewhere else — the bug
    // this project has now avoided in four separate tables.
    expect(toRow({ id: 'x', start: { date: '2026-01-01' } }, 'Pacific/Kiritimati')!.starts_on).toBe('2026-01-01');
    expect(toRow({ id: 'x', start: { date: '2026-01-01' } }, 'Pacific/Midway')!.starts_on).toBe('2026-01-01');
  });
});

describe('toRow — what has nothing to store', () => {
  it('returns null for a cancellation stub, which carries no times', () => {
    // Incremental sync sends deletions as an id and a status. There is nothing
    // to insert, and inventing a date for one would be worse than ignoring it.
    expect(toRow({ id: 'gone', status: 'cancelled' }, LA)).toBeNull();
  });

  it('marks a cancellation that DOES still carry its times', () => {
    const row = toRow({ id: 'g', status: 'cancelled', start: { date: '2026-08-03' } }, LA)!;
    expect(row.cancelled).toBe(true);
  });
});

describe('spans', () => {
  it('⚠ covers every day of a stay, because a hotel is not an event on day one', () => {
    // "Stay at Hampton Inn" runs four nights on the live calendar. A calendar
    // that showed it only on the check-in day would be answering a different
    // question from "what is my day".
    expect(spans({ starts_on: '2026-07-12', ends_on: '2026-07-15' })).toEqual([
      '2026-07-12',
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
    ]);
  });

  it('is one day when there is no end, and never runs away', () => {
    expect(spans({ starts_on: '2026-08-03', ends_on: null })).toEqual(['2026-08-03']);
    // An end before the start is malformed; it must not loop or expand.
    expect(spans({ starts_on: '2026-08-03', ends_on: '2026-08-01' })).toEqual(['2026-08-03']);
    expect(spans({ starts_on: '2026-01-01', ends_on: '2030-01-01' }, 5)).toHaveLength(5);
  });
});

describe('staleness', () => {
  const now = new Date('2026-08-03T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  it('⚠ says NOTHING while the mirror is working', () => {
    // A permanent "synced 4 minutes ago" is the status line you read once and
    // ignore for ever (10-hq.md §10i). Silence is the normal state.
    expect(staleness({ synced_at: hoursAgo(1), last_error: null }, now)).toBeNull();
    expect(staleness({ synced_at: hoursAgo(STALE_AFTER_HOURS - 1), last_error: null }, now)).toBeNull();
  });

  it('speaks once it has gone quiet for a day', () => {
    // ADR-0014's one demand in exchange for a one-way mirror: it must not
    // render quietly when it is wrong.
    expect(staleness({ synced_at: hoursAgo(25), last_error: null }, now)).toEqual({
      stale: true,
      text: 'Google last reached a day ago',
    });
    expect(staleness({ synced_at: hoursAgo(24 * 3), last_error: null }, now)?.text).toBe(
      'Google last reached 3 days ago',
    );
  });

  it('⚠ speaks IMMEDIATELY on an error, without waiting out the window', () => {
    // A sync that failed an hour ago is not "a bit old" — it is broken, and the
    // difference matters on a page whose job is to be trusted.
    expect(staleness({ synced_at: hoursAgo(1), last_error: 'invalid_grant' }, now)).toEqual({
      stale: true,
      text: 'Google couldn’t be reached',
    });
  });

  it('says nothing about a mirror that was never set up', () => {
    // Never synced is not stale — it is absent, and a domain that does not
    // exist renders nothing (10-hq.md §10b).
    expect(staleness({ synced_at: null, last_error: null }, now)).toBeNull();
    expect(staleness(null, now)).toBeNull();
  });
});

describe('the local-date discipline', () => {
  it('⚠ never produces a Ymd Postgres would refuse', () => {
    const row = toRow({ id: 'x', start: { dateTime: '2026-12-31T23:30:00-05:00' } }, LA)!;
    const ymd: Ymd = row.starts_on;
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.starts_at).toMatch(/^\d{2}:\d{2}$/);
  });
});
