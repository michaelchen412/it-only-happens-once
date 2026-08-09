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
//
// ⚠ POINT 2 WAS NOT ACTUALLY TESTED HERE UNTIL 2026-08-09 (27 · §4), despite
// this header having claimed it since the file was written. The function that
// decides it — `bedDate` — was module-private inside `src/actions/checkin.ts`,
// so the header described an intention the file could not carry out. The
// arithmetic moved to `lib/hq/checkin.ts` and the three describes at the foot
// of this file are what the header was always promising.
import { describe, expect, it } from 'vitest';
import {
  bedDate,
  derive,
  deriveLine,
  duringNight,
  hasAnswers,
  hm,
  instants,
  medianClock,
  t12,
  wordFor,
} from '../lib/hq/checkin';
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

/** The old positional call, kept readable now that `derive` takes an object. */
const night = (
  bed: string | null,
  woke: string | null,
  latency: Parameters<typeof derive>[0]['latency'] = null,
  awakenings: Parameters<typeof derive>[0]['awakenings'] = null,
  rest: Partial<Parameters<typeof derive>[0]> = {},
) => derive({ bed, woke, latency, awakenings, ...rest });

describe('derive', () => {
  it('wraps past midnight, which is the normal case and not the edge one', () => {
    const d = night('23:35', '06:25')!;
    expect(d.inBed).toBe(410); // 6h50m, not minus seventeen hours
    expect(hm(d.inBed)).toBe('6h 50m');
  });

  it('handles a night that does not cross midnight', () => {
    expect(night('01:30', '08:00')!.inBed).toBe(390);
  });

  it('refuses to estimate sleep until both buckets are answered', () => {
    // An efficiency that silently assumed "fell asleep instantly, never woke"
    // would be a number he did not give, presented as one he did.
    expect(night('23:35', '06:25')).toMatchObject({ asleep: null, efficiency: null });
    expect(night('23:35', '06:25', 'under_15', null)).toMatchObject({ asleep: null, efficiency: null });
  });

  it('estimates from the bucket midpoints once both are in', () => {
    const d = night('23:35', '06:25', '15_30', 'few')!;
    expect(d.asleep).toBe(410 - 22 - 12);
    expect(d.efficiency).toBe(92);
  });

  it('is null without both times', () => {
    expect(night(null, '06:25')).toBeNull();
    expect(night('23:35', null)).toBeNull();
  });

  it('gives 0m for two identical times, not a 24-hour lie-in', () => {
    // Mid-edit with the same time in two pickers. `24h 00m` reads as a bug in
    // the instrument, which for three days is what it was.
    expect(night('07:00', '07:00')!.inBed).toBe(0);
  });
});

describe('derive · time in bed ends when you get OUT of bed', () => {
  // THE BUG THIS BLOCK EXISTS FOR: efficiency is asleep over time IN BED, so an
  // hour spent lying awake at 5am belongs in the denominator. With `woke` doing
  // both jobs it was erased or scored as sleep depending on which time got
  // typed — and an early waking is the signature the instrument watches for.
  it('puts the awake stretch in the denominator and nowhere else', () => {
    const d = night('23:00', '06:00', 'under_15', 'none', { gotUp: '07:00' })!;
    expect(d.inBed).toBe(480); // 23:00 → 07:00, not → 06:00
    expect(d.awakeInBed).toBe(60);
    expect(d.asleep).toBe(420 - 8); // the sleep window is still bed → woke
    expect(d.efficiency).toBe(86); // 412/480, not 412/420
  });

  it('is exactly the old behaviour when nobody says when they got up', () => {
    const before = night('23:00', '06:00', 'under_15', 'none')!;
    expect(before.inBed).toBe(420);
    expect(before.awakeInBed).toBe(0);
    expect(before.efficiency).toBe(98);
  });

  it('ignores getting up BEFORE waking rather than wrapping it', () => {
    // Impossible, so it is a typo — and wrapping a typo would turn one night
    // into thirty-one hours in bed, which is a worse answer than no answer.
    const d = night('23:00', '07:00', null, null, { gotUp: '06:30' })!;
    expect(d.inBed).toBe(480);
    expect(d.awakeInBed).toBe(0);
  });
});

