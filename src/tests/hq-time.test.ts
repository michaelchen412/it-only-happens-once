// `src/lib/hq/time.ts` is the calendar every HQ surface agrees through, and it
// had no unit test — 254 lines of zone arithmetic under a project rule that says
// nothing on screen may ever be UTC. Added 2026-08-07 during a quality audit.
//
// These pin the CLAIMS THE FILE MAKES ABOUT ITSELF, not its line-by-line
// mechanics — the header comments say "DST-correct by construction", "survives
// DST", "offsets are refused", "impossible dates return null", and each of those
// is a sentence a future change could quietly falsify. Where a comment gives a
// specific number (23.0 or 25.0 hours across a clock change), the test uses that
// number, so the reasoning and the assertion cannot drift apart.
//
// Fixed instants throughout, never `new Date()` — a clock-dependent test is a
// test that fails on one morning a year and is then deleted.
import { beforeEach, describe, it, expect } from 'vitest';
import {
  FALLBACK_TIMEZONE,
  clockIn,
  daysBetween,
  deviceZoneNote,
  homeTimezone,
  isValidTimezone,
  localToday,
  parseYmd,
  resetTimezoneCache,
  shiftYmd,
  utcToZonedTime,
  utcToZonedYmd,
  ymdOf,
  ymdToUtc,
  zonedTimeToUtc,
} from '../lib/hq/time';

const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';

describe('isValidTimezone', () => {
  it('accepts IANA names', () => {
    expect(isValidTimezone(LA)).toBe(true);
    expect(isValidTimezone(TOKYO)).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('REFUSES numeric offsets, which Intl would otherwise accept', () => {
    // The header's whole argument: an offset is wrong for half of every year,
    // and ECMA-402 constructs one happily. If this ever starts passing, a
    // `-08:00` can reach the settings column and look valid until March.
    expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: '-08:00' })).not.toThrow();
    expect(isValidTimezone('-08:00')).toBe(false);
    expect(isValidTimezone('+0530')).toBe(false);
    expect(isValidTimezone('Z')).toBe(false);
  });

  it('refuses nonsense and empty', () => {
    expect(isValidTimezone('Middle/Earth')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });

  it('the fallback is a real zone, not UTC', () => {
    // UTC would roll the day over at 4pm or 5pm local — "worse than being wrong
    // about the city".
    expect(isValidTimezone(FALLBACK_TIMEZONE)).toBe(true);
    expect(FALLBACK_TIMEZONE).not.toBe('UTC');
  });
});

describe('localToday', () => {
  it('gives the local date, which is not always the UTC one', () => {
    // 2026-03-10T04:30Z is still the 9th in Los Angeles and already the 10th
    // in Tokyo. One instant, two dates — the reason the day is server-side.
    const instant = new Date('2026-03-10T04:30:00Z');
    expect(localToday(LA, instant)).toBe('2026-03-09');
    expect(localToday(TOKYO, instant)).toBe('2026-03-10');
    expect(localToday('UTC', instant)).toBe('2026-03-10');
  });

  it('returns the YYYY-MM-DD wire format, never a locale-swapped one', () => {
    expect(localToday(LA, new Date('2026-12-25T20:00:00Z'))).toBe('2026-12-25');
  });
});

describe('parseYmd', () => {
  it('accepts a real date', () => {
    expect(parseYmd('2026-08-07')).toBe('2026-08-07');
    expect(parseYmd('2024-02-29')).toBe('2024-02-29'); // a real leap day
  });

  it('REJECTS a date that does not exist, rather than rolling it forward', () => {
    // JS rolls 31 February to 3 March silently; the round-trip is what catches
    // it. Without this, `?date=2026-02-31` renders a page about another day.
    expect(parseYmd('2026-02-31')).toBeNull();
    expect(parseYmd('2026-13-01')).toBeNull();
    expect(parseYmd('2023-02-29')).toBeNull(); // 2023 is not a leap year
  });

  it('rejects anything that is not the wire shape', () => {
    expect(parseYmd(null)).toBeNull();
    expect(parseYmd('')).toBeNull();
    expect(parseYmd('7 August 2026')).toBeNull();
    expect(parseYmd('2026-8-7')).toBeNull();
    expect(parseYmd('2026-08-07T00:00:00Z')).toBeNull();
  });
});

describe('ymdToUtc / ymdOf', () => {
  it('round-trips a calendar position', () => {
    expect(ymdOf(ymdToUtc('2026-08-07'))).toBe('2026-08-07');
  });

  it('lands on UTC midnight — a calendar position, not an instant', () => {
    expect(ymdToUtc('2026-08-07').toISOString()).toBe('2026-08-07T00:00:00.000Z');
  });
});

