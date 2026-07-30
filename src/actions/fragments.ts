// ============================================================================
// Fragment mutations — writing, quote and song, plus trash/bulk and the two
// read-only helpers the editor sheets call (docs/admin.md §4–§6).
//
// `persist` lives here rather than in _shared.ts: it is the fragment write, not
// a general utility, and it owns the two date rules and the concurrency guard.
// ============================================================================
import { defineAction } from 'astro:actions';
import { getSecret } from 'astro:env/server';
import { z } from 'astro/zod';
import { slugify } from '../lib/slug';
import { lookupSpotify, parseSongRef } from '../lib/spotify';
import type { Database, Json } from '../lib/database.types';
import { type DB, fail, requireAdmin, uniqueSlug, optText, optUrl, optInt, optUuid, status } from './_shared';

type FragmentInsert = Database['public']['Tables']['fragments']['Insert'];

function firstWords(text: string, n = 7): string {
  return text.trim().split(/\s+/).slice(0, n).join(' ');
}

/** A bare year → Jan 1 noon UTC. Paired with date_precision 'year'. */
function yearToISO(year: number): string {
  return new Date(`${year}-01-01T12:00:00Z`).toISOString();
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
 *
 * A present `id` whose row doesn't exist is an INSERT with that id — the
 * editor mints ids client-side, so "unknown id" means "created before the
 * server had seen it", not an error.
 *
 * `baseUpdatedAt` is the optimistic-concurrency token: when given, the update
 * only applies if the row's `updated_at` still equals it — enforced in the
 * UPDATE's WHERE clause, so the check is atomic — and a miss is a CONFLICT the
 * client resolves (never a silent overwrite). Callers treat the value as an
 * opaque string: compared verbatim, never reformatted.
 */
async function persist(
  sb: DB,
  id: string | undefined,
  row: Omit<FragmentInsert, 'id' | 'published_at'>,
  subjects: string | undefined,
  baseUpdatedAt?: string,
): Promise<{ id: string; slug: string; updated_at: string }> {
  const publishing = row.status === 'published';
  const now = new Date().toISOString();

  let existing: { published_at: string | null; occurred_at: string } | null = null;
  if (id) {
    const { data, error } = await sb.from('fragments').select('published_at, occurred_at').eq('id', id).maybeSingle();
    if (error) throw fail(error.message);
    existing = data;
  }

  const published_at = publishing ? existing?.published_at ?? now : existing?.published_at ?? null;

  const payload: FragmentInsert = { ...row, published_at };
  if (row.occurred_at === undefined) {
    // No explicit date: snap to now only on a writing's first publish; else leave alone.
    if (publishing && !existing?.published_at) payload.occurred_at = now;
    else delete payload.occurred_at; // keep existing on update; DB default on insert
  }

  let saved: { id: string; slug: string; updated_at: string };
  if (id && existing) {
    let q = sb.from('fragments').update(payload).eq('id', id);
    if (baseUpdatedAt) q = q.eq('updated_at', baseUpdatedAt);
    const { data, error } = await q.select('id, slug, updated_at').maybeSingle();
    if (error) throw fail(error.message);
    if (!data) {
      // Zero rows: the guard didn't match (or the row vanished mid-flight).
      if (baseUpdatedAt) throw fail('This piece changed on the server after it was loaded here', 'CONFLICT');
      throw fail('That fragment no longer exists', 'NOT_FOUND');
    }
    saved = data;
  } else {
    const { data, error } = await sb
      .from('fragments')
      .insert(id ? { ...payload, id } : payload)
      .select('id, slug, updated_at')
      .single();
    if (error) throw fail(error.message);
    saved = data;
  }

  await syncSubjects(sb, saved.id, subjects);
  return saved;
}

export const fragments = {
  /**
   * Create or edit a long-form `writing` fragment (body is Markdown).
   * Title and body are optional so autosave can persist an untitled draft;
   * both are required to *publish*. `occurred_at` is an optional override
   * (datetime-local) for backdating legacy posts — absent means automatic.
   */
  saveWriting: defineAction({
    accept: 'form',
    input: z.object({
      id: optUuid, // minted client-side, so a first save is an insert-with-id
      title: optText,
      slug: optText,
      excerpt: optText,
      body: optText,
      occurred_at: optText, // datetime-local override; absent = auto (publish date)
      status,
      subjects: optText,
      base_updated_at: optText, // opaque concurrency token; mismatch → CONFLICT
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
      return persist(sb, input.id, row, input.subjects, input.base_updated_at);
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
      // provenance facets. The combo submits an id when an existing entity was
      // chosen; the *_name is only used to create-by-name when the id is absent.
      author_id: optUuid,
      work_id: optUuid,
      author_name: optText, // display stays in attribution
      work_name: optText, //   display stays in details.source_title
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
      // Prefer the chosen entity's id; fall back to creating one by name.
      let author_id = input.author_id ?? (await resolveAuthor(sb, input.author_name));
      const work_id = input.work_id ?? (await resolveWork(sb, input.work_name, author_id));
      // Integrity: a work belongs to one author, so the work's canonical author is
      // authoritative — this keeps fragment.author_id and work.author_id from ever
      // disagreeing (e.g. "Letters from a Stoic" can't be filed under Ocean Vuong),
      // even if the client sent a mismatched pair. Authorless works (The Bible)
      // leave the chosen author untouched.
      if (work_id) {
        const { data: w } = await sb.from('works').select('author_id').eq('id', work_id).single();
        if (w?.author_id) author_id = w.author_id;
      }
      const row: Omit<FragmentInsert, 'id' | 'published_at'> = {
        type: 'quote',
        title: null,
        slug,
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

  /**
   * Create or edit a `song` fragment. Title/art come from Spotify; artist is
   * manual. `body` is the ANNOTATION — Michael's words on why this song
   * (ADR-0009), which is what makes a song a fragment rather than a link. It
   * is optional, always: a song may say nothing and simply play.
   */
  saveSong: defineAction({
    accept: 'form',
    input: z.object({
      id: optText,
      spotify_url: z.string().url('Paste a Spotify track or album link'),
      title: z.string().min(1, 'A song title is required'),
      attribution: z.string().min(1, 'Who’s the artist?'),
      album: optText,
      body: optText,
      thumbnail_url: optText,
      year: z.coerce.number().int(),
      status,
      subjects: optText,
      slug: optText,
    }),
    handler: async (input, ctx) => {
      const sb = ctx.locals.supabase;
      // The URL is the single source of truth for what's being cited — the id
      // and the kind both come from it, so a stale hidden field can't disagree.
      const ref = parseSongRef(input.spotify_url);
      if (!ref) throw fail('That doesn’t look like a Spotify track or album link', 'BAD_REQUEST');
      const slug = await uniqueSlug(sb, slugify(input.slug || `${input.title} ${input.attribution}`), input.id);
      const details: Record<string, Json> = { spotify_id: ref.id };
      if (input.album) details.album = input.album;
      if (input.thumbnail_url) details.thumbnail_url = input.thumbnail_url;
      // provenance facets follow the shown fields: artist → author, album → work
      const author_id = await resolveAuthor(sb, input.attribution);
      const work_id = await resolveWork(sb, input.album, author_id);
      const row: Omit<FragmentInsert, 'id' | 'published_at'> = {
        type: 'song',
        title: input.title,
        slug,
        body: input.body?.trim() || null,
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
   * Load one fragment for the WritingSheet (drafts included — the session
   * client sees them via RLS; anon sessions only ever get published rows).
   * Fetched on demand so the manager table doesn't embed every essay body.
   */
  get: defineAction({
    input: z.object({ id: z.string().uuid() }),
    handler: async ({ id }, ctx) => {
      requireAdmin(ctx);
      const { data, error } = await ctx.locals.supabase
        .from('fragments')
        .select(
          'id, type, title, slug, excerpt, body, status, occurred_at, updated_at, fragment_subjects(subjects(name)), fragment_constellations(constellation_id)',
        )
        .eq('id', id)
        .single();
      if (error || !data) throw fail('That fragment no longer exists', 'NOT_FOUND');
      return {
        constellationIds: (data.fragment_constellations ?? []).map((l) => l.constellation_id),
        id: data.id,
        type: data.type,
        title: data.title ?? '',
        slug: data.slug ?? '',
        excerpt: data.excerpt ?? '',
        body: data.body ?? '',
        status: data.status,
        occurredIso: data.occurred_at ?? '',
        updatedAt: data.updated_at, // concurrency token for saveWriting's base_updated_at
        subjects: (data.fragment_subjects ?? [])
          .map((l) => (l.subjects as { name: string } | null)?.name)
          .filter(Boolean)
          .join(', '),
      };
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
      text: z.string().min(1).max(20_000),
      kind: z.enum(['quote', 'song', 'writing']),
    }),
    handler: async ({ text, kind }, ctx) => {
      requireAdmin(ctx);
      const apiKey = getSecret('ANTHROPIC_API_KEY');
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
};

export const songs = {
  /** Resolve a pasted Spotify link to { spotifyId, title, thumbnailUrl }. */
  lookup: defineAction({
    input: z.object({ url: z.string().min(1).max(500) }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const found = await lookupSpotify(input.url);
      if (!found) throw fail('Couldn’t read that Spotify link', 'BAD_REQUEST');
      return found;
    },
  }),
};