describe('derive · the open-ended bucket has a ceiling, and asleepAt lifts it', () => {
  // Michael's night, 2026-08-05: in bed at midnight, awake until three.
  it('no longer scores three hours awake as an hour and a quarter', () => {
    const bucketOnly = night('00:00', '07:00', 'over_60', 'none')!;
    expect(bucketOnly.asleep).toBe(420 - 75); // the midpoint, and it is a ceiling
    expect(bucketOnly.efficiency).toBe(82); // ~25 points too kind

    const measured = night('00:00', '07:00', 'over_60', 'none', { asleepAt: '03:00' })!;
    expect(measured.asleep).toBe(240);
    expect(measured.efficiency).toBe(57);
  });

  it('measures across midnight, which is the case it exists for', () => {
    const d = night('23:30', '07:00', 'over_60', 'none', { asleepAt: '02:30' })!;
    expect(d.asleep).toBe(450 - 180);
  });

  it('falls back to the bucket rather than producing a negative night', () => {
    // Outside bed → woke it is a mis-entry, and the bucket is still an answer.
    expect(night('00:00', '07:00', 'over_60', 'none', { asleepAt: '09:00' })!.asleep).toBe(420 - 75);
    expect(night('00:00', '07:00', 'over_60', 'none', { asleepAt: '00:00' })!.asleep).toBe(420 - 75);
  });

  it('still needs both buckets before it claims anything', () => {
    expect(night('00:00', '07:00', 'over_60', null, { asleepAt: '03:00' })).toMatchObject({ asleep: null });
  });
});

describe('derive · a timed waking, because `many` is a ceiling too', () => {
  // ⚠ THE NIGHT THIS WHOLE BLOCK EXISTS FOR (Michael, 2026-08-06): *"I fell
  // asleep for three hours, I was awake for three hours, and I went to bed again
  // and only slept two hours."* It was not representable at all — `many` carried
  // thirty minutes, so the record said ≈7h 15m at 83% about a 5h 00m night.
  const broken = { bed: '23:00', woke: '07:30', latency: '30_60', awakenings: 'many' } as const;

  it('scored a three-hour waking as thirty minutes, and no longer does', () => {
    const bucketOnly = derive({ ...broken, gotUp: '07:45' })!;
    expect(bucketOnly.asleep).toBe(435); // 7h 15m — 510 less the two midpoints
    expect(bucketOnly.efficiency).toBe(83);

    const measured = derive({
      ...broken,
      gotUp: '07:45',
      wakings: [{ woke: '02:30', backAsleep: '05:30', leftBed: false }],
    })!;
    expect(measured.waso).toBe(180);
    expect(measured.wasoMeasured).toBe(true);
    expect(measured.asleep).toBe(285); // 4h 45m, which is the truth
    expect(measured.efficiency).toBe(54); // twenty-nine points, on the CBT-I number
  });

  it('takes the excursion OUT of the denominator when the bed was left', () => {
    // CBT-I stimulus control tells you to get out of bed. Until 2026-08-06,
    // doing as instructed scored exactly the same as lying there ignoring it.
    const stayed = derive({
      ...broken,
      gotUp: '07:45',
      wakings: [{ woke: '02:30', backAsleep: '05:30', leftBed: false }],
    })!;
    const left = derive({
      ...broken,
      gotUp: '07:45',
      wakings: [{ woke: '02:30', backAsleep: '05:30', leftBed: true }],
    })!;

    expect(stayed.asleep).toBe(left.asleep); // the same 4h 45m either way
    expect(stayed.inBed).toBe(525);
    expect(left.inBed).toBe(345); // the three hours are not time in bed
    expect(left.outOfBed).toBe(180);
    expect(left.efficiency).toBe(83);
    expect(stayed.efficiency).toBe(54);
  });

  it('REPLACES the bucket rather than adding to it', () => {
    // Both are estimates of the same quantity. Summing them would double-count
    // the very waking that was worth timing.
    const d = derive({ ...broken, wakings: [{ woke: '02:00', backAsleep: '02:20', leftBed: false }] })!;
    expect(d.waso).toBe(20); // not 20 + 30
  });

  it('sums several wakings, and wraps the ones past midnight', () => {
    const d = derive({
      ...broken,
      wakings: [
        { woke: '23:50', backAsleep: '00:10', leftBed: false },
        { woke: '04:00', backAsleep: '04:30', leftBed: false },
      ],
    })!;
    expect(d.waso).toBe(50);
  });

  it('drops a half-typed or impossible waking rather than believing it', () => {
    // Saves-as-you-go means a row exists before both its times do, and `span`
    // wraps — so a waking typed backwards would otherwise swallow the night.
    const half = derive({ ...broken, wakings: [{ woke: '02:00', backAsleep: null, leftBed: false }] })!;
    expect(half.wasoMeasured).toBe(false);
    expect(half.waso).toBe(30); // back to the bucket, which is still an answer

    const backwards = derive({ ...broken, wakings: [{ woke: '05:00', backAsleep: '02:00', leftBed: false }] })!;
    expect(backwards.wasoMeasured).toBe(false);
  });
});

