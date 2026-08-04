// The morning check-in (docs/plans/11-checkin.md §5, ADR-0012).
//
// ONE ACTION, BECAUSE THERE IS ONE MOTION. The check-in is not a form that gets
// submitted — it is one row per local date, upserted as you go. The phone
// captures times and ratings at 7am; the desktop appends the dream text at 9am;
// both are `save`, both hit the same row. `skipped` is the same call with one
// field set, because "not today" is an answer, not the absence of one.
//
// THE CLIENT SENDS THE WHOLE FORM EVERY TIME, and it must: a merge-only patch
// could never clear a field you had changed your mind about. The consequence,
// stated rather than discovered — two devices editing the same date at once is
// last-write-wins. For one person and one date that is the honest trade; if it
// ever isn't, the fix is a version column, not a smarter merge.
//
// Runs on `ctx.locals.supabase`, the caller's session client, so RLS is doing
// the real work. This layer validates and converts; it is not the boundary.
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fail, requireAdmin, type DB } from './_shared';
import { BACKFILL_DAYS } from '../lib/hq/checkin';
import { homeTimezone, localToday, parseYmd, shiftYmd, zonedTimeToUtc, type Ymd } from '../lib/hq/time';

/** A 1–5 mark, or explicitly cleared. */
const mark = z.coerce.number().int().min(1).max(5).nullable().optional();
/** `HH:MM` off a native time input, or cleared. */
const clock = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Expected HH:MM')
  .nullable()
  .optional();
const text = z.string().max(20_000).nullable().optional();

const input = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bed: clock,
  woke: clock,
  sleepLatency: z.enum(['under_15', '15_30', '30_60', 'over_60']).nullable().optional(),
  awakenings: z.enum(['none', 'few', 'many']).nullable().optional(),
  sleepQuality: mark,
  restedness: mark,
  valence: mark,
  arousal: mark,
  dreamRecall: z.enum(['none', 'neutral', 'anxious', 'distressing']).nullable().optional(),
  dreamIntensity: mark,
  dreamBody: text,
  note: text,
  skipped: z.boolean().optional(),
});

/**
 * The backfill window, enforced HERE and not only in the interface.
 *
 * §5 is explicit that three days is a **data-quality** limit: sleep and affect
 * recalled a week later is invention, and an invented row is worse than an
 * absent one because the trend cannot tell them apart. A rule that only lives
 * in a rendered form is a rule that the next surface to write this table will
 * not know about — so the write path owns it.
 *
 * Navigating to any date stays free. Only writing is bounded.
 */
function assertWritable(logDate: Ymd, today: Ymd): void {
  if (logDate > today) throw fail('You can’t check in for a day that hasn’t happened.', 'BAD_REQUEST');
  const earliest = shiftYmd(today, -BACKFILL_DAYS);
  if (logDate < earliest) {
    throw fail(`Check-ins can only be filled in for the last ${BACKFILL_DAYS} days.`, 'BAD_REQUEST');
  }
}

/**
 * The two wall-clock times as real instants.
 *
 * **Which DAY was bedtime?** `log_date` is the date you WOKE UP on, so a bed
 * time later in the clock than the wake time belongs to the day before — 23:35
 * → 06:25 is last night, not a seventeen-hour lie-in. A bed time earlier than
 * the wake time is the same morning (asleep at 1:30, up at 8). That single
 * comparison is the whole cross-midnight rule, and storing full timestamps is
 * what stops every later reader having to redo it.
 */
function bedDate(logDate: Ymd, bed: string, woke: string | null | undefined): Ymd {
  // With a wake time, the comparison IS the rule.
  if (woke) return bed > woke ? shiftYmd(logDate, -1) : logDate;
  // Without one — a half-filled check-in, which is allowed — fall back to the
  // usual case: an evening bedtime belongs to the night before. Dating a 23:35
  // bedtime to the evening OF the day being logged would place it in the
  // future, on a row about a morning that has already happened.
  return bed > '12:00' ? shiftYmd(logDate, -1) : logDate;
}

function instants(logDate: Ymd, bed: string | null | undefined, woke: string | null | undefined, tz: string) {
  return {
    bed_at: bed ? zonedTimeToUtc(bedDate(logDate, bed, woke), bed, tz).toISOString() : null,
    woke_at: woke ? zonedTimeToUtc(logDate, woke, tz).toISOString() : null,
  };
}

async function upsert(sb: DB, values: Record<string, unknown>) {
  const { data, error } = await sb
    .from('daily_checkins')
    .upsert(values as never, { onConflict: 'log_date' })
    .select()
    .single();
  if (error) throw fail(error.message);
  return data;
}

export const checkin = {
  /**
   * Create or update the row for one local date.
   *
   * Every field is optional and every field is nullable, because a half-filled
   * check-in is a check-in (§5). Nothing here computes "complete" and nothing
   * ever should — there is no progress meter in this feature by design.
   */
  save: defineAction({
    input,
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const tz = await homeTimezone(sb);

      const logDate = parseYmd(v.logDate);
      if (!logDate) throw fail('That isn’t a real date.', 'BAD_REQUEST');
      assertWritable(logDate, localToday(tz));

      // Intensity and the dream text cannot outlive the dream they describe —
      // the same rule the table's CHECK constraint enforces, applied here so a
      // change of mind clears them instead of failing the write.
      const noDream = v.dreamRecall === 'none' || v.dreamRecall === null;

      return upsert(sb, {
        log_date: logDate,
        ...instants(logDate, v.bed, v.woke, tz),
        sleep_latency: v.sleepLatency ?? null,
        awakenings: v.awakenings ?? null,
        sleep_quality: v.sleepQuality ?? null,
        restedness: v.restedness ?? null,
        valence: v.valence ?? null,
        arousal: v.arousal ?? null,
        dream_recall: v.dreamRecall ?? null,
        dream_intensity: noDream ? null : (v.dreamIntensity ?? null),
        dream_body: noDream ? null : v.dreamBody || null,
        note: v.note || null,
        skipped: v.skipped ?? false,
      });
    },
  }),

  /**
   * "Not today" — an answer, recorded.
   *
   * Its own action rather than a flag on `save`, because it is reached from the
   * prompt where no form exists yet, and because it must never wipe answers
   * already given: skipping a day you had started should be undoable back to
   * what you wrote, not to nothing.
   */
  setSkipped: defineAction({
    input: z.object({ logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), skipped: z.boolean() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const tz = await homeTimezone(sb);

      const logDate = parseYmd(v.logDate);
      if (!logDate) throw fail('That isn’t a real date.', 'BAD_REQUEST');
      assertWritable(logDate, localToday(tz));

      return upsert(sb, { log_date: logDate, skipped: v.skipped });
    },
  }),
};
