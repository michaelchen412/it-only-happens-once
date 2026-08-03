// ============================================================================
// Tasks (docs/plans/13-agenda.md §3, §3a, §4; ADR-0013).
//
// Four actions, because there are four motions: writing a task down, answering
// for one, taking that answer back, and throwing the task away. All run on
// `ctx.locals.supabase`, the caller's session client, so RLS does the real
// work — this layer validates, converts, and holds the one rule the database
// cannot: what a disposition does to the schedule.
//
// ⚠ THE RRULE IS BUILT HERE, NEVER SENT. The editor posts which PRESET it
// picked; `rruleFor` turns that into the stored string. So `tasks.recur_rrule`
// can only ever hold a rule the expander is known to understand, which is what
// makes storing the standard string safe without shipping a full RFC 5545
// parser to the browser (src/lib/hq/recurrence.ts).
//
// ⚠ AND `dispose` IS WHERE ADR-0013 IS ACTUALLY ENFORCED. It writes exactly one
// row and moves exactly one date. Nothing here can create a second occurrence,
// which is why forty-seven overdue rows cannot exist to be rendered on a bad
// morning.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fail, requireAdmin, type DB } from './_shared';
import { homeTimezone, localToday, parseYmd } from '../lib/hq/time';
import { PRESETS, rruleFor } from '../lib/hq/recurrence';
import { advance } from '../lib/hq/tasks';

const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);

