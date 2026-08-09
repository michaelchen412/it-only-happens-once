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
// SINCE 2026-08-06 IT IS NOT ONE ROW. A night can hold several dream tones,
// several timed wakings and several naps, so `save` writes one parent row and
// then brings three child tables into line with the arrays it was sent — see
// `syncChildren`, which also states what a save dying halfway leaves behind.
//
// Runs on `ctx.locals.supabase`, the caller's session client, so RLS is doing
// the real work. This layer validates and converts; it is not the boundary.
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fail, requireAdmin, type DB } from './_shared';
// ⚠ `bedDate`, `duringNight` and `instants` live in `lib/hq/checkin.ts` since
// 2026-08-09 (27 · §4). They were private to this file and therefore had no
// tests, while being the exact cross-midnight arithmetic the check-in is most
// likely to be quietly wrong about — see `hq-checkin.test.ts`.
import { BACKFILL_DAYS, OPEN_ENDED_LATENCY, TIMEABLE_WAKINGS, bedDate, duringNight, instants } from '../lib/hq/checkin';
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

// The ceilings are backstops, not opinions about a night. Twelve wakings is
// already more than anybody times, and the point is only that a malformed
// payload cannot ask the database to insert ten thousand rows.
const dreams = z
  .array(
    z.object({
      tone: z.enum(['neutral', 'anxious', 'distressing']),
      intensity: mark,
      wokeYou: z.boolean().optional(),
      recurring: z.boolean().optional(),
    }),
  )
  .max(3)
  .optional();

const wakings = z
  .array(z.object({ woke: clock, backAsleep: clock, leftBed: z.boolean().optional() }))
  .max(12)
  .optional();

const naps = z
  .array(z.object({ start: clock, end: clock }))
  .max(6)
  .optional();

const input = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bed: clock,
  woke: clock,
  gotUp: clock,
  asleepAt: clock,
  sleepLatency: z.enum(['under_15', '15_30', '30_60', 'over_60']).nullable().optional(),
  awakenings: z.enum(['none', 'few', 'many']).nullable().optional(),
  wakings,
  sleepQuality: mark,
  restedness: mark,
  valence: mark,
  arousal: mark,
  // `true` is the "Nothing" tap and is real data; `null` is a question nobody
  // answered. `false` is not sent — the action derives it from `dreams`, so the
  // two can never disagree about whether there was a dream.
  dreamless: z.boolean().nullable().optional(),
  dreams,
  dreamBody: text,
  sleepAids: z
    .array(z.enum(['melatonin', 'antihistamine', 'prescription', 'cannabis', 'alcohol', 'other']))
    .nullable()
    .optional(),
  naps,
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

async function upsert(sb: DB, values: Record<string, unknown>) {
  const { data, error } = await sb
    .from('daily_checkins')
    .upsert(values as never, { onConflict: 'log_date' })
    .select()
    .single();
  if (error) throw fail(error.message);
  return data;
}

/**
 * The three child tables, brought into line with the payload.
 *
 * **THE WHOLE FORM EVERY TIME APPLIES HERE TOO** — a merge-only patch could
 * never remove the waking you decided you had imagined. So each table is made
 * to match the array it was sent, and anything not in that array is gone.
 *
 * `checkin_dreams` is UPSERTED and then trimmed, because `(checkin_id, tone)`
 * is a real key: re-saving the same night twice cannot duplicate a tone, and a
 * failure between the two statements leaves the tones intact. The other two
 * have surrogate ids and no natural key, so they are replaced wholesale.
 *
 * ⚠ NOT ONE TRANSACTION, stated rather than discovered — same posture as the
 * last-write-wins note above. A save that dies between statements can leave a
 * night whose wakings are gone while its parent row is current. Two things make
 * that survivable and neither is luck: the DOM is the source of truth, so the
 * next save rewrites all of it, and a failed save says so and keeps saying so.
 * If that ever stops being enough, the fix is one `security invoker` RPC taking
 * the whole payload — not a smarter merge out here.
 */