describe('shiftYmd', () => {
  it('crosses a month end', () => {
    expect(shiftYmd('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftYmd('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('crosses a year end', () => {
    expect(shiftYmd('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftYmd('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('crosses a leap day in the right direction', () => {
    expect(shiftYmd('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftYmd('2023-02-28', 1)).toBe('2023-03-01');
  });

  it('0 is identity', () => {
    expect(shiftYmd('2026-08-07', 0)).toBe('2026-08-07');
  });
});

describe('daysBetween', () => {
  it('counts whole days, signed', () => {
    expect(daysBetween('2026-08-01', '2026-08-08')).toBe(7);
    expect(daysBetween('2026-08-08', '2026-08-01')).toBe(-7);
    expect(daysBetween('2026-08-07', '2026-08-07')).toBe(0);
  });

  it('SURVIVES DST — the exact failure the header describes', () => {
    // US clocks go forward on 2026-03-08 and back on 2026-11-01. Subtracting
    // two local instants across those gives 23.0 and 25.0 hours, which rounds
    // to the wrong answer twice a year. Through UTC-midnight positions it is a
    // whole number of days both times.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
  });

  it('counts a whole year without drifting', () => {
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366); // leap
  });
});

describe('zonedTimeToUtc', () => {
  it('turns a wall-clock time into the right instant', () => {
    // 23:35 on 7 August in LA is PDT (UTC-7) → 06:35Z the next day.
    expect(zonedTimeToUtc('2026-08-07', '23:35', LA).toISOString()).toBe('2026-08-08T06:35:00.000Z');
    // Winter is PST (UTC-8).
    expect(zonedTimeToUtc('2026-01-07', '23:35', LA).toISOString()).toBe('2026-01-08T07:35:00.000Z');
  });

  it('is correct in the hours AFTER a clock change — the two-pass case', () => {
    // The header's reason for two passes: one pass is wrong for the couple of
    // hours after a DST change, "precisely the night whose sleep record you
    // would least like to be silently an hour out". 2026-03-08, clocks go
    // forward at 02:00 local; 09:00 local that morning is PDT → 16:00Z.
    expect(zonedTimeToUtc('2026-03-08', '09:00', LA).toISOString()).toBe('2026-03-08T16:00:00.000Z');
    // And the evening before the change is still PST → 08:00Z.
    expect(zonedTimeToUtc('2026-03-08', '00:00', LA).toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });

  it('round-trips back through utcToZonedTime', () => {
    for (const [ymd, hhmm] of [
      ['2026-08-07', '23:35'],
      ['2026-01-07', '00:05'],
      ['2026-03-08', '09:00'],
      ['2026-11-01', '09:00'],
    ] as const) {
      expect(utcToZonedTime(zonedTimeToUtc(ymd, hhmm, LA).toISOString(), LA)).toBe(hhmm);
    }
  });

  it('handles a zone ahead of UTC, not only behind it', () => {
    expect(zonedTimeToUtc('2026-08-07', '09:00', TOKYO).toISOString()).toBe('2026-08-07T00:00:00.000Z');
  });
});

describe('utcToZonedTime', () => {
  it('reads an instant back on the local wall clock, zero-padded', () => {
    expect(utcToZonedTime('2026-08-08T06:35:00Z', LA)).toBe('23:35');
    expect(utcToZonedTime('2026-08-07T15:05:00Z', LA)).toBe('08:05');
  });

  it('uses a 24-hour clock, so it can go straight into <input type="time">', () => {
    expect(utcToZonedTime('2026-08-08T06:35:00Z', LA)).toMatch(/^\d{2}:\d{2}$/);
    expect(utcToZonedTime('2026-08-07T08:00:00Z', LA)).toBe('01:00');
  });

  it('midnight is 00:00, never 24:00', () => {
    expect(utcToZonedTime('2026-08-07T07:00:00Z', LA)).toBe('00:00');
  });
});

describe('utcToZonedYmd', () => {
  it('answers which local DAY an instant fell on', () => {
    // 06:35Z on the 8th is still the evening of the 7th in LA — the property
    // the check-in depends on, since a night crosses midnight UTC.
    expect(utcToZonedYmd('2026-08-08T06:35:00Z', LA)).toBe('2026-08-07');
    expect(utcToZonedYmd('2026-08-08T06:35:00Z', TOKYO)).toBe('2026-08-08');
  });
});

describe('clockIn', () => {
  it('renders a 12-hour time a person recognises', () => {
    expect(clockIn('2026-08-08T06:35:00Z', LA)).toBe('11:35 PM');
    expect(clockIn('2026-08-07T19:41:00Z', LA)).toBe('12:41 PM');
  });

  it('NEVER RENDERS UTC — the project rule, in the one function that formats', () => {
    // The same instant must read differently in two zones. If this ever stops
    // being true, something has started formatting in UTC.
    const instant = '2026-08-08T06:35:00Z';
    expect(clockIn(instant, LA)).not.toBe(clockIn(instant, TOKYO));
    expect(clockIn(instant, LA)).not.toMatch(/UTC|GMT|Z/);
  });

  it('says 12 AM at midnight rather than 0 AM', () => {
    expect(clockIn('2026-08-07T07:00:00Z', LA)).toBe('12:00 AM');
  });
});

describe('deviceZoneNote', () => {
  it('says nothing when the device agrees, or has not said', () => {
    expect(deviceZoneNote(LA, LA)).toBeNull();
    expect(deviceZoneNote(LA, undefined)).toBeNull();
    expect(deviceZoneNote(LA, '')).toBeNull();
  });

  it('NOTES the difference and promises not to switch', () => {
    // A silent switch mid-trip corrupts the sleep series exactly at the
    // boundary, so the copy has to say the days are still counted at home.
    const note = deviceZoneNote(LA, TOKYO);
    expect(note).toContain(TOKYO);
    expect(note).toContain(LA);
    expect(note).toMatch(/still counted/);
  });
});

// ── the cached zone (plan 41, closing §7's own loose end) ────────────────────
//
// ⚠ `homeTimezone` IS CALLED BY SEVEN ACTION MODULES AND BY MIDDLEWARE ON EVERY
// ADMIN REQUEST, and until now by no test at all. That gap was found by deleting
// `resetTimezoneCache` as an unused export — the helper was a seam for tests
// nobody had written. Writing them is what put it back.
//
// Two rules live in those fifteen lines and both are quiet enough to lose:
// the TTL, and that a FAILED READ IS NOT CACHED AS AN ANSWER.
describe('homeTimezone — the bounded cache', () => {
  /** `settings` answering with whatever row the case needs. */
  const db = (row: { home_timezone: string } | null) =>
    ({
      from: () => ({
        select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      }),
    }) as unknown as Parameters<typeof homeTimezone>[0];

  /** Counts the reads, so "was it cached?" is answerable rather than inferred. */
  const counting = (row: { home_timezone: string } | null) => {
    let reads = 0;
    const client = {
      from: () => ({
        select: () => ({
          limit: () => ({
            maybeSingle: async () => {
              reads++;
              return { data: row, error: null };
            },
          }),
        }),
      }),
    } as unknown as Parameters<typeof homeTimezone>[0];
    return { client, reads: () => reads };
  };

  beforeEach(() => resetTimezoneCache());

  it('reads the configured zone', async () => {
    expect(await homeTimezone(db({ home_timezone: 'America/New_York' }))).toBe('America/New_York');
  });

  it('reads `settings` once, then reuses the answer', async () => {
    const { client, reads } = counting({ home_timezone: 'America/New_York' });
    await homeTimezone(client);
    await homeTimezone(client);
    await homeTimezone(client);
    // Middleware calls this in front of every admin page, serially, before
    // `loadAttention` can start — the 55–65ms this cache exists to remove.
    expect(reads(), 'the zone was re-read inside the TTL').toBe(1);
  });

  it('⚠ does NOT cache a failed read, so one blip cannot pin the fallback', async () => {
    // `data` is null both when the row says nothing and when the request FAILED,
    // and the two are indistinguishable here. Caching either would turn a
    // transient error into a minute of the wrong city — which is the bug this
    // module's header promises to prevent, arrived at from underneath.
    const { client, reads } = counting(null);
    expect(await homeTimezone(client)).toBe(FALLBACK_TIMEZONE);
    expect(await homeTimezone(client)).toBe(FALLBACK_TIMEZONE);
    expect(reads(), 'a failed read was cached as though it were an answer').toBe(2);
  });

  it('refuses a nonsense zone in the column and falls back', async () => {
    // A numeric offset is the case `isValidTimezone` exists for: `Intl` accepts
    // it, and it is wrong for half of every year.
    expect(await homeTimezone(db({ home_timezone: '-08:00' }))).toBe(FALLBACK_TIMEZONE);
  });

  it('⚠ but a REFUSED zone still counts as an answer and is cached', async () => {
    // Deliberate, and the asymmetry is the point: the column was read
    // successfully, so there is no blip to protect against — only a bad value,
    // which will still be bad in a minute. Re-reading it every request would pay
    // for nothing.
    const { client, reads } = counting({ home_timezone: '-08:00' });
    await homeTimezone(client);
    await homeTimezone(client);
    expect(reads()).toBe(1);
  });
});