const ymd = z.preprocess(blankToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').optional());
/** `<input type="time">` gives HH:MM, and some browsers add :SS. */
const hhmm = z.preprocess(blankToUndef, z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM').optional());
const optCount = z.preprocess(blankToUndef, z.coerce.number().int().optional());

const input = z.object({
  /** Absent on create. */
  id: z.preprocess(blankToUndef, z.string().uuid().optional()),
  title: z.string().trim().min(1, 'A task needs a name.').max(300),
  notes: z.preprocess(blankToUndef, z.string().max(20_000).optional()),
  dueOn: ymd,
  dueTime: hhmm,
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  effort: z.enum(['quick', 'sitting', 'block', 'project']).default('sitting'),
  /** Blank = derive from effort. Set = the override that always wins (§3a). */
  leadDays: optCount,
  repeat: z.enum(['none', 'after', 'fixed']).default('none'),
  /** `after` only. */
  every: optCount,
  unit: z.enum(['days', 'weeks', 'months']).optional(),
  /** `fixed` only — a preset key, never a rule string. */
  preset: z.enum(PRESETS as unknown as [string, ...string[]]).optional(),
  /** Optional, and blank is a real answer — "belongs to no goal" (§4a). */
  goalId: z.preprocess(blankToUndef, z.string().uuid().optional()),
});

type Input = z.infer<typeof input>;

/**
 * The four recurrence columns, from what the editor chose.
 *
 * The database CHECK refuses a half-filled recurrence, so this function's job
 * is to make sure the refusal never has to happen: every branch writes the
 * complete shape or clears all four.
 */
interface RecurrenceColumns {
  recur_mode: 'after_completion' | 'fixed' | null;
  recur_rrule: string | null;
  recur_every: number | null;
  recur_unit: 'days' | 'weeks' | 'months' | null;
}

function recurrenceOf(v: Input, dueOn: string | null): RecurrenceColumns {
  const cleared = { recur_mode: null, recur_rrule: null, recur_every: null, recur_unit: null } as const;
  if (v.repeat === 'none') return { ...cleared };

  // Both modes need something to repeat FROM. Said here as a sentence rather
  // than left to the constraint, which would arrive as a Postgres error.
  if (!dueOn) throw fail('A repeating task needs a date to repeat from.', 'BAD_REQUEST');

  if (v.repeat === 'after') {
    const every = v.every ?? 2;
    if (every < 1 || every > 366) throw fail('Repeat every 1 to 366.', 'BAD_REQUEST');
    return { recur_mode: 'after_completion' as const, recur_rrule: null, recur_every: every, recur_unit: v.unit ?? 'weeks' };
  }

  const preset = v.preset ?? 'weekly';
  return {
    recur_mode: 'fixed' as const,
    // Rebuilt from the date every save, so the rule and its anchor can never
    // drift apart: move a weekly chore to a Thursday and it becomes a Thursday
    // rule, rather than a Monday rule quietly attached to a Thursday.
    recur_rrule: rruleFor(preset as (typeof PRESETS)[number], dueOn),
    recur_every: null,
    recur_unit: null,
  };
}

/** Read the columns a disposition needs, or say the task is gone. */
async function loadTask(sb: DB, id: string) {
  const { data, error } = await sb
    .from('tasks')
    .select('id, due_on, recur_mode, recur_rrule, recur_every, recur_unit')
    .eq('id', id)
    .maybeSingle();
  if (error) throw fail(error.message);
  if (!data) throw fail('That task is gone.', 'NOT_FOUND');
  return data;
}

export const tasks = {
  /** Write a task down, or change it. */
  save: defineAction({
    accept: 'json',
    input,
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      const dueOn = v.dueOn ? parseYmd(v.dueOn) : null;
      if (v.dueOn && !dueOn) throw fail('That isn’t a real date.', 'BAD_REQUEST');
      // A time on no particular day is not a time anybody can act on, and the
      // constraint would refuse it anyway.
      const dueTime = dueOn ? (v.dueTime?.slice(0, 5) ?? null) : null;

      const values = {
        title: v.title,
        notes: v.notes ?? null,
        due_on: dueOn,
        due_time: dueTime,
        priority: v.priority,
        effort: v.effort,
        lead_days: v.leadDays ?? null,
        goal_id: v.goalId ?? null,
        ...recurrenceOf(v, dueOn),
      };

      if (v.id) {
        const { data, error } = await sb.from('tasks').update(values).eq('id', v.id).select('id').single();
        if (error) throw fail(error.message);
        return data;
      }

      const { data, error } = await sb.from('tasks').insert(values).select('id').single();
      if (error) throw fail(error.message);
      return data;
    },
  }),

  /**
   * Did it / Skipping it — the one tap that answers for an occurrence (§4).
   *
   * BOTH OUTCOMES ARE RECORDED, and both advance the schedule. A skip is an
   * answer, never inferred from silence: a day the app was not opened must stay
   * distinguishable from a day the chore was deliberately let go, or the
   * adherence signal the whole mechanism exists to produce is corrupt.
   *
   * A recurring task moves to its next occurrence; a one-off is archived, so it
   * leaves the room tomorrow while its row in the log keeps the record.
   */
  dispose: defineAction({
    accept: 'json',
    input: z.object({
      id: z.string().uuid(),
      outcome: z.enum(['done', 'skipped']),
    }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      const task = await loadTask(sb, v.id);
      const today = localToday(await homeTimezone(sb));

      // One answer per day. Without this a double-tap on a slow connection
      // writes two rows and advances the schedule twice — silently, and by
      // exactly the amount that makes a fortnightly chore look monthly.
      const { data: already, error: dupErr } = await sb
        .from('task_events')
        .select('id')
        .eq('task_id', v.id)
        .eq('occurred_on', today)
        .limit(1);
      if (dupErr) throw fail(dupErr.message);
      if (already?.length) throw fail('You’ve already answered for this one today.', 'CONFLICT');

      const { data: event, error } = await sb
        .from('task_events')
        .insert({ task_id: v.id, occurred_on: today, for_due_on: task.due_on, outcome: v.outcome })
        .select('id')
        .single();
      if (error) throw fail(error.message);

      const next = advance(task, task.due_on, today);
      const { error: moveErr } = await sb
        .from('tasks')
        .update(next ? { due_on: next } : { archived_at: new Date().toISOString() })
        .eq('id', v.id);
      if (moveErr) throw fail(moveErr.message);

      return { id: v.id, eventId: event.id, nextDueOn: next, archived: !next };
    },
  }),

  /**
   * Take today's answer back — the second press of the same control (10-hq.md
   * §10f: a ticked task stays visible and the same click undoes it).
   *
   * ⚠ THE OCCURRENCE IS READ OFF THE EVENT, never recomputed. Running the rule
   * backwards would be arithmetic that can disagree with what actually
   * happened; `for_due_on` cannot. It also means undo works on a task whose
   * rule has been edited since.
   *
   * Only TODAY's answer is undoable. Yesterday's is history — reopening it
   * would mean the log could be rewritten from a list, which is the one thing
   * that would make the adherence signal untrustworthy.
   */
  undo: defineAction({
    accept: 'json',
    input: z.object({ id: z.string().uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const today = localToday(await homeTimezone(sb));

      const { data: events, error } = await sb
        .from('task_events')
        .select('id, for_due_on')
        .eq('task_id', v.id)
        .eq('occurred_on', today)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw fail(error.message);
      const event = events?.[0];
      if (!event) throw fail('There’s nothing to take back.', 'NOT_FOUND');

      const { error: delErr } = await sb.from('task_events').delete().eq('id', event.id);
      if (delErr) throw fail(delErr.message);

      const { error: restoreErr } = await sb
        .from('tasks')
        .update({ due_on: event.for_due_on, archived_at: null })
        .eq('id', v.id);
      if (restoreErr) throw fail(restoreErr.message);

      return { id: v.id, dueOn: event.for_due_on };
    },
  }),

  /**
   * Throw it away.
   *
   * A hard delete, and the dispositions go with it by cascade. There is no
   * trash tier here for the same reason `interactions` has none: a task is
   * private, unreferenced, and only ever deleted because it should not exist —
   * keeping it in a drawer would mean the export and the nightly backup carry
   * it for ever, which is the opposite of what deleting it was for.
   */
  remove: defineAction({
    accept: 'json',
    input: z.object({ id: z.string().uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const { error } = await sb.from('tasks').delete().eq('id', v.id);
      if (error) throw fail(error.message);
      return { id: v.id };
    },
  }),
};