async function syncChildren(
  sb: DB,
  checkinId: string,
  children: {
    dreams: { tone: string; intensity: number | null; woke_you: boolean; recurring: boolean }[];
    wakings: { woke_at: string | null; back_asleep_at: string | null; left_bed: boolean }[];
    naps: { started_at: string | null; ended_at: string | null }[];
  },
) {
  const tones = children.dreams.map((d) => d.tone);

  const [dreamWrite, dreamTrim, wakingWipe, napWipe] = await Promise.all([
    children.dreams.length
      ? sb.from('checkin_dreams').upsert(children.dreams.map((d) => ({ ...d, checkin_id: checkinId })) as never, {
          onConflict: 'checkin_id,tone',
        })
      : Promise.resolve({ error: null }),
    // PostgREST needs a list even to say "none of them", hence the placeholder:
    // `in.()` is a syntax error, and `none` is the one value this column can
    // never hold (the table's CHECK forbids it).
    sb
      .from('checkin_dreams')
      .delete()
      .eq('checkin_id', checkinId)
      .not('tone', 'in', `(${(tones.length ? tones : ['none']).join(',')})`),
    sb.from('checkin_wakings').delete().eq('checkin_id', checkinId),
    sb.from('checkin_naps').delete().eq('checkin_id', checkinId),
  ]);

  for (const { error } of [dreamWrite, dreamTrim, wakingWipe, napWipe]) {
    if (error) throw fail(error.message);
  }

  const [wakings, naps] = await Promise.all([
    children.wakings.length
      ? sb.from('checkin_wakings').insert(children.wakings.map((w) => ({ ...w, checkin_id: checkinId })) as never)
      : Promise.resolve({ error: null }),
    children.naps.length
      ? sb.from('checkin_naps').insert(children.naps.map((n) => ({ ...n, checkin_id: checkinId })) as never)
      : Promise.resolve({ error: null }),
  ]);

  for (const { error } of [wakings, naps]) {
    if (error) throw fail(error.message);
  }
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

      // "Nothing" WINS OVER ANY TONE THAT ARRIVED WITH IT. The card makes the
      // two mutually exclusive, but this is the rule and the card is only one
      // way to reach it — and the state a contradictory payload should land in
      // is never ambiguous: the explicit answer beats the leftovers.
      const dreamt = v.dreamless === true ? [] : (v.dreams ?? []);

      // The one derived value written anywhere in this feature, and the reason
      // is in `hasAnswers`: the attention badge must be able to see a
      // dream-only check-in without a join. Written in the same call as the
      // rows it summarises, so the two cannot drift between requests.
      const dreamless = dreamt.length ? false : (v.dreamless ?? null);

      // The shared prose cannot outlive the answer that there was nothing to
      // describe — the same rule the table's CHECK enforces, applied here so a
      // change of mind clears it instead of failing the write.
      const dreamBody = dreamless === true ? null : v.dreamBody || null;

      // `asleep_at` refines the open-ended bucket and means nothing beside the
      // others — the table's CHECK says so too. Cleared here rather than left
      // to fail the write, so moving the answer down the scale is a change of
      // mind and not an error at 7am. Same shape as the dream fields above.
      const openEnded = v.sleepLatency === OPEN_ENDED_LATENCY;
      const times = instants(logDate, v.bed, v.woke, v.gotUp, openEnded ? v.asleepAt : null, tz);

      // And timed wakings refine the two buckets that admit one. Same rule,
      // one table over — where a CHECK cannot reach it, because a constraint
      // cannot see the parent row. THE ACTION OWNS THIS INVARIANT: if another
      // writer ever appears, it owns it too, and this comment is the notice.
      const bedDay = v.bed ? bedDate(logDate, v.bed, v.woke) : null;
      const timed = TIMEABLE_WAKINGS.includes(v.awakenings as never) ? (v.wakings ?? []) : [];

      const row = await upsert(sb, {
        log_date: logDate,
        ...times,
        sleep_latency: v.sleepLatency ?? null,
        awakenings: v.awakenings ?? null,
        sleep_quality: v.sleepQuality ?? null,
        restedness: v.restedness ?? null,
        valence: v.valence ?? null,
        arousal: v.arousal ?? null,
        dreamless,
        dream_body: dreamBody,
        // `null` is unanswered and `[]` is an answered "nothing tonight" — the
        // distinction the whole column depends on, so it is passed through
        // rather than normalised. See `AIDS` in lib/hq/checkin.ts.
        sleep_aids: v.sleepAids ?? null,
        note: v.note || null,
        skipped: v.skipped ?? false,
      });

      await syncChildren(sb, row.id, {
        dreams: dreamt.map((d) => ({
          tone: d.tone,
          intensity: d.intensity ?? null,
          woke_you: d.wokeYou ?? false,
          recurring: d.recurring ?? false,
        })),
        // A half-typed waking is legal in the table and is simply not a fact
        // yet — but a row with neither time is not a fact at all, and keeping
        // it would put an empty pair of pickers back on the card every reload.
        //
        // ⚠ FILTERED AFTER THE CONVERSION, not before, and that is the whole
        // point of the order. `duringNight` needs a bedtime to anchor to and
        // returns null without one, so a waking typed before "In bed" was
        // answered converts to two nulls — and filtering on the wall-clock
        // strings would have written that empty row anyway. Rare, because the
        // bed time arrives prefilled, and silent when it happens: an empty pair
        // of pickers coming back from a save that said "Saved".
        wakings: timed
          .map((w) => ({
            woke_at: w.woke ? duringNight(bedDay, v.bed, w.woke, tz) : null,
            back_asleep_at: w.backAsleep ? duringNight(bedDay, v.bed, w.backAsleep, tz) : null,
            left_bed: w.leftBed ?? false,
          }))
          .filter((w) => w.woke_at || w.back_asleep_at),
        // A nap is on the log date — the date you woke up on — and needs no
        // bedtime to anchor it. An end earlier on the clock than the start is
        // the one that ran past midnight.
        naps: (v.naps ?? [])
          .filter((n) => n.start || n.end)
          .map((n) => ({
            started_at: n.start ? zonedTimeToUtc(logDate, n.start, tz).toISOString() : null,
            ended_at: n.end
              ? zonedTimeToUtc(n.start && n.end < n.start ? shiftYmd(logDate, 1) : logDate, n.end, tz).toISOString()
              : null,
          })),
      });

      return row;
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
