// ============================================================================
// Vocabulary management (docs/admin.md §8): subjects, authors, works.
//
// Delete is FK-safe: fragment_subjects cascades; fragments.author_id/work_id and
// works.author_id are ON DELETE SET NULL — a fragment is never orphaned.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { slugify } from '../lib/slug';
import { fail, uniqueSlug, optText, optInt } from './_shared';

export const subjects = {
  update: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid(), name: z.string().min(1), definition: optText }),
    handler: async (input, ctx) => {
      const sb = ctx.locals.supabase;
      const slug = await uniqueSlug(sb, slugify(input.name), input.id).catch(() => slugify(input.name));
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
      const { error } = await ctx.locals.supabase.from('subjects').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  merge: defineAction({
    accept: 'form',
    input: z.object({ from: z.uuid(), into: z.uuid() }),
    handler: async (input, ctx) => {
      const sb = ctx.locals.supabase;
      if (input.from === input.into) throw fail('Pick two different subjects', 'BAD_REQUEST');
      const { data: links } = await sb.from('fragment_subjects').select('fragment_id').eq('subject_id', input.from);
      for (const l of links ?? []) {
        await sb
          .from('fragment_subjects')
          .upsert(
            { fragment_id: l.fragment_id, subject_id: input.into },
            { onConflict: 'fragment_id,subject_id', ignoreDuplicates: true },
          );
      }
      await sb.from('fragment_subjects').delete().eq('subject_id', input.from);
      const { error } = await sb.from('subjects').delete().eq('id', input.from);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
};

export const authors = {
  update: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid(), name: z.string().min(1), note: optText }),
    handler: async (input, ctx) => {
      const sb = ctx.locals.supabase;
      const slug = await uniqueSlug(sb, slugify(input.name), input.id).catch(() => slugify(input.name));
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
      const { error } = await ctx.locals.supabase.from('authors').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  merge: defineAction({
    accept: 'form',
    input: z.object({ from: z.uuid(), into: z.uuid() }),
    handler: async (input, ctx) => {
      const sb = ctx.locals.supabase;
      if (input.from === input.into) throw fail('Pick two different authors', 'BAD_REQUEST');
      await sb.from('fragments').update({ author_id: input.into }).eq('author_id', input.from);
      await sb.from('works').update({ author_id: input.into }).eq('author_id', input.from);
      const { error } = await sb.from('authors').delete().eq('id', input.from);
      if (error) throw fail(error.message);
      return { ok: true };
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
      const sb = ctx.locals.supabase;
      const slug = await uniqueSlug(sb, slugify(input.title), input.id).catch(() => slugify(input.title));
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
      const { error } = await ctx.locals.supabase.from('works').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
  merge: defineAction({
    accept: 'form',
    input: z.object({ from: z.uuid(), into: z.uuid() }),
    handler: async (input, ctx) => {
      const sb = ctx.locals.supabase;
      if (input.from === input.into) throw fail('Pick two different works', 'BAD_REQUEST');
      await sb.from('fragments').update({ work_id: input.into }).eq('work_id', input.from);
      const { error } = await sb.from('works').delete().eq('id', input.from);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
};
