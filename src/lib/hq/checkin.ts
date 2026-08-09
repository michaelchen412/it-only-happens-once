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
import { shiftYmd, zonedTimeToUtc, type Ymd } from './time';

export type DreamRecall = Database['public']['Enums']['dream_recall'];
export type SleepLatency = Database['public']['Enums']['sleep_latency'];
export type Awakenings = Database['public']['Enums']['awakenings'];
export type SleepAid = Database['public']['Enums']['sleep_aid'];
export type Checkin = Database['public']['Tables']['daily_checkins']['Row'];

/** A dream tone — `none` is the *absence* of one, and lives on `dreamless`. */
export type DreamTone = Exclude<DreamRecall, 'none'>;

/**
 * One tone's dream, as the card holds it. **One row per tone, not per dream**
 * (Michael, 2026-08-06: *"no need for separately recordable for now — enough to
 * summarize by the average of that type"*), which is why the tone is the key
 * and nothing here carries an id or an ordinal.
 */
export interface DreamEntry {
  tone: DreamTone;
  intensity: number | null;
  wokeYou: boolean;
  recurring: boolean;
}

/** One timed waking inside the night, as wall-clock times. */
export interface WakingEntry {
  woke: string | null;
  backAsleep: string | null;
  /** Got *out* of bed — which takes the stretch out of the denominator. */
  leftBed: boolean;
}

/** One daytime sleep on the log date. */
export interface NapEntry {
  start: string | null;
  end: string | null;
}

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

/** The fields that have a word beside their marks. */
export type MarkField = keyof typeof WORDS;

/**
 * The marks that are COLUMNS ON THE ROW — every `MarkField` except
 * `dream_intensity`, which belongs to a `checkin_dreams` entry rather than to
 * `daily_checkins`.
 *
 * ⚠ THE DISTINCTION IS LOAD-BEARING and it was found by the compiler, not by
 * reading: `STARS`/`TRACKS` were `as const` inside a component, so `row[field]`
 * narrowed to real columns by accident. Annotating them `MarkField` on the way
 * out widened it to include `dream_intensity` and TypeScript correctly refused
 * to index a row with a column that does not exist. Naming the narrower set
 * keeps the annotation honest instead of reaching for a cast.
 */
export type RowMarkField = Extract<MarkField, keyof Checkin>;

export function wordFor(field: MarkField, value: number | null): string {
  return value && value >= 1 && value <= 5 ? WORDS[field][value - 1] : '';
}

/**
 * The four 1–5 marks of "How it went", in the two pairs they are asked in.
 *
 * ⚠ TWO PAIRS, FOUR FIELDS, AND NONE OF THEM MERGE. Quality and Rested are two
 * columns because eight solid hours that leave you wrung out is the signature
 * this instrument exists to catch. Feeling and Energy are two axes because
 * "calm but hollow" and "wired and afraid" are different mornings calling for
 * different responses. They share a block and a control, never a column.
 *
 * `summaryLabel` differs from `label` on purpose: the form asks "Quality" under
 * a "Sleep" sub-heading, while the summary has no heading to lean on and must
 * say "Sleep" itself.
 *
 * Here rather than in a component because BOTH panels need them — the form
 * draws the controls and the summary reads them back. They lived in
 * CheckinZone.astro until the panels were split out (2026-08-07), at which
 * point the only alternative was declaring them twice and hoping.
 */
export const STARS: { field: RowMarkField; key: string; label: string; summaryLabel: string }[] = [
  { field: 'sleep_quality', key: 'sleep', label: 'Quality', summaryLabel: 'Sleep' },
  { field: 'restedness', key: 'rested', label: 'Rested', summaryLabel: 'Rested' },
];
export const TRACKS: { field: RowMarkField; key: string; label: string; hint: string }[] = [
  { field: 'valence', key: 'valence', label: 'Feeling', hint: '1 unpleasant ↔ 5 pleasant' },
  { field: 'arousal', key: 'arousal', label: 'Energy', hint: '1 calm ↔ 5 activated' },
];

