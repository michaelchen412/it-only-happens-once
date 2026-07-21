// ============================================================================
// Admin mutations — the single write path (docs/admin.md §4, ADR-0005).
//
// Every handler runs on the server and uses the request-bound session client
// (context.locals.supabase) — NEVER the service-role key. So every write is
// authorized by Michael's cookie session and re-checked by is_admin() in RLS.
// An action is a validation/convenience layer, not a trust boundary.
//
// If a write fails with a permission error, the usual cause is a session whose
// JWT predates the admin-role grant — sign out and back in (see docs/auth.md).
// ============================================================================
import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { slugify } from '../lib/slug';
import { lookupSpotifyTrack, parseSpotifyTrackId } from '../lib/spotify';
import type { Database, Json } from '../lib/database.types';

type DB = SupabaseClient<Database>;
type FragmentInsert = Database['public']['Tables']['fragments']['Insert'];

// --- Zod helpers: empty form fields arrive as '' — treat them as absent ------
const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);
const optText = z.preprocess(blankToUndef, z.string().optional());
const optUrl = z.preprocess(blankToUndef, z.string().url('That doesn’t look like a URL').optional());
const optInt = z.preprocess(blankToUndef, z.coerce.number().int().optional());
const status = z.enum(['draft', 'published']).default('draft');

// --- shared internals --------------------------------------------------------

const fail = (message: string, code: Parameters<typeof ActionError>[0]['code'] = 'INTERNAL_SERVER_ERROR') =>
  new ActionError({ code, message });

function firstWords(text: string, n = 7): string {
  return text.trim().split(/\s+/).slice(0, n).join(' ');
}

/** A bare year → Jan 1 noon UTC. Paired with date_precision 'year'. */
function yearToISO(year: number): string {
  return new Date(`${year}-01-01T12:00:00Z`).toISOString();
}

/** Ensure the slug is unique across ALL fragments (data-model.md §6). */
async function uniqueSlug(sb: DB, base: string, excludeId?: string): Promise<string> {
  const root = base || 'untitled';
  for (let i = 0; i < 60; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    let q = sb.from('fragments').select('id').eq('slug', candidate).limit(1);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw fail(error.message);
    if (!data || data.length === 0) return candidate;
  }
  throw fail('Could not generate a unique slug');
}

/** Upsert an author by name; return its id (or null for blank). Idempotent by slug. */
async function resolveAuthor(sb: DB, name?: string): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const slug = slugify(n);
  const { error } = await sb.from('authors').upsert({ name: n, slug }, { onConflict: 'slug', ignoreDuplicates: true });
  if (error) throw fail(error.message);
  const { data } = await sb.from('authors').select('id').eq('slug', slug).single();
  return data?.id ?? null;
}

/** Upsert a work by title (optionally linked to an author); return its id. */
async function resolveWork(sb: DB, title?: string, authorId?: string | null): Promise<string | null> {
  const t = title?.trim();
  if (!t) return null;
  const slug = slugify(t);
  const { error } = await sb.from('works').upsert({ title: t, slug, author_id: authorId ?? null }, { onConflict: 'slug', ignoreDuplicates: true });
  if (error) throw fail(error.message);
  const { data } = await sb.from('works').select('id').eq('slug', slug).single();
  return data?.id ?? null;
}

/** Replace a fragment's subject links, creating any new subjects on the fly. */
async function syncSubjects(sb: DB, fragmentId: string, raw?: string): Promise<void> {
  const names = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const { error: delErr } = await sb.from('fragment_subjects').delete().eq('fragment_id', fragmentId);
  if (delErr) throw fail(delErr.message);
  if (!names.length) return;

  const rows = names.map((name) => ({ name, slug: slugify(name) })).filter((r) => r.slug);
  const { error: upErr } = await sb.from('subjects').upsert(rows, { onConflict: 'slug', ignoreDuplicates: true });
  if (upErr) throw fail(upErr.message);

  const { data: subs, error: selErr } = await sb
    .from('subjects')
    .select('id, slug')
    .in('slug', rows.map((r) => r.slug));
  if (selErr) throw fail(selErr.message);

  const links = (subs ?? []).map((s) => ({ fragment_id: fragmentId, subject_id: s.id }));
  if (links.length) {
    const { error: linkErr } = await sb.from('fragment_subjects').insert(links);
    if (linkErr) throw fail(linkErr.message);
  }
}

