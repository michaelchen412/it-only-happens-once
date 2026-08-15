// ============================================================================
// Person ↔ corpus links (docs/plans/archive/12-people.md §5, ADR-0012).
//
// The seam, and the only place HQ writes rows that reference the public half of
// the database. Five actions in two directions, because §5 is explicit that
// both directions get UI: from a profile you attach a work or a fragment, and
// from the fragment editor you say who shared it.
//
// ⚠ THESE ACTIONS NEVER TOUCH `fragments` OR `works` THEMSELVES. Linking is not
// editing: attaching a quote to somebody must not be able to change the quote,
// and the strongest way to guarantee that is for this module to hold no update
// against those tables at all. The existence check below reads, and only reads.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { fail, requireAdmin, type DB } from './_shared';

/**
 * A link's free text. §5 keeps this instead of an enum of link kinds —
 * "recommended, Mar 2024" says more than a dropdown of three verbs, and a
 * taxonomy invented before there is any data to shape it is a taxonomy that is
 * wrong in a month. Short on purpose: it annotates a link, it is not a place to
 * write about somebody.
 */
const note = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(280).nullable().default(null),
);

/**
 * Confirm the corpus row exists before pointing at it.
 *
 * The foreign key would reject a bad id anyway — this exists so the failure is
 * a sentence rather than a constraint name, which is the same reason
 * `songs.pair` checks `type` in the action instead of in the schema.
 *
 * ⚠ A FAILED READ IS NOT "IT DOESN'T EXIST", and conflating the two is worse
 * than a 500. Unchecked, a database blip came back as *"That work no longer
 * exists."* — a confident, specific, wrong sentence about somebody's library,
 * which invites you to go and re-add a row that was there the whole time. The
 * two cases get two answers now.
 */
async function assertExists(sb: DB, table: 'works' | 'fragments', id: string, noun: string): Promise<void> {
  const { data, error } = await sb.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw fail(error.message);
  if (!data) throw fail(`That ${noun} no longer exists.`, 'NOT_FOUND');
}

export const links = {
  /**
   * Attach a work — the two-hop link, and the one that keeps paying.
   *
   * An UPSERT rather than an insert: linking somebody to a book they are
   * already linked to is not an error, it is you editing the note. Failing with
   * "duplicate key" on that would be the interface reporting its own primary
   * key at you.
   */
  work: defineAction({
    accept: 'json',
    input: z.object({ personId: z.uuid(), workId: z.uuid(), note }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      await assertExists(sb, 'works', v.workId, 'work');

      const { error } = await sb
        .from('person_works')
        .upsert({ person_id: v.personId, work_id: v.workId, note: v.note }, { onConflict: 'person_id,work_id' });
      if (error) throw fail(error.message);
      return { personId: v.personId, workId: v.workId };
    },
  }),

  unlinkWork: defineAction({
    accept: 'json',
    input: z.object({ personId: z.uuid(), workId: z.uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const { error } = await sb.from('person_works').delete().eq('person_id', v.personId).eq('work_id', v.workId);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),

  /** Attach one fragment directly — a song they sent, a line they said out loud. */
  fragment: defineAction({
    accept: 'json',
    input: z.object({ personId: z.uuid(), fragmentId: z.uuid(), note }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      await assertExists(sb, 'fragments', v.fragmentId, 'fragment');

      const { error } = await sb
        .from('person_fragments')
        .upsert(
          { person_id: v.personId, fragment_id: v.fragmentId, note: v.note },
          { onConflict: 'person_id,fragment_id' },
        );
      if (error) throw fail(error.message);
      return { personId: v.personId, fragmentId: v.fragmentId };
    },
  }),

  unlinkFragment: defineAction({
    accept: 'json',
    input: z.object({ personId: z.uuid(), fragmentId: z.uuid() }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      const { error } = await sb
        .from('person_fragments')
        .delete()
        .eq('person_id', v.personId)
        .eq('fragment_id', v.fragmentId);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),

  /**
   * The other direction: who shared THIS fragment.
   *
   * ⚠ THIS IS NOT delete-then-insert, unlike `interactions.setParticipants`,
   * and the difference is deliberate. A participant list has nothing of its own
   * to lose, so rebuilding it is free; a link row carries a NOTE, and clearing
   * the list to rewrite it would throw away every note the profile side had
   * written the moment somebody opened a quote and pressed save. So this
   * removes exactly what was unticked and adds exactly what was ticked, and
   * leaves the rows that were already right — notes and all — untouched.
   */
  setPeople: defineAction({
    accept: 'json',
    input: z.object({ fragmentId: z.uuid(), personIds: z.array(z.uuid()).max(50) }),
    handler: async (v, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase as DB;
      await assertExists(sb, 'fragments', v.fragmentId, 'fragment');

      const wanted = [...new Set(v.personIds)];
      const { data: current, error: readErr } = await sb
        .from('person_fragments')
        .select('person_id')
        .eq('fragment_id', v.fragmentId);
      if (readErr) throw fail(readErr.message);

      const have = new Set((current ?? []).map((r) => r.person_id));
      const gone = [...have].filter((id) => !wanted.includes(id));
      const added = wanted.filter((id) => !have.has(id));

      if (gone.length) {
        const { error } = await sb
          .from('person_fragments')
          .delete()
          .eq('fragment_id', v.fragmentId)
          .in('person_id', gone);
        if (error) throw fail(error.message);
      }
      if (added.length) {
        const { error } = await sb
          .from('person_fragments')
          .insert(added.map((person_id) => ({ person_id, fragment_id: v.fragmentId })));
        if (error) throw fail(error.message);
      }
      return { fragmentId: v.fragmentId, count: wanted.length };
    },
  }),
};