describe('derive · naps are counted and kept out of the night', () => {
  it('never touches efficiency, which is a claim about one night in one bed', () => {
    const plain = night('23:00', '07:00', 'under_15', 'none')!;
    const napped = night('23:00', '07:00', 'under_15', 'none', { naps: [{ start: '14:00', end: '14:45' }] })!;
    expect(napped.napped).toBe(45);
    expect(napped.efficiency).toBe(plain.efficiency);
    expect(napped.asleep).toBe(plain.asleep);
  });

  it('survives a night nobody filled in — a nap arrives hours later', () => {
    const d = derive({
      bed: null,
      woke: null,
      latency: null,
      awakenings: null,
      naps: [{ start: '14:00', end: '15:30' }],
    })!;
    expect(d.hasNight).toBe(false);
    expect(d.napped).toBe(90);
    expect(deriveLine(d)).toBe('1h 30m napped');
  });

  it('counts one that ran past midnight, and drops a mis-entered marathon', () => {
    expect(night('23:00', '07:00', null, null, { naps: [{ start: '23:30', end: '00:15' }] })!.napped).toBe(45);
    expect(night('23:00', '07:00', null, null, { naps: [{ start: '09:00', end: '08:00' }] })!.napped).toBe(0);
  });
});

describe('deriveLine', () => {
  it('grows as the answers arrive, and claims nothing before its inputs exist', () => {
    expect(deriveLine(night('23:35', '06:25'))).toBe('6h 50m in bed');
    expect(deriveLine(night('23:35', '06:25', '15_30', 'few'))).toBe('6h 50m in bed · ≈6h 16m asleep · 92%');
    expect(deriveLine(null)).toBe('');
  });

  it('puts the nap at the end, outside the sum it is not part of', () => {
    const line = deriveLine(night('23:35', '06:25', '15_30', 'few', { naps: [{ start: '14:00', end: '14:30' }] }));
    expect(line).toBe('6h 50m in bed · ≈6h 16m asleep · 92% · +30m napped');
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
    got_up_at: null,
    asleep_at: null,
    sleep_latency: null,
    awakenings: null,
    sleep_quality: null,
    restedness: null,
    valence: null,
    arousal: null,
    dreamless: null,
    dream_body: null,
    sleep_aids: null,
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
    expect(hasAnswers({ ...(empty as object), dreamless: true } as never)).toBe(true);
    expect(hasAnswers({ ...(empty as object), note: 'a line' } as never)).toBe(true);
  });

  it('sees a check-in whose only answer was a dream, WITHOUT a join', () => {
    // The dream question is first on the card, so "tapped Anxious and put the
    // phone down" is the likeliest half-finished state there is — and the
    // attention badge runs this in middleware on every request. `dreamless`
    // carries a redundant `false` for exactly this, and nothing else.
    expect(hasAnswers({ ...(empty as object), dreamless: false } as never)).toBe(true);
  });

  it('counts an answered "nothing taken", which is not the same as unasked', () => {
    // `'{}'` is a tap and `null` is a hole. Reading an empty answer as "took
    // nothing" would invent the control group the column depends on.
    expect(hasAnswers({ ...(empty as object), sleep_aids: [] } as never)).toBe(true);
  });
});

