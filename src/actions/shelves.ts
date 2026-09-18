// ============================================================================
// Shelves — the write path for where a jotting lives (docs/admin.md §4).
// Bench: /lab/shelves · decided 2026-09-01.
//
// FOUR WRITES. `set` replaces a note's shelves outright and `create` adds a word
// to the vocabulary from inside the chooser; `rename` and `remove` groom the
// vocabulary from the Library.
//
// ⚠ THE DOOR WAS ONE-WAY UNTIL 2026-09-18, AND THAT WAS A REAL FAULT RATHER
// THAN A DEFERRAL. `create` used to close with *"Both are real follow-ups;
// neither is something the → chooser should be able to do by accident"* — the
// second half of which is still right and is why these two live in the Library
// rather than in the menu. But the follow-up was never scheduled, so a shelf,
// once made, could not be renamed, could not be deleted, and appeared in no
// room that manages anything. Michael: *"I also dont see a place where to even
// manage the notes categories."*
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
   * ⚠ NO RENAME AND NO DELETE FROM THE CHOOSER, DELIBERATELY — they live in the
   * Library instead (`rename` and `remove` below). `shelves.slug` is frozen once
   * created because it lands in `?shelf=`, so a rename must leave it alone; and
   * `fragment_shelves` cascades, so a delete unfiles every note on that shelf.
   * Neither is something a menu row you can hit by accident should be able to
   * do, and both want a confirm that can say the number.
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

  /**
   * Rename a drawer, from the Library.
   *
   * ⚠⚠ THE SLUG IS FROZEN AND MUST STAY FROZEN, which is the one way this
   * differs from every other vocabulary write in the building. `subjects.update`
   * re-derives its slug from the new name, and doing the same here would break
   * three things at once: `?shelf=<slug>` is how the pile addresses a filtered
   * view, so every bookmark and every link in flight would 404 into an empty
   * room — silently, because an unknown slug resolves to `activeShelf: null`
   * and renders the inbox as though nothing were wrong.
   *
   * A shelf's slug is therefore an IDENTIFIER that happened to be minted from
   * its first name, not a rendering of its current one. No reader ever sees it.
   *
   * ⚠ THE CI-UNIQUE NAME CONSTRAINT STILL APPLIES (`shelves_name_ci`), for the
   * reason `create` gives: the pile prints the word itself, and `Philosophy`
   * twice in the filter row reads as a rendering fault.
   */
  rename: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid(), name: z.string().trim().min(1, 'Give the shelf a name.').max(40) }),
    handler: async ({ id, name }, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase.from('shelves').update({ name }).eq('id', id);
      if (error) {
        if (error.code === '23505') throw fail('There is already a shelf with that name.', 'CONFLICT');
        throw fail(error.message);
      }
      return { ok: true };
    },
  }),

  /**
   * Delete a drawer. The notes on it go back to the inbox.
   *
   * ⚠ NOTHING IS LOST, AND THAT IS WHY THIS IS SAFE IN A WAY THE OTHER
   * VOCABULARIES' DELETES ARE NOT. `fragment_shelves` cascades, so removing a
   * shelf removes only the MEMBERSHIP rows; every jotting survives untouched and
   * reappears in the inbox, which is the pile's default view. Compare
   * `works.remove`, which takes somebody's shelf entry and the note written on
   * it with it (plans/30 · §6a) — that one destroys authored content and this
   * one cannot.
   *
   * ⚠ IT STILL RETURNS THE COUNT, because "unfiled 23 notes" is a fact worth
   * being told even when it is reversible by hand. The Library's confirm reads
   * it before asking, which is the whole reason `library.astro` counts shelf
   * membership beside the vocabulary.
   */
  remove: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid() }),
    handler: async ({ id }, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      // Counted BEFORE the delete, because the cascade is what takes them away.
      const { count } = await sb
        .from('fragment_shelves')
        .select('fragment_id', { count: 'exact', head: true })
        .eq('shelf_id', id);
      const { error } = await sb.from('shelves').delete().eq('id', id);
      if (error) throw fail(error.message);
      return { ok: true, unfiled: count ?? 0 };
    },
  }),
};