/**
 * The dream taxonomy. `none` IS ONE TAP AND IS REAL DATA, not a hole — recall
 * decays within minutes of waking, so the commonest honest answer must be the
 * cheapest to give.
 *
 * The tone is the one place a rest-zone element borrows the urgency axis, and
 * it earns it: a distressing night is the signal the whole instrument exists to
 * catch, so it must not read as violet like everything around it.
 *
 * ⚠ THE FOUR VALUES ARE UNCHANGED SINCE 2026-08-01 and are still settled. What
 * changed on 2026-08-06 is that the three tones stopped being MUTUALLY
 * EXCLUSIVE: a night can carry an anxious dream and a distressing one, each
 * with its own strength. That is a change to how many answers fit, not to what
 * the answers mean — which is exactly why it was affordable, and why the
 * original warning about re-shaping collected categorical data still stands.
 */
export const DREAMS: { key: DreamRecall; label: string; tone: string; icon: string }[] = [
  { key: 'none', label: 'Nothing', tone: 'u-none', icon: 'ph:moon' },
  { key: 'neutral', label: 'Just a dream', tone: 'u-info', icon: 'ph:moon' },
  { key: 'anxious', label: 'Anxious', tone: 'u-warn', icon: 'ph:warning' },
  { key: 'distressing', label: 'Distressing', tone: 'u-now', icon: 'ph:warning' },
];

/** The same list without `none`, which is an answer rather than a tone. */
export const DREAM_TONES = DREAMS.filter((d) => d.key !== 'none') as {
  key: DreamTone;
  label: string;
  tone: string;
  icon: string;
}[];

/**
 * The two facts about a dream that are worth one tap each.
 *
 * **`wokeYou` is the clinically load-bearing one.** Plan 11 opened by naming an
 * uncertainty — *"anxiety dreams most nights, not quite nightmares"* — and
 * waking *from* the dream is the line between the two. Until 2026-08-06 the
 * instrument could not answer the question it was built around.
 *
 * `recurring` is what a therapist asks about next, and it is free to give.
 */
export const DREAM_FLAGS = [
  { key: 'wokeYou', label: 'Woke me', icon: 'ph:eye' },
  { key: 'recurring', label: 'Had it before', icon: 'ph:arrow-counter-clockwise' },
] as const;

/**
 * What was taken to help sleep.
 *
 * ⚠ THE ONE NEW TAXONOMY on this card, and therefore the expensive part of the
 * 2026-08-06 change — cheap to re-draw today and never again. Alcohol is in the
 * list deliberately: it is not a medication, but the Consensus Sleep Diary
 * counts whatever was taken *to help you sleep* including alcohol, and as a
 * confounder of both latency and 3am wakings it outweighs most of the rest.
 *
 * **Nothing is a tap, not an absence** — the same rule as the dream row and as
 * `skipped`. An empty answer read as "took nothing" would silently invent the
 * control group every correlation over this column depends on, so `'{}'` is a
 * recorded "nothing tonight" and `null` is a question nobody answered.
 */
export const AIDS: { key: SleepAid; label: string }[] = [
  { key: 'melatonin', label: 'Melatonin' },
  { key: 'antihistamine', label: 'Antihistamine' },
  { key: 'prescription', label: 'Prescription' },
  { key: 'cannabis', label: 'Cannabis' },
  { key: 'alcohol', label: 'Alcohol' },
  { key: 'other', label: 'Something else' },
];

/**
 * Buckets, not numbers: a minute count is a guess at 7am.
 *
 * ⚠ THE ARGUMENT INVERTS AT THE TOP OF THE SCALE, and that was a real bug for
 * three days. Nobody knows whether it was twelve minutes or twenty — but
 * everybody knows when it was three hours. `over_60` is open-ended, so its
 * midpoint is a CEILING rather than a middle: a night awake until 3am was
 * estimated at an hour and a quarter, and the efficiency came out about
 * twenty-five points high, on the one number CBT-I actually moves.
 *
 * The bucket is still the answer. `asleep_at` (below, and only on this bucket)
 * is the refinement offered when it cannot be one — see `derive`.
 */