/**
 * Insert or update a fragment, then reconcile its subjects. Handles two dates:
 *
 *  - `published_at` — stamped on the FIRST publish only; never cleared on
 *    unpublish (it's the historical "first went live" moment).
 *  - `occurred_at` (the public posted/added date) — if `row` carries an explicit
 *    value (a manual override, or quote/song provenance), it wins. Otherwise, on
 *    a writing's first publish it snaps to now (so the posted date = publish
 *    date, automatically). Otherwise it's left untouched (draft edits, or
 *    re-editing a published piece don't move its posted date).
 */
async function persist(
  sb: DB,
  id: string | undefined,
  row: Omit<FragmentInsert, 'id' | 'published_at'>,
  subjects: string | undefined,
): Promise<{ id: string; slug: string }> {
  const publishing = row.status === 'published';
  const now = new Date().toISOString();

  let existing: { published_at: string | null; occurred_at: string } | null = null;
  if (id) {
    const { data, error } = await sb.from('fragments').select('published_at, occurred_at').eq('id', id).single();
    if (error) throw fail('That fragment no longer exists', 'NOT_FOUND');
    existing = data;
  }

  const published_at = publishing ? existing?.published_at ?? now : existing?.published_at ?? null;

  const payload: Record<string, unknown> = { ...row, published_at };
  if (row.occurred_at === undefined) {
    // No explicit date: snap to now only on a writing's first publish; else leave alone.
    if (publishing && !existing?.published_at) payload.occurred_at = now;
    else delete payload.occurred_at; // keep existing on update; DB default on insert
  }

  let saved: { id: string; slug: string };
  if (id) {
    const { data, error } = await sb.from('fragments').update(payload).eq('id', id).select('id, slug').single();
    if (error) throw fail(error.message);
    saved = data;
  } else {
    const { data, error } = await sb.from('fragments').insert(payload as FragmentInsert).select('id, slug').single();
    if (error) throw fail(error.message);
    saved = data;
  }

  await syncSubjects(sb, saved.id, subjects);
  return saved;
}

// --- actions -----------------------------------------------------------------

