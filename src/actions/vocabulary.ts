// ============================================================================
// Vocabulary management (docs/admin.md §8): subjects, authors, works.
//
// Delete is FK-safe: fragment_subjects cascades; fragments.author_id/work_id and
// works.author_id are ON DELETE SET NULL — a fragment is never orphaned.
//
// ⚠ MERGE IS NOT A DELETE, and this file used to treat it as one. Each merge
// ran its remapping writes with the result thrown away and then hard-deleted
// the merged-from row, so a transient failure mid-way NULLED a fragment's
// author instead of moving it — and the works merge never remapped
// `person_works` at all, whose FK cascades, so it destroyed people's shelf
// links and the notes on them. Both were silent; both reported success.
//
// The remapping now lives in three plpgsql functions
// (`20260809013157_vocabulary_merges_are_one_transaction.sql`), which is what
// makes it atomic: one call, one transaction, no half-merged state to find
// later. **Read that migration before changing anything here** — the absorption
// rule and the ordering are argued there, and this file is only the door.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { slugify } from '../lib/slug';
import { duplicateNameMessage, nextSort, slugTakenMessage } from '../lib/feelings';
import { type DB, fail, requireAdmin, uniqueSlug, optText, optInt } from './_shared';

/** `from` and `into`, the only input any of the four merges takes. */
const mergeInput = z.object({ from: z.uuid(), into: z.uuid() });

/**
 * Call one of the merge functions and turn a refusal into the sentence it
 * deserves.
 *
 * The mapping is by SQLSTATE rather than by message so that the words stay the
 * database's to change: `22023` is the function's own "pick two different
 * ones", `P0002` is "one of them is already gone" (someone deleted it in
 * another tab), `42501` is the is_admin() line — unreachable from here, since
 * the handler guards first, but mapped anyway rather than surfacing as a 500 if
 * that ever stops being true.
 */
async function merge(
  sb: DB,
  fn: 'merge_subjects' | 'merge_authors' | 'merge_works' | 'merge_feelings',
  from: string,
  into: string,
) {
  const { error } = await sb.rpc(fn, { from_id: from, into_id: into });
  if (!error) return { ok: true };
  const code =
    error.code === '22023'
      ? 'BAD_REQUEST'
      : error.code === 'P0002'
        ? 'NOT_FOUND'
        : error.code === '42501'
          ? 'FORBIDDEN'
          : 'INTERNAL_SERVER_ERROR';
  throw fail(error.message, code);
}

export const subjects = {
  update: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid(), name: z.string().min(1), definition: optText }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const slug = await uniqueSlug(sb, 'subjects', slugify(input.name), input.id);
      const { error } = await sb
        .from('subjects')
        .update({ name: input.name.trim(), slug, definition: input.definition ?? null })
        .eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  remove: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase.from('subjects').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  merge: defineAction({
    accept: 'form',
    input: mergeInput,
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      // Checked here as well as in the function: this one is a slip of the
      // hand, not a failure, and it deserves an answer without a round trip.
      if (input.from === input.into) throw fail('Pick two different subjects', 'BAD_REQUEST');
      return merge(ctx.locals.supabase, 'merge_subjects', input.from, input.into);
    },
  }),
};

export const authors = {
  update: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid(), name: z.string().min(1), note: optText }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const slug = await uniqueSlug(sb, 'authors', slugify(input.name), input.id);
      const { error } = await sb
        .from('authors')
        .update({ name: input.name.trim(), slug, note: input.note ?? null })
        .eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  remove: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase.from('authors').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  merge: defineAction({
    accept: 'form',
    input: mergeInput,
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      if (input.from === input.into) throw fail('Pick two different authors', 'BAD_REQUEST');
      return merge(ctx.locals.supabase, 'merge_authors', input.from, input.into);
    },
  }),
};