export const LATENCIES: { key: SleepLatency; label: string; midpoint: number }[] = [
  { key: 'under_15', label: '< 15m', midpoint: 8 },
  { key: '15_30', label: '15–30', midpoint: 22 },
  { key: '30_60', label: '30–60', midpoint: 45 },
  { key: 'over_60', label: '60m +', midpoint: 75 },
];

/** The one bucket that asks a second question, because it cannot answer it. */
export const OPEN_ENDED_LATENCY: SleepLatency = 'over_60';

/**
 * Same reason. Nobody knows the count.
 *
 * ⚠ AND THE SAME INVERSION AT THE TOP, unnoticed here for three days after it
 * was fixed for latency. `many` carries 30 minutes, so a night broken by three
 * hours awake — bed 23:00, three hours asleep, three awake from 02:30, two more,
 * woke 07:30 and up at 07:45 — derived ≈7h 15m at 83% against a truth of 4h 45m
 * at 54%. Twenty-nine points, on the one number CBT-I moves, for exactly the
 * reason `over_60` was twenty-five points out.
 *
 * The buckets are still the answer, and the midpoints below are still the right
 * guess when there is nothing better. A TIMED WAKING is the refinement offered
 * when there is — see `derive`.
 */
export const WAKINGS: { key: Awakenings; label: string; midpoint: number }[] = [
  { key: 'none', label: 'Not at all', midpoint: 0 },
  { key: 'few', label: 'A few', midpoint: 12 },
  { key: 'many', label: 'Many', midpoint: 30 },
];

/** The buckets a timed waking can refine. `none` has nothing to time. */
export const TIMEABLE_WAKINGS: Awakenings[] = ['few', 'many'];

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

/** `HH:MM` as minutes since midnight, or null if it is not a clock time. */
function clockMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
}

/**
 * Minutes from one wall clock to another, WRAPPING PAST MIDNIGHT — which is the
 * normal case here rather than the edge one: 23:35 → 06:25 is 6h50m, not minus
 * seventeen hours. This is the same fact `bed_at` being a full timestamp
 * encodes in the database.
 *
 * Equal times are zero, not a full day. Somebody mid-edit with the same time in
 * two pickers should see `0m`, not `24h 00m` — an absurd number reads as a bug
 * in the instrument, and it briefly was one.
 */
export function span(from: string, to: string): number | null {
  const a = clockMinutes(from);
  const b = clockMinutes(to);
  if (a === null || b === null) return null;
  const d = b - a;
  return d < 0 ? d + 1440 : d;
}

// ── wall clocks → instants ─────────────────────────────────────────────────
//
// ⚠ THESE THREE LIVED IN `src/actions/checkin.ts` UNTIL 2026-08-09, unexported
// and therefore untestable, which is the only reason the cross-midnight rule
// below had no assertions on it while the rest of this file's arithmetic had
// thirty. Nothing about them was ever action-shaped: they take strings and a
// zone and return strings, they touch no client, and they throw nothing. They
// are here now for the reason this file's header already gave — one
// implementation, and vitest checks it.

/**
 * The date a bedtime belongs to.
 *
 * **Which DAY was bedtime?** `log_date` is the date you WOKE UP on, so a bed
 * time later in the clock than the wake time belongs to the day before — 23:35
 * → 06:25 is last night, not a seventeen-hour lie-in. A bed time earlier than
 * the wake time is the same morning (asleep at 1:30, up at 8). That single
 * comparison is the whole cross-midnight rule, and storing full timestamps is
 * what stops every later reader having to redo it.
 */
