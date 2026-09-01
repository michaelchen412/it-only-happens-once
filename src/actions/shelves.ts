// ============================================================================
// Shelves — the write path for where a jotting lives (docs/admin.md §4).
// Bench: /lab/shelves · decided 2026-09-01.
//
// TWO WRITES AND NO MORE. `set` replaces a note's shelves outright; `create`
// adds a word to the vocabulary from inside the chooser. Renaming and deleting
// a shelf are deliberately absent — see `create` for why the door is one-way
// for now.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { slugify } from '../lib/slug';
import { MAX_SHELVES } from '../lib/shelves';
import { fail, requireAdmin, uniqueSlug } from './_shared';

export const shelves = {
  /**
   * Put a note on nought, one or two shelves — REPLACING whatever it was on.
   *
   * ⚠ REPLACE, NOT ADD, AND THE CALLER SENDS THE WHOLE LIST. `_shared.ts` has
   * the rule in its header: an action cannot tell "cleared" from "not sent", so
   * anything clearable must own the whole row and write what did not arrive.
   * A `toggle(noteId, shelfId)` would have been smaller and would have made
   * "take it off every shelf" a loop the client had to get right.
   *
   * ⚠ THE LIST IS EMPTY-ABLE, which is what `idList` exists for — an empty
   * field is a meaningful value here ("back in the inbox"), not absence.
   *
   * ⚠ AND IT REFUSES ANYTHING THAT IS NOT A NOTE. A shelf is a property of
   * scratch; the manager has no shelf column, no chip and no filter, so a
   * shelved draft would be state no room can see or clear. Same argument as
   * `appendToPiece`'s `.eq('status','note')` one file over.
   */
  set: defineAction({
    input: z.object({
      noteId: z.uuid(),
      // Not `idList`: this arrives as JSON from the chooser rather than as a
      // form field, so an empty array is already expressible and there is no
      // FormData coercion to undo.
      shelfIds: z.array(z.uuid()).max(MAX_SHELVES, `A note sits on at most ${MAX_SHELVES} shelves.`),
    }),
    handler: async ({ noteId, shelfIds }, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;

      const { data: note } = await sb
        .from('fragments')
        .select('id')
        .eq('id', noteId)
        .eq('status', 'note')
        .is('deleted_at', null)
        .maybeSingle();
      if (!note) throw fail('That note is no longer in the pile', 'NOT_FOUND');

      const wanted = [...new Set(shelfIds)];

      // ⚠ VERIFIED AGAINST THE VOCABULARY BEFORE THE WRITE, so an unknown id
      // is a sentence rather than a raw FK violation. RLS would refuse a
      // stranger's insert anyway; this is about the message, not the boundary.
      if (wanted.length) {
        const { data: known, error } = await sb.from('shelves').select('id').in('id', wanted);
        if (error) throw fail(error.message);
        if ((known ?? []).length !== wanted.length) throw fail('That shelf no longer exists', 'NOT_FOUND');
      }

      /*
        ⚠ DELETE-THEN-INSERT, AND IT IS NOT ATOMIC — stated rather than hidden.
        ADR 0026 says a multi-row write is one transaction, and the two writes
        this needs cannot be one from PostgREST. The exposure is a note briefly
        on no shelf if the insert fails, which is the INBOX — the safe end. The
        alternative that would be atomic is a plpgsql function, which is what
        the vocabulary merges got (and needed: those could orphan a fragment's
        author). Filing is reversible from the pile in one press, so the
        ceremony is not yet earned. Revisit if a shelf ever carries data of its
        own beyond membership.
      */
      const { error: delErr } = await sb.from('fragment_shelves').delete().eq('fragment_id', noteId);
      if (delErr) throw fail(delErr.message);

      if (wanted.length) {
        const { error } = await sb
          .from('fragment_shelves')
          .insert(wanted.map((shelf_id) => ({ fragment_id: noteId, shelf_id })));
        if (error) throw fail(error.message);
      }
      return { ok: true, count: wanted.length };
    },
  }),

  /**
   * A new drawer, named from inside the chooser.
   *
   * ⚠ NO RENAME AND NO DELETE HERE, DELIBERATELY. `shelves.slug` is frozen once
   * created (it lands in `?shelf=`), so a rename is a two-field write that has
   * to leave the slug alone — the shape `subjects.update` already has, and it
   * belongs in a vocabulary room beside that one rather than in the pile's
   * menu. Deleting is worse: `fragment_shelves` cascades, so a mis-tap would
   * silently unfile every note on that shelf. Both are real follow-ups; neither
   * is something the → chooser should be able to do by accident.
   *
   * ⚠ THE NAME IS CASE-INSENSITIVELY UNIQUE IN THE DATABASE (`shelves_name_ci`),
   * because the pile prints the word itself and `Philosophy` twice in the
   * filter row reads as a rendering fault. The refusal is mapped here so it
   * arrives as a sentence instead of a Postgres unique-violation string.
   */
  create: defineAction({
    input: z.object({ name: z.string().trim().min(1, 'Give the shelf a name.').max(40) }),
    handler: async ({ name }, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;

      const slug = await uniqueSlug(sb, 'shelves', slugify(name));
      // Appended, not inserted into the order: `sort` is a claim about which
      // drawer you reach for first, and a new one has not earned a place among
      // the words already there.
      const { data: last } = await sb.from('shelves').select('sort').order('sort', { ascending: false }).limit(1);
      const sort = (last?.[0]?.sort ?? 0) + 1;

      const { data, error } = await sb.from('shelves').insert({ name, slug, sort }).select('id, name, slug').single();
      if (error) {
        if (error.code === '23505') throw fail('There is already a shelf with that name.', 'CONFLICT');
        throw fail(error.message);
      }
      return data;
    },
  }),
};