// ── which night a wall clock belongs to (27 · §4) ──────────────────────────
//
// The three functions the check-in writes its timestamps with. Every case below
// is a night that actually happens, and each one is wrong in a way that reads as
// plausible on screen: an off-by-one day here does not look like a bug, it looks
// like a seventeen-hour lie-in or a nap at the wrong end of the day.

describe('bedDate', () => {
  it('dates an evening bedtime to the night BEFORE the morning being logged', () => {
    // The ordinary night, and the whole reason this function exists. The row is
    // about waking up on the 9th; 23:35 belongs to the 8th.
    expect(bedDate('2026-08-09', '23:35', '06:25')).toBe('2026-08-08');
  });

  it('keeps an after-midnight bedtime on the log date itself', () => {
    // Asleep at 01:30, up at 08:00 — one morning, no wrap. Shifting this back a
    // day would put the night before the evening it started.
    expect(bedDate('2026-08-09', '01:30', '08:00')).toBe('2026-08-09');
  });

  it('⚠ uses the WAKE time as the pivot, not a fixed hour', () => {
    // The case a "before noon means today" shortcut gets wrong. A 14:00 bedtime
    // with an 18:00 wake is a nap-shaped night that never crossed midnight, and
    // it must stay on the log date; the same 14:00 against an 09:00 wake did.
    expect(bedDate('2026-08-09', '14:00', '18:00')).toBe('2026-08-09');
    expect(bedDate('2026-08-09', '14:00', '09:00')).toBe('2026-08-08');
  });

  it('treats equal times as the same day rather than wrapping', () => {
    // `>` and not `>=`: a mid-edit row with the same value in both pickers must
    // not silently jump a day underneath the person typing.
    expect(bedDate('2026-08-09', '07:00', '07:00')).toBe('2026-08-09');
  });

  it('falls back to noon when there is no wake time yet', () => {
    // A half-filled check-in is a check-in. With nothing to compare against,
    // an evening bedtime is the night before and a morning one is not — dating
    // 23:35 to the evening OF the logged day would place it in the future.
    expect(bedDate('2026-08-09', '23:35', null)).toBe('2026-08-08');
    expect(bedDate('2026-08-09', '01:30', undefined)).toBe('2026-08-09');
    expect(bedDate('2026-08-09', '12:01', null)).toBe('2026-08-08');
    expect(bedDate('2026-08-09', '12:00', null)).toBe('2026-08-09');
  });

  it('crosses a month boundary, and a year one', () => {
    expect(bedDate('2026-09-01', '23:35', '06:25')).toBe('2026-08-31');
    expect(bedDate('2026-01-01', '23:35', '06:25')).toBe('2025-12-31');
    // And a leap day, which is the one a naive `-1` on the date string breaks.
    expect(bedDate('2028-03-01', '23:35', '06:25')).toBe('2028-02-29');
  });
});

describe('duringNight', () => {
  it('puts a time after bedtime on bedtime’s own date', () => {
    // 23:50, from a 23:30 bedtime on the 8th — still the 8th.
    expect(duringNight('2026-08-08', '23:30', '23:50', LA)).toBe('2026-08-09T06:50:00.000Z');
  });

  it('puts a time past midnight on the FOLLOWING date', () => {
    // 02:30 from that same 23:30 bedtime is the 9th, not the 8th. This is the
    // waking these columns exist to record, and dating it to the 8th would put
    // it 21 hours before the bedtime it happened after.
    expect(duringNight('2026-08-08', '23:30', '02:30', LA)).toBe('2026-08-09T09:30:00.000Z');
  });

  it('does not wrap when the night began after midnight', () => {
    // From a 00:15 bedtime, 05:00 is still the same date — the comparison is
    // against the bedtime, never against midnight.
    expect(duringNight('2026-08-09', '00:15', '05:00', LA)).toBe('2026-08-09T12:00:00.000Z');
  });

  it('is null without a night to sit inside', () => {
    // A time inside a night with no beginning is not a fact about anything, and
    // the action filters these out rather than writing an empty row.
    expect(duringNight(null, '23:30', '02:30', LA)).toBeNull();
    expect(duringNight('2026-08-08', null, '02:30', LA)).toBeNull();
    expect(duringNight('2026-08-08', undefined, '02:30', LA)).toBeNull();
  });

  it('resolves in the configured zone, on the date it actually happened', () => {
    // LA is UTC-8 in January and UTC-7 in August. A single stored offset would
    // put every winter waking an hour out, silently, for months.
    expect(duringNight('2026-01-15', '23:30', '02:30', LA)).toBe('2026-01-16T10:30:00.000Z');
  });
});

