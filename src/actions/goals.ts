// ============================================================================
// Goals (docs/plans/13-agenda.md §4a).
//
// Three actions: writing an intention down, moving it between the four
// statuses, and — rarely — deleting one outright. All run on the caller's
// session client, so RLS does the real work.
//
// ⚠ THE FIVE-ACTIVE CAP LIVES HERE, AND IT IS CHECKED IN TWO PLACES, not one.
// Creating a sixth active goal is the obvious case. Re-activating a paused one
// while five are already active is the SAME overflow and is the easy miss —
// it arrives by a different door, from a control that looks like a toggle
// rather than a creation. §4a caps goals harder than constellations because
// they are about attention, and a cap that can be walked around is not a cap.
//
// The cap is not a constraint in the schema on purpose: a partial unique index
// cannot express "at most five", and a trigger that refused the sixth would
// fail at the database, where the error cannot be a sentence.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fail, requireAdmin, type DB } from './_shared';
import { ACTIVE_CAP, goalSlug } from '../lib/hq/goals';

const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);

const input = z.object({
  /** Absent on create. */
  id: z.preprocess(blankToUndef, z.string().uuid().optional()),
  name: z.string().trim().min(1, 'A goal needs a name.').max(200),
  /** Markdown: what this is actually for. */
  why: z.preprocess(blankToUndef, z.string().max(10_000).optional()),
  horizon: z.enum(['this_season', 'this_year', 'next_few_years']).default('this_year'),
  status: z.enum(['active', 'paused', 'achieved', 'let_go']).default('active'),
});

/**
 * A slug nobody else is using.
 *
 * Its own function rather than `_shared`'s `uniqueSlug`, which is bound to
 * `fragments`: goals and fragments do not share a namespace, and nothing is
 * gained by pretending they do. Inactive goals still count — they keep their
 * address, so a link to something you let go still resolves.
 */
async function uniqueGoalSlug(sb: DB, base: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data, error } = await sb.from('goals').select('id').eq('slug', candidate).limit(1);
    if (error) throw fail(error.message);
    if (!data || data.length === 0) return candidate;
  }
  throw fail('Could not find a free URL for that name.');
}

/**
 * Refuse a sixth active goal, in a sentence rather than a constraint violation.
 *
 * `exclude` is the goal being changed, so re-saving one of the five active ones
 * does not count itself and refuse its own edit.
 */
async function assertRoomToActivate(sb: DB, exclude?: string): Promise<void> {
  let q = sb.from('goals').select('id', { count: 'exact', head: true }).eq('status', 'active');
  if (exclude) q = q.neq('id', exclude);
  const { count, error } = await q;
  if (error) throw fail(error.message);
  if ((count ?? 0) >= ACTIVE_CAP) {
    throw fail(
      `Five active goals is the cap. Pause one, let one go, or mark one achieved first.`,
      'BAD_REQUEST',
    );
  }
}

export const goals = {
  /** Write an intention down, or change what it says. */
  save: defineAction({
    accept: 'json',
    input,
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      const values = { name: v.name, why: v.why ?? null, horizon: v.horizon, status: v.status };

      if (v.id) {
        if (v.status === 'active') await assertRoomToActivate(sb, v.id);
        const { data, error } = await sb.from('goals').update(values).eq('id', v.id).select('id, slug').single();
        if (error) throw fail(error.message);
        return data;
      }

      if (v.status === 'active') await assertRoomToActivate(sb);
      // The slug is minted once, from the name, and never re-minted: renaming a
      // goal is ordinary and must not move its page.
      const slug = await uniqueGoalSlug(sb, goalSlug(v.name));
      const { data, error } = await sb.from('goals').insert({ ...values, slug }).select('id, slug').single();
      if (error) throw fail(error.message);
      return data;
    },
  }),

  /**
   * Move a goal between the four statuses — one tap, no dialog.
   *
   * ⚠ AND NO CONFIRM ON `let_go`, deliberately. It is reversible (press Active
   * again) and it destroys nothing: the tasks stay, and what you did toward it
   * stays done. A confirm in front of a reversible act charges a click for
   * nothing and, worse, dresses a dignified decision as a dangerous one.
   */
  setStatus: defineAction({
    accept: 'json',
    input: z.object({
      id: z.string().uuid(),
      status: z.enum(['active', 'paused', 'achieved', 'let_go']),
    }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      // The re-activation door onto the same cap.
      if (v.status === 'active') await assertRoomToActivate(sb, v.id);
      const { error } = await sb.from('goals').update({ status: v.status }).eq('id', v.id);
      if (error) throw fail(error.message);
      return { id: v.id, status: v.status };
    },
  }),

  /**
   * Delete one outright — for a goal written by mistake, not for one you have
   * finished with. `let_go` is the honest end of a goal you stopped wanting.
   *
   * ⚠ THE TASKS SURVIVE. `tasks.goal_id` is `on delete set null`, never
   * cascade: what you actually did stays done, and only the intention it was
   * filed under goes.
   */
  remove: defineAction({
    accept: 'json',
    input: z.object({ id: z.string().uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const { error } = await sb.from('goals').delete().eq('id', v.id);
      if (error) throw fail(error.message);
      return { id: v.id };
    },
  }),
};
