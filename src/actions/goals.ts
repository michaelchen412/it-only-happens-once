// ============================================================================
// Goals (docs/plans/archive/13-agenda.md §4a).
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
import { blankToUndef, fail, optUuid, requireAdmin, uniqueSlug, type DB } from './_shared';
import { ACTIVE_CAP, goalSlug } from '../lib/hq/goals';

const input = z.object({
  /** Absent on create. */
  id: optUuid,
  name: z.string().trim().min(1, 'A goal needs a name.').max(200),
  /** Markdown: what this is actually for. */
  why: z.preprocess(blankToUndef, z.string().max(10_000).optional()),
  /**
   * Markdown: how the intention is actually kept — what is in the routine, what
   * to remember. **Prose, never a checklist**: it cannot be ticked, counted or
   * scheduled, and a line that wants any of those wants to be a task. See the
   * `goal_notes` migration.
   */
  notes: z.preprocess(blankToUndef, z.string().max(10_000).optional()),
  horizon: z.enum(['this_season', 'this_year', 'next_few_years']).default('this_year'),
  /*
    ⚠ NO `status` HERE, AND ITS ABSENCE IS THE DECISION (plan 41 · §5a).
    `setStatus` below is the ONLY writer of that column, and this schema must not
    grow one back.

    It used to be `z.enum([…]).default('active')`, fed by a segmented control in
    the sheet — which never worked (`cdfbced`: the script asked for
    `[data-goalStatus]`, the markup writes `data-goal-status`). So every save
    sent nothing and the default won, and EDITING A GOAL'S NOTES SET IT BACK TO
    ACTIVE. Fixing the selector made the control work and left a second, worse
    problem standing: two controls for one fact on one screen, the header's
    optimistic and the sheet's server-rendered, so changing the status and then
    opening the sheet showed the OLD value until a hard refresh. Michael,
    2026-08-15: *"I don't like how we have the same controls in two areas… it's
    not intuitive."*

    ⚠ AND DELETING THE CONTROL ALONE WOULD HAVE RESTORED THE BUG BY DESIGN. With
    the field gone from the form but still in this schema, Zod's default fires
    on every save and writes `active` again — `_shared.ts`'s standing warning
    that an action cannot tell "cleared" from "not sent". The field has to leave
    the schema, not just the markup.
  */
});

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
    throw fail(`Five active goals is the cap. Pause one, let one go, or mark one achieved first.`, 'BAD_REQUEST');
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

      const values = {
        name: v.name,
        why: v.why ?? null,
        notes: v.notes ?? null,
        horizon: v.horizon,
      };

      // ⚠ AN EDIT NEVER TOUCHES `status`. Not "writes the same value back" —
      // does not name the column at all, so there is no path from editing prose
      // to changing a standing.
      if (v.id) {
        const { data, error } = await sb.from('goals').update(values).eq('id', v.id).select('id, slug').single();
        if (error) throw fail(error.message);
        return data;
      }

      // ⚠ A NEW GOAL IS ACTIVE, and that is what makes it a goal rather than a
      // note about one — so the cap applies to creation, and only to creation.
      // Set here rather than defaulted through the schema, so the one place a
      // save writes a status is a line you can see.
      await assertRoomToActivate(sb);
      // The slug is minted once, from the name, and never re-minted: renaming a
      // goal is ordinary and must not move its page. Inactive goals still count
      // — they keep their address, so a link to something you let go resolves.
      const slug = await uniqueSlug(sb, 'goals', goalSlug(v.name));
      const { data, error } = await sb
        .from('goals')
        .insert({ ...values, slug, status: 'active' })
        .select('id, slug')
        .single();
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
      id: z.uuid(),
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
   * Keep one goal's notes on the Morning card — or take it off again.
   *
   * ⚠ ONE SLOT, SO PINNING **MOVES** THE PIN RATHER THAN REFUSING. This is the
   * deliberate opposite of the five-active cap above, and the difference is
   * what the person meant. Creating a sixth goal is not a request to drop one
   * of the five — they are peers, and silently letting one go would destroy an
   * intention — so that one is refused in a sentence. "Pin this one" is a
   * request about a single slot, and it can only mean *put this one there*.
   * Refusing it would make you go and unpin the other first, for nothing.
   *
   * ⚠ AND THE CLEAR COMES FIRST, WHICH IS THE WHOLE REASON `goals_one_pinned`
   * never fires. Vacate the slot, then fill it: the reverse order asks the
   * database to hold two pinned rows for the width of one statement, and the
   * partial unique index would refuse it — correctly, and in a voice that is
   * not a sentence. Two statements rather than one because a single-user admin
   * has nobody to race, and the index is what makes the interleaving safe
   * anyway: the worst a half-finished move can leave behind is nothing pinned.
   */
  setPinned: defineAction({
    accept: 'json',
    input: z.object({ id: z.uuid(), pinned: z.boolean() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;

      if (v.pinned) {
        const { error: clearError } = await sb.from('goals').update({ pinned: false }).eq('pinned', true);
        if (clearError) throw fail(clearError.message);
      }

      const { error } = await sb.from('goals').update({ pinned: v.pinned }).eq('id', v.id);
      if (error) throw fail(error.message);
      return { id: v.id, pinned: v.pinned };
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
    input: z.object({ id: z.uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const { error } = await sb.from('goals').delete().eq('id', v.id);
      if (error) throw fail(error.message);
      return { id: v.id };
    },
  }),
};
