// The check-in's vocabulary and its arithmetic (docs/plans/11-checkin.md §3).
//
// ONE IMPLEMENTATION, THREE READERS: the server renders the summary from these,
// the browser renders the live line from these, and vitest checks them. Two
// copies of "how long were you in bed" would eventually disagree, and the one
// that disagreed would be the one on screen at 7am.
//
// NOTHING DERIVED IS EVER STORED. Time in bed, estimated sleep and efficiency
// are computed from the columns every time they are shown, so they cannot drift
// from their own inputs — and efficiency in particular is the number that
// actually moves under CBT-I, which makes a stale copy of it worse than none.
import type { Database } from '../database.types';

export type DreamRecall = Database['public']['Enums']['dream_recall'];
export type SleepLatency = Database['public']['Enums']['sleep_latency'];
export type Awakenings = Database['public']['Enums']['awakenings'];
export type Checkin = Database['public']['Tables']['daily_checkins']['Row'];

/**
 * How far back a check-in may be filled in. **A data-quality limit, not a
 * convenience one:** sleep and affect recalled a week later is invention, and
 * invented rows are worse than absent ones because a trend cannot tell them
 * apart. Three days is also short enough that "catching up" is impossible by
 * construction, which is what keeps the promise that absence never accumulates.
 */
export const BACKFILL_DAYS = 3;

/**
 * The words beside the marks. Half-awake, a bare position on a track means
 * nothing — and the word is also how a mis-tap is noticed without re-reading
 * the whole scale. **Stars deliberately get no word**: five stars are
 * self-evident, and the two star rows already carry their own labels.
 *
 * KEEP THEM SHORT. At 390px the row has about 66px for one. The intensity
 * scale's honest top value was *"overwhelming"*, which was 68px, widened the
 * card, and was then sheared off by the zone's `overflow: hidden` — silently.
 * It became *"consuming"*. Shortening the word is the right fix; shrinking the
 * font or the tap targets to rescue one label makes every other row worse.
 */
export const WORDS = {
  sleep_quality: ['terrible', 'poor', 'ok', 'good', 'great'],
  restedness: ['wrung out', 'tired', 'ok', 'rested', 'sharp'],
  valence: ['bleak', 'low', 'even', 'good', 'bright'],
  arousal: ['sleepy', 'calm', 'steady', 'restless', 'wired'],
  dream_intensity: ['faint', 'mild', 'vivid', 'strong', 'consuming'],
} as const;

export function wordFor(field: keyof typeof WORDS, value: number | null): string {
  return value && value >= 1 && value <= 5 ? WORDS[field][value - 1] : '';
}

/**
 * The dream taxonomy. `none` IS ONE TAP AND IS REAL DATA, not a hole — recall
 * decays within minutes of waking, so the commonest honest answer must be the
 * cheapest to give.
 *
 * The tone is the one place a rest-zone element borrows the urgency axis, and
 * it earns it: a distressing night is the signal the whole instrument exists to
 * catch, so it must not read as violet like everything around it.
 */
export const DREAMS: { key: DreamRecall; label: string; tone: string; icon: string }[] = [
  { key: 'none', label: 'Nothing', tone: 'u-none', icon: 'ph:moon' },
  { key: 'neutral', label: 'Just a dream', tone: 'u-info', icon: 'ph:moon' },
  { key: 'anxious', label: 'Anxious', tone: 'u-warn', icon: 'ph:warning' },
  { key: 'distressing', label: 'Distressing', tone: 'u-now', icon: 'ph:warning' },
];

/** Buckets, not numbers: a minute count is a guess at 7am. */
export const LATENCIES: { key: SleepLatency; label: string; midpoint: number }[] = [
  { key: 'under_15', label: '< 15m', midpoint: 8 },
  { key: '15_30', label: '15–30', midpoint: 22 },
  { key: '30_60', label: '30–60', midpoint: 45 },
  { key: 'over_60', label: '60m +', midpoint: 75 },
];

/** Same reason. Nobody knows the count. */
export const WAKINGS: { key: Awakenings; label: string; midpoint: number }[] = [
  { key: 'none', label: 'Not at all', midpoint: 0 },
  { key: 'few', label: 'A few', midpoint: 12 },
  { key: 'many', label: 'Many', midpoint: 30 },
];

/** Used when there is no history to take a median from. */
export const DEFAULT_TIMES = { bed: '23:30', woke: '07:00' };