export function bedDate(logDate: Ymd, bed: string, woke: string | null | undefined): Ymd {
  // With a wake time, the comparison IS the rule.
  if (woke) return bed > woke ? shiftYmd(logDate, -1) : logDate;
  // Without one — a half-filled check-in, which is allowed — fall back to the
  // usual case: an evening bedtime belongs to the night before. Dating a 23:35
  // bedtime to the evening OF the day being logged would place it in the
  // future, on a row about a morning that has already happened.
  return bed > '12:00' ? shiftYmd(logDate, -1) : logDate;
}

/**
 * A wall-clock time that happened somewhere inside one night, as an instant.
 *
 * Everything after getting into bed belongs to bedtime's date — unless the
 * clock has come round past midnight in between, which is exactly the nights
 * these fields exist for. That is the same single comparison `bedDate` makes,
 * applied one step later: from a 23:30 bedtime, 02:30 is the following date and
 * 23:50 is the same one; from a 00:15 bedtime, 05:00 is still the same one.
 *
 * Needs a bedtime, because a time inside a night with no beginning is not a
 * fact about anything.
 */
export function duringNight(bedDay: Ymd | null, bed: string | null | undefined, at: string, tz: string): string | null {
  if (!bedDay || !bed) return null;
  return zonedTimeToUtc(at >= bed ? bedDay : shiftYmd(bedDay, 1), at, tz).toISOString();
}

/** The four stored instants a night's wall clocks resolve to. */
export function instants(
  logDate: Ymd,
  bed: string | null | undefined,
  woke: string | null | undefined,
  gotUp: string | null | undefined,
  asleepAt: string | null | undefined,
  tz: string,
) {
  const bedDay = bed ? bedDate(logDate, bed, woke) : null;
  return {
    bed_at: bed && bedDay ? zonedTimeToUtc(bedDay, bed, tz).toISOString() : null,
    woke_at: woke ? zonedTimeToUtc(logDate, woke, tz).toISOString() : null,

    // You get out of bed on the morning you woke up on. There is no comparison
    // to make here and no wrinkle to handle: a wake-and-rise pair straddling
    // midnight is not representable in this model at all, because `woke_at` is
    // already pinned to `log_date` by the same reasoning.
    got_up_at: gotUp ? zonedTimeToUtc(logDate, gotUp, tz).toISOString() : null,

    asleep_at: asleepAt ? duringNight(bedDay, bed, asleepAt, tz) : null,
  };
}

/** Everything the night's arithmetic reads, as wall-clock times. */
export interface Night {
  bed: string | null;
  woke: string | null;
  latency: SleepLatency | null;
  awakenings: Awakenings | null;
  gotUp?: string | null;
  asleepAt?: string | null;
  /** Timed wakings, which refine the `awakenings` bucket rather than replace it. */
  wakings?: WakingEntry[];
  /** Daytime sleep. Counted separately and NEVER inside the night's efficiency. */
  naps?: NapEntry[];
}

export interface Derived {
  /** Minutes between getting into bed and getting OUT of it, less excursions. */
  inBed: number;
  /** Of those, the minutes spent awake after the final waking. Zero if unsaid. */
  awakeInBed: number;
  /** Minutes of the night spent out of bed entirely. Not in either side. */
  outOfBed: number;
  /** Minutes awake between falling asleep and the final waking. */
  waso: number | null;
  /** Were those minutes measured, or taken from the bucket's midpoint? */
  wasoMeasured: boolean;
  /** Estimated minutes actually asleep — null until both buckets are answered. */
  asleep: number | null;
  /** Sleep efficiency as a percentage, null on the same condition. */
  efficiency: number | null;
  /** Daytime sleep, in minutes. Zero when there was none. */
  napped: number;
  /** Are there two times to reason about? False on a nap-only day. */
  hasNight: boolean;
}

