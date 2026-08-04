// The check-in's arithmetic (11 · Piece 1).
//
// Three things are asserted here and nowhere else, because all three are wrong
// in ways that look right on screen:
//
//  1. WHICH INSTANT a wall-clock time is. "11:35pm" is not a fact until you say
//     where, and the answer changes twice a year.
//  2. WHICH NIGHT a bedtime belongs to. `log_date` is the date you WOKE on, so a
//     23:35 bedtime is the day before — and the code that decides this is one
//     comparison that a later reader will be tempted to "simplify".
//  3. THE MEDIAN OF A CLOCK, which is circular. A naive median of bed times
//     straddling midnight lands in the afternoon and looks like a plausible
//     suggestion.
import { describe, expect, it } from 'vitest';
import { derive, deriveLine, hasAnswers, hm, medianClock, t12, wordFor } from '../lib/hq/checkin';
import { utcToZonedTime, zonedTimeToUtc } from '../lib/hq/time';

const LA = 'America/Los_Angeles';

describe('zonedTimeToUtc', () => {
  it('reads a wall clock in the configured zone, not the server’s', () => {
    // 11:35pm on 1 August in LA (PDT, UTC-7) is 06:35 UTC on the 2nd.
    expect(zonedTimeToUtc('2026-08-01', '23:35', LA).toISOString()).toBe('2026-08-02T06:35:00.000Z');
    // The same wall clock in UTC is a different instant entirely.
    expect(zonedTimeToUtc('2026-08-01', '23:35', 'UTC').toISOString()).toBe('2026-08-01T23:35:00.000Z');
  });

  it('uses the offset in force on THAT date, not today’s', () => {
    // LA is UTC-7 in August and UTC-8 in January. A single stored offset would
    // put every winter bedtime an hour out — for months, silently.
    expect(zonedTimeToUtc('2026-01-15', '23:35', LA).toISOString()).toBe('2026-01-16T07:35:00.000Z');
    expect(zonedTimeToUtc('2026-07-15', '23:35', LA).toISOString()).toBe('2026-07-16T06:35:00.000Z');
  });

  it('survives the night the clocks go back', () => {
    // 1 November 2026, 01:30 — a wall-clock time that happens TWICE in LA. It
    // must resolve to one of them rather than to something an hour outside the
    // day; the two-pass offset lookup is what guarantees that.
    const at = zonedTimeToUtc('2026-11-01', '01:30', LA);
    expect(utcToZonedTime(at.toISOString(), LA)).toBe('01:30');
  });

  it('survives the night the clocks go forward', () => {
    // 8 March 2026: 02:00–03:00 does not exist in LA. The result must still be
    // a real instant, and reading it back must not throw or wander to the day
    // before — a sleep row landing on the wrong date is the failure to avoid.
    const at = zonedTimeToUtc('2026-03-08', '02:30', LA);
    expect(Number.isNaN(at.getTime())).toBe(false);
    expect(at.toISOString().slice(0, 10)).toBe('2026-03-08');
  });

  it('round-trips an ordinary time', () => {
    for (const t of ['00:00', '06:25', '12:00', '23:59']) {
      expect(utcToZonedTime(zonedTimeToUtc('2026-08-01', t, LA).toISOString(), LA)).toBe(t);
    }
  });
});

describe('derive', () => {
  it('wraps past midnight, which is the normal case and not the edge one', () => {
    const d = derive('23:35', '06:25', null, null)!;
    expect(d.inBed).toBe(410); // 6h50m, not minus seventeen hours
    expect(hm(d.inBed)).toBe('6h 50m');
  });

  it('handles a night that does not cross midnight', () => {
    expect(derive('01:30', '08:00', null, null)!.inBed).toBe(390);
  });

  it('refuses to estimate sleep until both buckets are answered', () => {
    // An efficiency that silently assumed "fell asleep instantly, never woke"
    // would be a number he did not give, presented as one he did.
    expect(derive('23:35', '06:25', null, null)).toMatchObject({ asleep: null, efficiency: null });
    expect(derive('23:35', '06:25', 'under_15', null)).toMatchObject({ asleep: null, efficiency: null });
  });

  it('estimates from the bucket midpoints once both are in', () => {
    const d = derive('23:35', '06:25', '15_30', 'few')!;
    expect(d.asleep).toBe(410 - 22 - 12);
    expect(d.efficiency).toBe(92);
  });

  it('is null without both times', () => {
    expect(derive(null, '06:25', null, null)).toBeNull();
    expect(derive('23:35', null, null, null)).toBeNull();
  });
});