/** `6h 45m`, or `45m` under an hour. */
export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}

/** `7:30 PM` — 12-hour, always, per HQ's date register. */
export function t12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export interface Derived {
  /** Minutes between getting into bed and waking. */
  inBed: number;
  /** Estimated minutes actually asleep — null until both buckets are answered. */
  asleep: number | null;
  /** Sleep efficiency as a percentage, null on the same condition. */
  efficiency: number | null;
}

/**
 * The live payback, from two wall-clock times and the two buckets.
 *
 * `inBed` WRAPS PAST MIDNIGHT, which is the normal case rather than the edge
 * one: 23:35 → 06:25 is 6h50m, not minus seventeen hours. This is the same fact
 * `bed_at` being a full timestamp encodes in the database.
 *
 * `asleep` and `efficiency` stay null until BOTH buckets are in. Showing an
 * efficiency that silently assumed "fell asleep instantly, never woke" would be
 * a number the person did not give, presented as one they did.
 */
export function derive(
  bed: string | null,
  woke: string | null,
  latency: SleepLatency | null,
  awakenings: Awakenings | null,
): Derived | null {
  if (!bed || !woke) return null;
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = woke.split(':').map(Number);
  if ([bh, bm, wh, wm].some((n) => Number.isNaN(n))) return null;

  let inBed = wh * 60 + wm - (bh * 60 + bm);
  if (inBed <= 0) inBed += 1440;

  const lat = LATENCIES.find((l) => l.key === latency)?.midpoint;
  const wake = WAKINGS.find((w) => w.key === awakenings)?.midpoint;
  if (lat === undefined || wake === undefined) return { inBed, asleep: null, efficiency: null };

  const asleep = Math.max(0, inBed - lat - wake);
  return { inBed, asleep, efficiency: Math.round((asleep / inBed) * 100) };
}

/**
 * The one line the check-in gives back on day one.
 *
 * It GROWS as you answer — time in bed the moment both times exist, then the
 * estimate and the efficiency once the buckets are in. Nothing is claimed
 * before its inputs exist, and the `≈` is honest about what the estimate is.
 * (The trend view is held until there is real data to shape it against, so
 * until then this line is the entire payoff.)
 */
export function deriveLine(d: Derived | null): string {
  if (!d) return '';
  const parts = [`${hm(d.inBed)} in bed`];
  if (d.asleep !== null) parts.push(`≈${hm(d.asleep)} asleep`, `${d.efficiency}%`);
  return parts.join(' · ');
}

/**
 * The median of a set of `HH:MM` clock times.
 *
 * `rotateHours` exists because CLOCK TIME IS CIRCULAR and a naive median of bed
 * times is nonsense: 23:35 and 00:20 are forty-five minutes apart, but as raw
 * minutes they are 1415 and 20, and their median lands in the early afternoon.
 * Rotating the clock so the cluster sits in the middle of the range fixes it —
 * 12 for bedtimes (which straddle midnight), 0 for waking times (which do not).
 */
export function medianClock(times: string[], rotateHours: number): string | null {
  const rot = rotateHours * 60;
  const mins = times
    .map((t) => {
      const [h, m] = t.split(':').map(Number);
      return Number.isNaN(h) || Number.isNaN(m) ? null : (h * 60 + m + 1440 - rot) % 1440;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  if (!mins.length) return null;

  const mid = mins.length % 2 ? mins[(mins.length - 1) / 2] : Math.round((mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2);
  const back = (mid + rot) % 1440;
  return `${String(Math.floor(back / 60)).padStart(2, '0')}:${String(back % 60).padStart(2, '0')}`;
}

/**
 * Is there anything in this row at all?
 *
 * Resumable means an unfinished check-in is still a check-in, so "done" is not
 * a completeness test — there is no "2 of 7 fields" meter anywhere and there
 * must not be. This only distinguishes a row that was started from one that
 * exists for some other reason.
 */
export function hasAnswers(c: Checkin | null): boolean {
  if (!c) return false;
  return [
    c.bed_at,
    c.woke_at,
    c.sleep_latency,
    c.awakenings,
    c.sleep_quality,
    c.restedness,
    c.valence,
    c.arousal,
    c.dream_recall,
    c.dream_body,
    c.note,
  ].some((v) => v !== null && v !== '');
}