/**
 * A wall-clock span that has to fall INSIDE the night to be believed.
 *
 * `span` wraps past midnight, which is right for a night and wrong for the
 * pieces of one: a waking mis-typed backwards (05:00 → 02:00) wraps to
 * twenty-one hours and would swallow the whole record. Anything that does not
 * fit inside the night it belongs to is a mis-entry, and a mis-entry is dropped
 * quietly rather than propagated — the same posture `asleepAt` has taken since
 * 2026-08-05.
 */
function within(from: string | null, to: string | null, night: number): number | null {
  if (!from || !to) return null;
  const d = span(from, to);
  return d !== null && d > 0 && d < night ? d : null;
}

/**
 * The live payback, from the wall-clock times, the two buckets and the pieces.
 *
 * **TIME IN BED ENDS WHEN YOU GET OUT OF BED**, not when you wake. Efficiency
 * is asleep-over-in-bed, so the hour spent lying there at 5am belongs in the
 * denominator and nowhere else. `woke_at` used to do both jobs, which meant
 * that stretch was either erased or counted as sleep depending on which time
 * got typed — and an early-morning awakening is the exact signature this
 * instrument exists to catch. `gotUp` is optional and null means "I got up when
 * I woke", which is what every row written before 2026-08-05 assumed.
 *
 * A `gotUp` EARLIER than `woke` is not wrapped, it is ignored. Getting up
 * before you woke is impossible, so it is a mis-entry, and wrapping it would
 * turn one typo into a thirty-one-hour night.
 *
 * `asleepAt` OVERRIDES THE TOP BUCKET'S MIDPOINT, because that midpoint is a
 * ceiling rather than a middle — see `LATENCIES`. It is used only when it lands
 * between getting into bed and waking up; outside that it is a mis-entry and
 * the bucket wins, quietly, rather than producing a negative night.
 *
 * **A TIMED WAKING REPLACES THE BUCKET'S MIDPOINT OUTRIGHT** (2026-08-06), and
 * does not add to it. Both are estimates of the *same* quantity — total minutes
 * awake after sleep onset — so summing them would double-count the very waking
 * that was worth timing. The same rule `asleepAt` follows one line above, and
 * for the same reason: a measurement and a guess at one quantity is not a
 * better guess, it is the measurement.
 *
 * **GETTING OUT OF BED LEAVES THE DENOMINATOR.** CBT-I stimulus control tells
 * you to leave the bed when you cannot sleep; before this existed, obeying it
 * scored identically to lying there ignoring it, because the excursion sat in
 * time-in-bed either way. Now the same three hours read 87% if you got up and
 * 57% if you did not — which is the difference the protocol is trying to make.
 *
 * Naps are summed and returned, and they touch NOTHING else. Efficiency is a
 * statement about one night in one bed; folding an afternoon into it would make
 * the one number that moves under CBT-I mean something new every day.
 *
 * `asleep` and `efficiency` stay null until BOTH buckets are in. Showing an
 * efficiency that silently assumed "fell asleep instantly, never woke" would be
 * a number the person did not give, presented as one they did.
 */
