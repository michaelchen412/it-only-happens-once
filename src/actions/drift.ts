// ============================================================================
// The two drift dismissals (docs/plans/12-people.md §8, ADR-0012).
//
// Their own namespace rather than a split across `people` and `interactions`,
// because they are ONE control with two buttons: they sit side by side on the
// same row, they answer the same question, and separating them by which table
// they happen to write would file them by implementation instead of by meaning.
//
// ⚠ WHAT DOES *NOT* RESET THE CLOCK, and this is the load-bearing half. §8:
// editing the person's record is NOT a dismissal.
//
//   "If fixing a typo in someone's phone number silences a one-year drift
//    warning, the feature has been defeated by the most trivial possible
//    action — and silently, so you would never know it happened."
//
// So there is no third action here, and `people.save` deliberately touches
// neither `drift_muted_until` nor the log. The clock resets on exactly two
// things, and both of them are below.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fail, requireAdmin, type DB } from './_shared';
import { homeTimezone, localToday } from '../lib/hq/time';
import { REACHED_OUT_BODY, mutedUntil } from '../lib/hq/drift';
import type { Person } from '../lib/hq/people';

async function load(sb: DB, id: string): Promise<Person> {
  const { data, error } = await sb.from('people').select('*').eq('id', id).maybeSingle<Person>();
  if (error) throw fail(error.message);
  if (!data) throw fail('That person no longer exists.', 'NOT_FOUND');
  return data;
}

export const drift = {
  /**
   * "Reached out" — you actually made contact. Resets the year.
   *
   * ⚠ THIS WRITES A REAL ROW IN `interactions`, and refuses the shortcut of a
   * `last_reached_out_on` column on `people`. That column would be a second
   * source of truth for "when did I last make contact" sitting beside the one
   * the whole workstream derives from, and data-model.md §7 is explicit that
   * derived data must not be stored twice. It would also be invisible: the
   * timeline would show nothing on the day you dismissed, and next year you
   * would have no idea why the clock had moved.
   *
   * The words are the system's, not yours, and that is the honest cost of a
   * one-tap dismissal (§8 calls it "a lightweight interaction"). The row is
   * editable and deletable like any other, so the way back is the same door.
   */
  reachedOut: defineAction({
    accept: 'json',
    input: z.object({ personId: z.uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const today = localToday(await homeTimezone(sb));

      const { data, error } = await sb
        .from('interactions')
        // `message` rather than `note`: `note` means a thought ABOUT somebody,
        // which would reset a contact clock without contact having happened.
        // A message is the likeliest way you actually reached out, and the kind
        // is one tap to correct if it was a call.
        .insert({ occurred_on: today, kind: 'message', body: REACHED_OUT_BODY })
        .select('id')
        .single();
      if (error) throw fail(error.message);

      const { error: linkErr } = await sb
        .from('interaction_people')
        .insert({ interaction_id: data.id, person_id: v.personId });
      if (linkErr) {
        // The interaction exists but belongs to nobody, which would leave an
        // orphan on no profile and in every export. Take it back rather than
        // reporting a failure that half happened.
        await sb.from('interactions').delete().eq('id', data.id);
        throw fail(linkErr.message);
      }
      return { id: data.id, occurredOn: today };
    },
  }),

  /**
   * "This is fine" — mute for another cadence.
   *
   * The count increments here even though nothing reads it yet: §8 wants a
   * longer cadence offered after the second mute, and at a one-year cadence
   * that cannot fire before 2028. Building the offer now would be building
   * against a rule nothing can exercise; not counting now would mean starting
   * from zero on the day it matters. See the migration for the full argument.
   */
  mute: defineAction({
    accept: 'json',
    input: z.object({ personId: z.uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const person = await load(sb, v.personId);
      const today = localToday(await homeTimezone(sb));
      const until = mutedUntil(person, today);

      const { error } = await sb
        .from('people')
        .update({ drift_muted_until: until, drift_mutes: person.drift_mutes + 1 })
        .eq('id', v.personId);
      if (error) throw fail(error.message);
      return { until, mutes: person.drift_mutes + 1 };
    },
  }),
};
