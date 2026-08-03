// ============================================================================
// The log (docs/plans/12-people.md §6, ADR-0012).
//
// Two actions, because there are two motions: writing an entry down and taking
// one back. Both run on `ctx.locals.supabase`, the caller's session client, so
// RLS is doing the real work — this layer validates and converts.
//
// THE SUBJECT IS ALWAYS A PARTICIPANT. Every entry is logged FROM somebody's
// profile, and that person is added to `interaction_people` here rather than
// being trusted to the form. An interaction has participants and no owner, so
// "the person whose page I was on" is not a column — it is simply the first
// name in the list, and forgetting to include it would file the entry against
// everyone except the person it was about.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fail, requireAdmin, type DB } from './_shared';
import { homeTimezone, localToday, parseYmd, type Ymd } from '../lib/hq/time';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const input = z.object({
  /** Absent on create. */
  id: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().uuid().optional()),
  /** Whose profile this was logged from. Always a participant. */
  personId: z.string().uuid(),
  /** Everyone else who was there. */
  withIds: z.array(z.string().uuid()).max(50).default([]),
  occurredOn: ymd,
  kind: z.enum(['hangout', 'call', 'message', 'gift', 'shared', 'note']).default('hangout'),
  body: z.string().trim().min(1, 'An entry needs some words.').max(20_000),
});

/**
 * You cannot log something that has not happened.
 *
 * ⚠ AND THERE IS NO BACKFILL LIMIT HERE, deliberately — this is NOT the
 * check-in's three-day window. That limit exists because sleep and affect
 * recalled a week later are invention, and an invented row poisons a trend that
 * cannot tell it from a real one. A dinner three months ago is not invention;
 * it is a memory, and the whole point of this table is to hold memories longer
 * than you can. Entering a year of history on the day you start is a *feature*.
 *
 * The future is different: an entry dated tomorrow would sit at the top of the
 * timeline claiming to be the last thing that happened, and — once Piece 4
 * lands — would reset a drift clock for contact that never occurred.
 */
function assertNotFuture(on: Ymd, today: Ymd): void {
  if (on > today) throw fail('You can’t log something that hasn’t happened yet.', 'BAD_REQUEST');
}

/**
 * Replace an interaction's participants.
 *
 * Delete-then-insert rather than a diff: the list is at most a handful of rows,
 * a diff is more code than it saves, and this way a participant removed in the
 * editor is genuinely gone rather than depending on the diff being right.
 */
async function setParticipants(sb: DB, interactionId: string, personIds: string[]): Promise<void> {
  const { error: delErr } = await sb.from('interaction_people').delete().eq('interaction_id', interactionId);
  if (delErr) throw fail(delErr.message);

  const rows = [...new Set(personIds)].map((person_id) => ({ interaction_id: interactionId, person_id }));
  const { error } = await sb.from('interaction_people').insert(rows);
  if (error) throw fail(error.message);
}

export const interactions = {
  /**
   * Write an entry down, or correct one.
   *
   * Correcting matters more here than almost anywhere else in the app: unlike a
   * person, an interaction has no archive to fall back on, and this is text you
   * will re-read in three years. A typo you cannot fix is a typo you inherit.
   */
  save: defineAction({
    accept: 'json',
    input,
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      const occurredOn = parseYmd(v.occurredOn);
      if (!occurredOn) throw fail('That isn’t a real date.', 'BAD_REQUEST');
      assertNotFuture(occurredOn, localToday(await homeTimezone(sb)));

      const values = { occurred_on: occurredOn, kind: v.kind, body: v.body };

      if (v.id) {
        const { data, error } = await sb.from('interactions').update(values).eq('id', v.id).select('id').single();
        if (error) throw fail(error.message);
        await setParticipants(sb, data.id, [v.personId, ...v.withIds]);
        return data;
      }

      const { data, error } = await sb.from('interactions').insert(values).select('id').single();
      if (error) throw fail(error.message);
      await setParticipants(sb, data.id, [v.personId, ...v.withIds]);
      return data;
    },
  }),

  /**
   * Take an entry back.
   *
   * A hard delete, and the participants go with it by cascade. There is no
   * soft-delete tier here on purpose: `fragments` has one because a published
   * essay has readers and a URL, while a log entry is private, unreferenced,
   * and only ever removed because it was wrong. Keeping a wrong entry in a
   * trash somewhere would mean the export and the nightly backup both carry it
   * forever, which is the opposite of what deleting it was for.
   */
  remove: defineAction({
    accept: 'json',
    input: z.object({ id: z.string().uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const { error } = await sb.from('interactions').delete().eq('id', v.id);
      if (error) throw fail(error.message);
      return { id: v.id };
    },
  }),
};