describe('instants', () => {
  it('resolves a whole ordinary night', () => {
    const t = instants('2026-08-09', '23:35', '06:25', '06:40', null, LA);
    // Bed on the 8th; everything else on the morning of the 9th.
    expect(t.bed_at).toBe('2026-08-09T06:35:00.000Z');
    expect(t.woke_at).toBe('2026-08-09T13:25:00.000Z');
    expect(t.got_up_at).toBe('2026-08-09T13:40:00.000Z');
    expect(t.asleep_at).toBeNull();
  });

  it('⚠ pins waking and getting up to the LOG DATE, never to bedtime’s', () => {
    // The asymmetry worth stating: `bed_at` can move a day, `woke_at` and
    // `got_up_at` cannot. You get out of bed on the morning you woke up on, and
    // a pair straddling midnight is not representable in this model at all.
    const t = instants('2026-08-09', '23:35', '00:30', '00:45', null, LA);
    expect(t.bed_at).toBe('2026-08-09T06:35:00.000Z'); // the 8th, local
    expect(t.woke_at).toBe('2026-08-09T07:30:00.000Z'); // the 9th, local
    expect(t.got_up_at).toBe('2026-08-09T07:45:00.000Z');
  });

  it('anchors “asleep at” inside the night, wrapping past midnight', () => {
    // The refinement `over_60` asks for. From a 23:35 bedtime, 00:50 is the
    // next date — an hour and a quarter of lying awake, not a 23-hour one.
    const t = instants('2026-08-09', '23:35', '06:25', null, '00:50', LA);
    expect(t.asleep_at).toBe('2026-08-09T07:50:00.000Z');
  });

  it('leaves every unanswered field null, and never invents a bed date', () => {
    // Half-filled is legal. With no bedtime there is no night to hang anything
    // off, so `asleep_at` is null even though a time was given.
    const t = instants('2026-08-09', null, '06:25', null, '00:50', LA);
    expect(t.bed_at).toBeNull();
    expect(t.asleep_at).toBeNull();
    expect(t.got_up_at).toBeNull();
    expect(t.woke_at).toBe('2026-08-09T13:25:00.000Z');

    expect(instants('2026-08-09', null, null, null, null, LA)).toEqual({
      bed_at: null,
      woke_at: null,
      got_up_at: null,
      asleep_at: null,
    });
  });

  it('survives the night the clocks go back', () => {
    // 1 November 2026 in LA: 01:00–02:00 happens twice. A bedtime of 23:35 on
    // the 31st and a wake of 06:25 must still resolve to one instant each,
    // inside the day, rather than to something an hour outside it.
    const t = instants('2026-11-01', '23:35', '06:25', null, null, LA);
    expect(t.bed_at).toBe('2026-11-01T06:35:00.000Z'); // 31 Oct 23:35 PDT
    expect(t.woke_at).toBe('2026-11-01T14:25:00.000Z'); // 1 Nov 06:25 PST
    // ⚠ AND THE EXTRA HOUR IS REALLY IN THERE. 23:35 → 06:25 is 6h50m on the
    // clock, but 7h50m actually elapsed, because 01:00–02:00 happened twice.
    // Storing full instants is what makes that recoverable; two wall-clock
    // strings could never express it, and the night would score an hour short.
    const clockHours = 6 + 50 / 60;
    const realHours = (Date.parse(t.woke_at!) - Date.parse(t.bed_at!)) / 3_600_000;
    expect(realHours).toBeCloseTo(clockHours + 1, 10);
  });
});