describe('deriveLine', () => {
  it('grows as the answers arrive, and claims nothing before its inputs exist', () => {
    expect(deriveLine(derive('23:35', '06:25', null, null))).toBe('6h 50m in bed');
    expect(deriveLine(derive('23:35', '06:25', '15_30', 'few'))).toBe('6h 50m in bed · ≈6h 16m asleep · 92%');
    expect(deriveLine(null)).toBe('');
  });
});

describe('medianClock', () => {
  it('takes an ordinary median of waking times', () => {
    expect(medianClock(['06:00', '06:30', '07:00'], 0)).toBe('06:30');
  });

  it('does not land in the afternoon when bed times straddle midnight', () => {
    // THE BUG THIS EXISTS FOR: as raw minutes, 23:40 is 1420 and 00:20 is 20,
    // so a naive median of these three is 23:40 — or worse, with an even count,
    // somewhere around noon. The clock is circular; the rotation is the fix.
    expect(medianClock(['23:40', '00:20', '23:50'], 12)).toBe('23:50');
    expect(medianClock(['23:40', '00:20'], 12)).toBe('00:00');
  });

  it('averages the middle two on an even count', () => {
    expect(medianClock(['06:00', '06:30', '07:00', '07:30'], 0)).toBe('06:45');
  });

  it('is null with nothing to average', () => {
    expect(medianClock([], 0)).toBeNull();
    expect(medianClock(['nonsense'], 0)).toBeNull();
  });
});

describe('t12', () => {
  it('is 12-hour, always — never 19:30', () => {
    expect(t12('19:30')).toBe('7:30 PM');
    expect(t12('06:20')).toBe('6:20 AM');
    expect(t12('00:05')).toBe('12:05 AM');
    expect(t12('12:00')).toBe('12:00 PM');
  });
});

describe('wordFor', () => {
  it('names the value, because a bare position means nothing half-awake', () => {
    expect(wordFor('valence', 1)).toBe('bleak');
    expect(wordFor('arousal', 5)).toBe('wired');
    expect(wordFor('restedness', 1)).toBe('wrung out');
  });

  it('says nothing when there is no value', () => {
    expect(wordFor('valence', null)).toBe('');
    expect(wordFor('valence', 0)).toBe('');
  });

  it('keeps every word short enough for a 390px row', () => {
    // "overwhelming" was the honest word for the top of the intensity scale and
    // it did not fit — it widened the card and was sheared off by the zone's
    // `overflow: hidden`, silently. Nothing here may creep back over that.
    for (const [field, words] of Object.entries({
      sleep_quality: 5,
      restedness: 5,
      valence: 5,
      arousal: 5,
      dream_intensity: 5,
    })) {
      for (let n = 1; n <= words; n++) {
        expect(wordFor(field as never, n).length, `${field}[${n}] is too long for the row`).toBeLessThanOrEqual(11);
      }
    }
  });
});

describe('hasAnswers', () => {
  const empty = {
    bed_at: null,
    woke_at: null,
    sleep_latency: null,
    awakenings: null,
    sleep_quality: null,
    restedness: null,
    valence: null,
    arousal: null,
    dream_recall: null,
    dream_intensity: null,
    dream_body: null,
    note: null,
  } as never;

  it('is false for a row with nothing in it', () => {
    expect(hasAnswers(null)).toBe(false);
    expect(hasAnswers(empty)).toBe(false);
  });

  it('is true for ANY single answer — an unfinished check-in is a check-in', () => {
    // This is not a completeness test and must never become one. There is no
    // "2 of 7 fields" meter in this feature by design.
    expect(hasAnswers({ ...(empty as object), valence: 2 } as never)).toBe(true);
    expect(hasAnswers({ ...(empty as object), dream_recall: 'none' } as never)).toBe(true);
    expect(hasAnswers({ ...(empty as object), note: 'a line' } as never)).toBe(true);
  });
});
