// ============================================================================
// Sets: a curated listen (plan 40 §3).
//
// One Spotify playlist, one quote, one description. Not a fragment — see the
// plan for why the exceptions were the proof — so nothing here reaches into
// `fragments` except to check that a chosen quote is a real, published quote.
// ============================================================================
import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { slugify } from '../lib/slug';
import { parseSpotifyEmbed } from '../lib/media';
import type { Database } from '../lib/database.types';
import { CONSTELLATION_STATUSES, type DB, fail, optText, optUuid, requireAdmin, uniqueSlug } from './_shared';

/**
 * A set's status is the same two words a constellation's is, so it reuses that
 * enum rather than declaring a parallel one that could drift. If they ever mean
 * different things, splitting them is the change — not keeping two copies in
 * step by hand.
 */
const setStatus = z.enum(CONSTELLATION_STATUSES).default('draft');

/**
 * ⚠ THE CANONICAL PLAYLIST URL, AND THE `?si=` STRIP IS THE POINT. Spotify's
 * share sheet appends a share-attribution token to every link; data-model.md's
 * rule for `source_url` is that stored URLs carry none. Two rows in the song
 * corpus kept theirs and are the only rows in the corpus that violate it, which
 * is what a rule enforced by habit rather than by code looks like after three
 * weeks.
 *
 * Rebuilding the URL from `{kind, id}` rather than stripping the query string
 * also normalises `intl-xx/` paths and `spotify:playlist:` URIs onto one form,
 * so two people pasting the same playlist two ways store one string.
 */
function canonicalPlaylistUrl(raw: string): string {
  const ref = parseSpotifyEmbed(raw);
  if (!ref || ref.kind !== 'playlist') {
    throw fail('That doesn’t look like a Spotify playlist link', 'BAD_REQUEST');
  }
  return `https://open.spotify.com/playlist/${ref.id}`;
}

/**
 * ⚠ REFUSING LOUDLY IS THE WHOLE JOB OF THIS FUNCTION, because the foreign key
 * cannot do it. `sets.quote_fragment_id` references `fragments(id)` and
 * Postgres cannot constrain the referenced row's `type` — so without this, a
 * set could point at an essay, and the page would render a 900-word "quote".
 *
 * The precedent is `songs.pair`, which refuses anything that is not a writing
 * for the mirror-image reason. Both are the action layer standing in for a
 * constraint the schema is unable to express.
 *
 * ⚠ AND IT MUST NOT BE A SILENT SKIP. RLS refuses by returning zero rows rather
 * than an error (architecture.md §113), so "not found" here covers both a bad
 * id and a row this session may not read — and answering `{ ok: true }` to
 * either is how the workshop reports a save that never happened.
 */
async function checkQuote(sb: DB, id: string): Promise<void> {
  const { data, error } = await sb.from('fragments').select('id, type, status, deleted_at').eq('id', id).maybeSingle();
  if (error) throw fail(error.message);
  if (!data) throw fail('That quote no longer exists', 'BAD_REQUEST');
  if (data.type !== 'quote') throw fail('A set’s epigraph has to be a quote', 'BAD_REQUEST');
  if (data.deleted_at) throw fail('That quote is in the bin', 'BAD_REQUEST');
  // A draft quote is allowed on a DRAFT set — you may well be writing both at
  // once — and `listSets` drops it from the public render until it is
  // published. Refusing here would make the order you do things in matter.
}

export const sets = {
  save: defineAction({
    accept: 'form',
    input: z.object({
      id: optUuid,
      title: z.string().trim().min(1, 'A set needs a title'),
      slug: optText,
      /**
       * ⚠ WRITTEN FROM WHAT ARRIVES, AND WHAT DOES NOT ARRIVE IS WRITTEN EMPTY —
       * the rule `constellations.save` had to learn the hard way. `accept:
       * 'form'` coerces a cleared input to `undefined`, byte-identically to a
       * field that was never sent, so an "absent means leave as-is" sentinel is
       * unreachable and clearing a field would silently do nothing. TO CALL
       * `save` IS TO EDIT THE WHOLE CARD; single-field changes go through
       * `setStatus` and `reorder` below.
       */
      description: z.string().optional(),
      playlist_url: z.string().trim().min(1, 'A set needs a playlist'),
      quote_fragment_id: optUuid,
      status: setStatus,
    }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;

      const playlistUrl = canonicalPlaylistUrl(input.playlist_url);
      if (input.quote_fragment_id) await checkQuote(sb, input.quote_fragment_id);

      const slug = await uniqueSlug(sb, 'sets', slugify(input.slug || input.title) || 'set', input.id);

      const row: Database['public']['Tables']['sets']['Update'] = {
        title: input.title.trim(),
        slug,
        description: input.description?.trim() ?? '',
        playlist_url: playlistUrl,
        quote_fragment_id: input.quote_fragment_id ?? null,
        status: input.status,
      };

      if (input.id) {
        const { error } = await sb.from('sets').update(row).eq('id', input.id);
        if (error) throw fail(error.message);
        return { ok: true, id: input.id, slug };
      }

      /*
        A new set lands at the end. `sort` is authored order and the index
        rewrites it wholesale on reorder, so the only thing this has to get
        right is "not in front of something already placed".
      */
      const { data: last } = await sb.from('sets').select('sort').order('sort', { ascending: false }).limit(1);
      const { data, error } = await sb
        .from('sets')
        .insert({ ...row, sort: (last?.[0]?.sort ?? 0) + 1 } as Database['public']['Tables']['sets']['Insert'])
        .select('id')
        .single();
      if (error) throw fail(error.message);
      return { ok: true, id: data.id, slug };
    },
  }),

  setStatus: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid(), status: setStatus }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const { error } = await ctx.locals.supabase.from('sets').update({ status: input.status }).eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),

  reorder: defineAction({
    accept: 'form',
    input: z.object({ ids: z.string() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;
      const ids = input.ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!ids.length) return { ok: true };
      /*
        Positions are authored order, rewritten 1..n — the same rule
        `constellations.reorder` follows. Sequential rather than batched
        because seven rows is not worth an rpc, and a partial failure leaves a
        readable order rather than a scrambled one.
      */
      for (const [i, id] of ids.entries()) {
        const { error } = await sb
          .from('sets')
          .update({ sort: i + 1 })
          .eq('id', id);
        if (error) throw fail(error.message);
      }
      return { ok: true };
    },
  }),

  remove: defineAction({
    accept: 'form',
    input: z.object({ id: z.uuid() }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      /*
        ⚠ A HARD DELETE, AND IT IS SAFE IN A WAY THE CORPUS IS NOT. Fragments
        soft-delete because a lost essay is unrecoverable; a set is a title, a
        sentence and a link, and the playlist it points at lives in Spotify and
        is untouched. There is nothing here that a minute of retyping cannot
        restore, so a `deleted_at` column would be a bin nobody ever opens.
      */
      const { error } = await ctx.locals.supabase.from('sets').delete().eq('id', input.id);
      if (error) throw fail(error.message);
      return { ok: true };
    },
  }),
};