export const works = {
  update: defineAction({
    accept: 'form',
    input: z.object({
      id: z.uuid(),
      title: z.string().min(1),
      author_id: optText,
      year: optInt,
      kind: optText,
    }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const slug = await uniqueSlug(sb, 'works', slugify(input.title), input.id);
      const { error } = await sb
        .from('works')
        .update({
          title: input.title.trim(),
          slug,
          author_id: input.author_id ?? null,
          year: input.year ?? null,
          kind: input.kind ?? null,
        })
        .eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  remove: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase.from('works').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  merge: defineAction({
    accept: 'form',
    input: mergeInput,
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      if (input.from === input.into) throw fail('Pick two different works', 'BAD_REQUEST');
      return merge(ctx.locals.supabase, 'merge_works', input.from, input.into);
    },
  }),
};

// ============================================================================
// FEELINGS — the fourth vocabulary, and the one that breaks two of the three
// habits above (plan 33 §1, ruling 6).
//
//   1. **`update` DOES NOT RE-SLUG.** Every other vocabulary here re-derives its
//      slug from the name on every save, via `uniqueSlug`. A feeling's slug is
//      FROZEN at creation, because plan 33 §7 puts it in a public URL
//      (`?feeling=regretful`) — something people send each other — and plan 32
//      §1 found that moving a slug hard-404s every link already handed out. So a
//      rename changes the word and leaves the address alone, and the two are
//      allowed to drift apart forever.
//   2. **`create` EXISTS AND REFUSES.** Subjects, authors and works are created
//      as a side effect of saving a fragment, and collisions are resolved by
//      suffixing. Neither is right here: §1's whole claim is that the vocabulary
//      is small and shared, so adding a word must be a deliberate act, and a
//      silent `regretful-2` would be a second invisible shelf with the same name
//      on the front. See `lib/feelings.ts` for the collision this catches that
//      name-uniqueness cannot.
//
// What is NOT here: anything that decides what a song feels like. Ruling 1 —
// *"AI can't tell me what I feel"* — and the tagging write itself lives with the
// song, in `songs.setFeelings`, because it is a relation on a fragment rather
// than a vocabulary edit.
// ============================================================================

/** Both constraints are checked ahead of the insert for a better sentence; this is the race backstop. */
function feelingConflict(message: string): string | null {
  if (message.includes('feelings_name_ci')) return 'There is already a feeling with that name.';
  if (message.includes('feelings_slug_key')) return 'Another feeling already owns that link.';
  return null;
}

export const feelings = {
  /**
   * Add a word to the spectrum — from the Library, or mid-listen from the bench
   * (plan 33 §6a), which is the case that decides whether §1's "the vocabulary
   * is discovered by tagging" is true or merely stated.
   */
  create: defineAction({
    accept: 'form',
    input: z.object({ name: z.string().trim().min(1, 'Type a word first').max(40) }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const name = input.name.trim();
      const slug = slugify(name);
      if (!slug) throw fail('That word needs at least one letter or number.', 'BAD_REQUEST');

      const { data: existing, error: readErr } = await sb.from('feelings').select('id, name, slug, sort');
      if (readErr) throw fail(readErr.message);
      const rows = existing ?? [];

      const sameName = rows.find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (sameName) throw fail(duplicateNameMessage(sameName.name), 'CONFLICT');
      const sameSlug = rows.find((f) => f.slug === slug);
      if (sameSlug) throw fail(slugTakenMessage(sameSlug.name, slug), 'CONFLICT');

      const { data, error } = await sb
        .from('feelings')
        .insert({ name, slug, sort: nextSort(rows.map((f) => f.sort)) })
        .select('id, name, slug, sort')
        .single();
      if (error)
        throw fail(feelingConflict(error.message) ?? error.message, error.code === '23505' ? 'CONFLICT' : undefined);
      return data;
    },
  }),

  /**
   * Rename a word, or move it along the spectrum. ⚠ The slug is not an input and
   * must not become one — see this section's header.
   */
  update: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(40), sort: optInt }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const row: { name: string; sort?: number } = { name: input.name.trim() };
      if (input.sort !== undefined) row.sort = input.sort;
      const { error } = await ctx.locals.supabase.from('feelings').update(row).eq('id', input.id);
      if (error)
        throw fail(feelingConflict(error.message) ?? error.message, error.code === '23505' ? 'CONFLICT' : undefined);
      return { ok: true };
    },
  }),

  /**
   * Remove a word. `fragment_feelings` cascades, so this un-files every song
   * carrying it — which is why the Library shows the count beside the button.
   */
  remove: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase.from('feelings').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),

  /**
   * ⚠ THE ONE THAT KEEPS THE VOCABULARY SMALL, and the only exit from the
   * frozen-slug collision above. Uniqueness catches `tender` twice; nothing but
   * this catches `tender` and `gentle`.
   */
  merge: defineAction({
    accept: 'form',
    input: mergeInput,
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      if (input.from === input.into) throw fail('Pick two different feelings', 'BAD_REQUEST');
      return merge(ctx.locals.supabase, 'merge_feelings', input.from, input.into);
    },
  }),
};