export function derive(n: Night): Derived | null {
  const napped = (n.naps ?? []).reduce((sum, nap) => {
    const d = nap.start && nap.end ? span(nap.start, nap.end) : null;
    // A nap is bounded by the day, not by the night, so `within` does not apply
    // — but a nap longer than half a day is a mis-entry by any reading.
    return sum + (d !== null && d > 0 && d <= 720 ? d : 0);
  }, 0);

  // A NAP SURVIVES A NIGHT THAT WAS NEVER FILLED IN. Naps are added in the
  // afternoon, hours after the card was closed, so "no times yet" is a state a
  // nap can genuinely arrive into — and a total that silently vanished because
  // its neighbour was blank is the kind of quiet loss this feature refuses.
  const night = n.bed && n.woke ? span(n.bed, n.woke) : null;
  if (night === null) {
    if (napped === 0) return null;
    return {
      inBed: 0,
      awakeInBed: 0,
      outOfBed: 0,
      waso: null,
      wasoMeasured: false,
      asleep: null,
      efficiency: null,
      napped,
      hasNight: false,
    };
  }

  const wokeMin = clockMinutes(n.woke!);
  const upMin = n.gotUp ? clockMinutes(n.gotUp) : null;
  const awakeInBed = upMin !== null && wokeMin !== null && upMin > wokeMin ? upMin - wokeMin : 0;

  // Only the wakings that land inside the night are believed, and only those
  // marked `leftBed` come back out of the denominator.
  const timed = (n.wakings ?? [])
    .map((w) => ({ minutes: within(w.woke, w.backAsleep, night), leftBed: w.leftBed }))
    .filter((w): w is { minutes: number; leftBed: boolean } => w.minutes !== null);
  const outOfBed = timed.reduce((sum, w) => sum + (w.leftBed ? w.minutes : 0), 0);
  const inBed = Math.max(0, night + awakeInBed - outOfBed);

  const bucket = LATENCIES.find((l) => l.key === n.latency)?.midpoint;
  const wake = WAKINGS.find((w) => w.key === n.awakenings)?.midpoint;
  if (bucket === undefined || wake === undefined) {
    return {
      inBed,
      awakeInBed,
      outOfBed,
      waso: null,
      wasoMeasured: false,
      asleep: null,
      efficiency: null,
      napped,
      hasNight: true,
    };
  }

  const measuredLatency = n.asleepAt ? within(n.bed, n.asleepAt, night) : null;
  const lat = measuredLatency ?? bucket;

  const wasoMeasured = timed.length > 0;
  const waso = wasoMeasured ? timed.reduce((sum, w) => sum + w.minutes, 0) : wake;

  const asleep = Math.max(0, night - lat - waso);
  return {
    inBed,
    awakeInBed,
    outOfBed,
    waso,
    wasoMeasured,
    asleep,
    efficiency: inBed ? Math.round((asleep / inBed) * 100) : null,
    napped,
    hasNight: true,
  };
}

/**
 * The one line the check-in gives back on day one.
 *
 * It GROWS as you answer — time in bed the moment both times exist, then the
 * estimate and the efficiency once the buckets are in. Nothing is claimed
 * before its inputs exist, and the `≈` is honest about what the estimate is.
 * (The trend view is held until there is real data to shape it against, so
 * until then this line is the entire payoff.)
 *
 * The nap rides on the END of the line and never inside the `≈…asleep · NN%`
 * cluster, because it is not part of that sum and must not read as though it
 * were.
 */
export function deriveLine(d: Derived | null): string {
  if (!d) return '';
  const parts: string[] = [];
  if (d.hasNight) {
    parts.push(`${hm(d.inBed)} in bed`);
    if (d.asleep !== null) parts.push(`≈${hm(d.asleep)} asleep`, `${d.efficiency}%`);
  }
  if (d.napped > 0) parts.push(d.hasNight ? `+${hm(d.napped)} napped` : `${hm(d.napped)} napped`);
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

  const mid =
    mins.length % 2 ? mins[(mins.length - 1) / 2] : Math.round((mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2);
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
 *
 * ⚠ IT READS THE PARENT ROW ONLY, and that is why `dreamless` carries a `false`
 * that a join could otherwise derive. The attention badge runs this in
 * middleware on every request, and the dream question is the FIRST thing on the
 * card — so "tapped Anxious, put the phone down" is the likeliest half-finished
 * state there is. Paying for a join on every request to notice it would be the
 * wrong trade; writing one boolean in the same save is the right one.
 */
export function hasAnswers(c: Checkin | null): boolean {
  if (!c) return false;
  return [
    c.bed_at,
    c.woke_at,
    c.got_up_at,
    c.asleep_at,
    c.sleep_latency,
    c.awakenings,
    c.sleep_quality,
    c.restedness,
    c.valence,
    c.arousal,
    c.dreamless,
    c.dream_body,
    c.sleep_aids,
    c.note,
  ].some((v) => v !== null && v !== '');
}