export const server = {
  fragments: {
    /**
     * Create or edit a long-form `writing` fragment (body is Markdown).
     * Title and body are optional so autosave can persist an untitled draft;
     * both are required to *publish*. `occurred_at` is an optional override
     * (datetime-local) for backdating legacy posts — absent means automatic.
     */
    saveWriting: defineAction({
      accept: 'form',
      input: z.object({
        id: optText,
        title: optText,
        slug: optText,
        excerpt: optText,
        body: optText,
        occurred_at: optText, // datetime-local override; absent = auto (publish date)
        status,
        subjects: optText,
      }),
      handler: async (input, ctx) => {
        const sb = ctx.locals.supabase;
        const publishing = input.status === 'published';
        const title = input.title?.trim() ?? '';
        const body = input.body ?? '';
        if (publishing && !title) throw fail('Add a title before publishing', 'BAD_REQUEST');
        if (publishing && !body.trim()) throw fail('Write something before publishing', 'BAD_REQUEST');

        const base = input.slug || title || firstWords(body) || 'untitled';
        const slug = await uniqueSlug(sb, slugify(base), input.id);
        const row: Omit<FragmentInsert, 'id' | 'published_at'> = {
          type: 'writing',
          title: title || null,
          slug,
          excerpt: input.excerpt ?? null,
          body: body || null,
          status: input.status,
        };
        if (input.occurred_at) {
          row.occurred_at = new Date(input.occurred_at).toISOString();
          row.date_precision = 'day';
        }
        return persist(sb, input.id, row, input.subjects);
      },
    }),

    /** Create or edit a `quote` fragment. */
    saveQuote: defineAction({
      accept: 'form',
      input: z.object({
        id: optText,
        body: z.string().min(1, 'The quote can’t be empty'),
        attribution: optText,
        source_title: optText,
        source_author: optText,
        work_year: optInt,
        page: optInt,
        citation: optText,
        source_url: optUrl,
        author_name: optText, // provenance facet (grouping/search); display stays in attribution
        work_name: optText, //   provenance facet; display stays in details.source_title
        occurred_at: optText, // datetime-local override for legacy quotes; absent = automatic
        status,
        subjects: optText,
        slug: optText,
      }),
      handler: async (input, ctx) => {
        const sb = ctx.locals.supabase;
        const base = input.slug || `${input.attribution ?? ''} ${firstWords(input.body)}`;
        const slug = await uniqueSlug(sb, slugify(base), input.id);
        const details: Record<string, Json> = {};
        if (input.source_title) details.source_title = input.source_title;
        if (input.source_author) details.source_author = input.source_author;
        if (input.work_year !== undefined) details.work_year = input.work_year;
        if (input.page !== undefined) details.page = input.page;
        if (input.citation) details.citation = input.citation;
        const author_id = await resolveAuthor(sb, input.author_name);
        const work_id = await resolveWork(sb, input.work_name, author_id);
        const row: Omit<FragmentInsert, 'id' | 'published_at'> = {
          type: 'quote',
          title: null,
          body: input.body,
          attribution: input.attribution ?? null,
          source_url: input.source_url ?? null,
          details,
          author_id,
          work_id,
          status: input.status,
        };
        if (input.occurred_at) {
          row.occurred_at = new Date(input.occurred_at).toISOString();
          row.date_precision = 'day';
        }
        return persist(sb, input.id, row, input.subjects);
      },
    }),

    /** Create or edit a `song` fragment. Title/art come from Spotify; artist is manual. */
    saveSong: defineAction({
      accept: 'form',
      input: z.object({
        id: optText,
        spotify_url: z.string().url('Paste a Spotify track link'),
        spotify_id: optText,
        title: z.string().min(1, 'A song title is required'),
        attribution: z.string().min(1, 'Who’s the artist?'),
        album: optText,
        thumbnail_url: optText,
        year: z.coerce.number().int(),
        status,
        subjects: optText,
        slug: optText,
      }),
      handler: async (input, ctx) => {
        const sb = ctx.locals.supabase;
        const spotifyId = input.spotify_id || parseSpotifyTrackId(input.spotify_url);
        if (!spotifyId) throw fail('That doesn’t look like a Spotify track link', 'BAD_REQUEST');
        const slug = await uniqueSlug(sb, slugify(input.slug || `${input.title} ${input.attribution}`), input.id);
        const details: Record<string, Json> = { spotify_id: spotifyId };
        if (input.album) details.album = input.album;
        if (input.thumbnail_url) details.thumbnail_url = input.thumbnail_url;
        // provenance facets follow the shown fields: artist → author, album → work
        const author_id = await resolveAuthor(sb, input.attribution);
        const work_id = await resolveWork(sb, input.album, author_id);
        const row: Omit<FragmentInsert, 'id' | 'published_at'> = {
          type: 'song',
          title: input.title,
          body: null,
          attribution: input.attribution,
          source_url: input.spotify_url,
          details,
          author_id,
          work_id,
          status: input.status,
          occurred_at: yearToISO(input.year),
          date_precision: 'year',
        };
        return persist(sb, input.id, row, input.subjects);
      },
    }),

    /**
     * AI subject suggestions for a fragment (read-only; no DB write). Returns
     * existing subjects that apply + an optional proposed new one. The human
     * accepts/edits in the editor; a proposed subject only becomes real if it's
     * still in the `subjects` field at save time. Degrades cleanly when no key.
     */
    suggestSubjects: defineAction({
      input: z.object({
        text: z.string().min(1),
        kind: z.enum(['quote', 'song', 'writing']),
      }),
      handler: async ({ text, kind }, ctx) => {
        const apiKey = import.meta.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw fail('AI suggestions aren’t configured — add ANTHROPIC_API_KEY.', 'BAD_REQUEST');
        const { data: taxonomy, error } = await ctx.locals.supabase.from('subjects').select('name, definition').order('name');
        if (error) throw fail(error.message);
        try {
          const { suggestSubjects } = await import('../lib/suggest-subjects');
          return await suggestSubjects(text, kind, apiKey, taxonomy ?? []);
        } catch {
          throw fail('Couldn’t reach the model — tag it manually.', 'INTERNAL_SERVER_ERROR');
        }
      },
    }),

    /** Soft-delete: move a fragment to Trash (recoverable). */
    trash: defineAction({
      accept: 'form',
      input: z.object({ id: z.string().min(1) }),
      handler: async (input, ctx) => {
        const { error } = await ctx.locals.supabase
          .from('fragments')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', input.id);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),

    /** Restore a fragment from Trash. */
    restore: defineAction({
      accept: 'form',
      input: z.object({ id: z.string().min(1) }),
      handler: async (input, ctx) => {
        const { error } = await ctx.locals.supabase.from('fragments').update({ deleted_at: null }).eq('id', input.id);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),

    /** Permanently delete (only from Trash; join rows cascade). */
    purge: defineAction({
      accept: 'form',
      input: z.object({ id: z.string().min(1) }),
      handler: async (input, ctx) => {
        const { error } = await ctx.locals.supabase
          .from('fragments')
          .delete()
          .eq('id', input.id)
          .not('deleted_at', 'is', null); // guard: never hard-delete a live fragment
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),

    /** Permanently delete everything currently in Trash. */
    emptyTrash: defineAction({
      accept: 'form',
      input: z.object({}),
      handler: async (_input, ctx) => {
        const { error } = await ctx.locals.supabase.from('fragments').delete().not('deleted_at', 'is', null);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),

    /** Bulk actions over a comma-joined id list. */
    bulk: defineAction({
      accept: 'form',
      input: z.object({
        ids: z.string().min(1),
        op: z.enum(['publish', 'unpublish', 'trash', 'restore', 'purge']),
      }),
      handler: async (input, ctx) => {
        const sb = ctx.locals.supabase;
        const ids = input.ids.split(',').map((s) => s.trim()).filter(Boolean);
        if (!ids.length) return { ok: true, count: 0 };
        const now = new Date().toISOString();

        if (input.op === 'trash') {
          const { error } = await sb.from('fragments').update({ deleted_at: now }).in('id', ids);
          if (error) throw fail(error.message);
        } else if (input.op === 'restore') {
          const { error } = await sb.from('fragments').update({ deleted_at: null }).in('id', ids);
          if (error) throw fail(error.message);
        } else if (input.op === 'purge') {
          const { error } = await sb.from('fragments').delete().in('id', ids).not('deleted_at', 'is', null);
          if (error) throw fail(error.message);
        } else if (input.op === 'publish') {
          const { error: tsErr } = await sb
            .from('fragments')
            .update({ published_at: now })
            .in('id', ids)
            .is('published_at', null);
          if (tsErr) throw fail(tsErr.message);
          const { error } = await sb.from('fragments').update({ status: 'published' }).in('id', ids);
          if (error) throw fail(error.message);
        } else {
          const { error } = await sb.from('fragments').update({ status: 'draft' }).in('id', ids);
          if (error) throw fail(error.message);
        }
        return { ok: true, count: ids.length };
      },
    }),
  },

  songs: {
    /** Resolve a pasted Spotify link to { spotifyId, title, thumbnailUrl }. */
    lookup: defineAction({
      input: z.object({ url: z.string().min(1) }),
      handler: async (input) => {
        const found = await lookupSpotifyTrack(input.url);
        if (!found) throw fail('Couldn’t read that Spotify link', 'BAD_REQUEST');
        return found;
      },
    }),
  },

  // --- vocabulary management (docs/admin.md §8): subjects, authors, works ------
  // Delete is FK-safe: fragment_subjects cascades; fragments.author_id/work_id and
  // works.author_id are ON DELETE SET NULL — a fragment is never orphaned.
  subjects: {
    update: defineAction({
      accept: 'form',
      input: z.object({ id: z.string().uuid(), name: z.string().min(1), definition: optText }),
      handler: async (input, ctx) => {
        const sb = ctx.locals.supabase;
        const slug = await uniqueSlug(sb, slugify(input.name), input.id).catch(() => slugify(input.name));
        const { error } = await sb.from('subjects').update({ name: input.name.trim(), slug, definition: input.definition ?? null }).eq('id', input.id);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),
    remove: defineAction({
      accept: 'form',
      input: z.object({ id: z.string().uuid() }),
      handler: async (input, ctx) => {
        const { error } = await ctx.locals.supabase.from('subjects').delete().eq('id', input.id);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),
    merge: defineAction({
      accept: 'form',
      input: z.object({ from: z.string().uuid(), into: z.string().uuid() }),
      handler: async (input, ctx) => {
        const sb = ctx.locals.supabase;
        if (input.from === input.into) throw fail('Pick two different subjects', 'BAD_REQUEST');
        const { data: links } = await sb.from('fragment_subjects').select('fragment_id').eq('subject_id', input.from);
        for (const l of links ?? []) {
          await sb.from('fragment_subjects').upsert({ fragment_id: l.fragment_id, subject_id: input.into }, { onConflict: 'fragment_id,subject_id', ignoreDuplicates: true });
        }
        await sb.from('fragment_subjects').delete().eq('subject_id', input.from);
        const { error } = await sb.from('subjects').delete().eq('id', input.from);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),
  },

  authors: {
    update: defineAction({
      accept: 'form',
      input: z.object({ id: z.string().uuid(), name: z.string().min(1), note: optText }),
      handler: async (input, ctx) => {
        const sb = ctx.locals.supabase;
        const slug = await uniqueSlug(sb, slugify(input.name), input.id).catch(() => slugify(input.name));
        const { error } = await sb.from('authors').update({ name: input.name.trim(), slug, note: input.note ?? null }).eq('id', input.id);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),
    remove: defineAction({
      accept: 'form',
      input: z.object({ id: z.string().uuid() }),
      handler: async (input, ctx) => {
        const { error } = await ctx.locals.supabase.from('authors').delete().eq('id', input.id);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),
    merge: defineAction({
      accept: 'form',
      input: z.object({ from: z.string().uuid(), into: z.string().uuid() }),
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
  },

  works: {
    update: defineAction({
      accept: 'form',
      input: z.object({ id: z.string().uuid(), title: z.string().min(1), author_id: optText, year: optInt, kind: optText }),
      handler: async (input, ctx) => {
        const sb = ctx.locals.supabase;
        const slug = await uniqueSlug(sb, slugify(input.title), input.id).catch(() => slugify(input.title));
        const { error } = await sb
          .from('works')
          .update({ title: input.title.trim(), slug, author_id: input.author_id ?? null, year: input.year ?? null, kind: input.kind ?? null })
          .eq('id', input.id);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),
    remove: defineAction({
      accept: 'form',
      input: z.object({ id: z.string().uuid() }),
      handler: async (input, ctx) => {
        const { error } = await ctx.locals.supabase.from('works').delete().eq('id', input.id);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),
    merge: defineAction({
      accept: 'form',
      input: z.object({ from: z.string().uuid(), into: z.string().uuid() }),
      handler: async (input, ctx) => {
        const sb = ctx.locals.supabase;
        if (input.from === input.into) throw fail('Pick two different works', 'BAD_REQUEST');
        await sb.from('fragments').update({ work_id: input.into }).eq('work_id', input.from);
        const { error } = await sb.from('works').delete().eq('id', input.from);
        if (error) throw fail(error.message);
        return { ok: true };
      },
    }),
  },
};
