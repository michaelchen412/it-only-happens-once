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
async function merge(sb: DB, fn: 'merge_subjects' | 'merge_authors' | 'merge_works', from: string, into: string) {
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
