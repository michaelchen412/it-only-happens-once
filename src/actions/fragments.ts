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
import { lookupSong, parseSongRef, songRefUrl } from '../lib/media';
import { provenanceLine } from '../lib/provenance';
import type { Database, Json } from '../lib/database.types';
import { type DB, fail, fragmentStatus, requireAdmin, uniqueSlug, optText, optUrl, optInt, optUuid } from './_shared';

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
  const { error } = await sb
    .from('works')
    .upsert({ title: t, slug, author_id: authorId ?? null }, { onConflict: 'slug', ignoreDuplicates: true });
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
    .in(
      'slug',
      rows.map((r) => r.slug),
    );
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

  const published_at = publishing ? (existing?.published_at ?? now) : (existing?.published_at ?? null);

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
      status: fragmentStatus,
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
      /**
       * The per-quote OVERRIDE, and nothing else (docs/plans/17a). Absent means
       * "derive it", which is the case for every quote in the corpus. It is
       * still the column both public renderers read, so it is written on every
       * save — just never typed.
       */
      attribution: optText,
      /** WHERE in the work: "Book 2:2", "John 3:16", "Letter 24:19–20, p. 19". */
      citation: optText,
      source_url: optUrl,
      // provenance facets. The combo submits an id when an existing entity was
      // chosen; the *_name is only used to create-by-name when the id is absent.
      author_id: optUuid, // WHO
      work_id: optUuid, //   FROM
      author_name: optText,
      work_name: optText,
      occurred_at: optText, // datetime-local override for legacy quotes; absent = automatic
      status: fragmentStatus,
      subjects: optText,
      slug: optText,
    }),
    handler: async (input, ctx) => {
      const sb = ctx.locals.supabase;
      // ⚠ `details` IS DOWN TO ONE KEY, and that is the whole story of plan 17.
      // It is a drawer, not a schema: a key here is write-only until something
      // renders it, and nothing warns you when nothing does. Four have gone —
      // `source_author` and `work_year` (0 rows each, dead in three files),
      // `source_title` (42 rows, 41 of them a verbatim copy of `works.title`,
      // labelled in the form as "shown after the attribution" and shown in
      // exactly zero places a reader could reach), and `page` (7 rows, folded
      // into the locator beside it — "p. 41" is a reference like any other).
      // What is left is the WHERE, and it is about to get a public surface.
      const details: Record<string, Json> = {};
      if (input.citation) details.citation = input.citation;
      // Prefer the chosen entity's id; fall back to creating one by name.
      let author_id = input.author_id ?? (await resolveAuthor(sb, input.author_name));
      const work_id = input.work_id ?? (await resolveWork(sb, input.work_name, author_id));
      // Integrity: a work belongs to one author, so the work's canonical author is
      // authoritative — this keeps fragment.author_id and work.author_id from ever
      // disagreeing (e.g. "Letters from a Stoic" can't be filed under Ocean Vuong),
      // even if the client sent a mismatched pair. Authorless works (The Bible)
      // leave the chosen author untouched.
      let workTitle: string | null = null;
      if (work_id) {
        const { data: w } = await sb.from('works').select('author_id, title').eq('id', work_id).single();
        if (w?.author_id) author_id = w.author_id;
        workTitle = w?.title ?? null;
      }
      // ⚠ THE SHOWN LINE IS DERIVED HERE, FROM WHAT WAS ACTUALLY STORED — not
      // in the browser, and not from the names the form happened to send.
      //
      // The sheet computes the same line for its preview, and that duplication
      // is deliberate: the preview has to be instant. But only ONE of the two
      // may be authoritative, and it has to be the one that also decides
      // `author_id` — otherwise the work-wins snap just above could reassign the
      // author while the client's line went on naming the old one. Re-reading
      // the canonical name costs a round trip on an admin save and removes an
      // entire class of "the label doesn't match the facet" bug.
      let authorName: string | null = null;
      if (author_id) {
        const { data: a } = await sb.from('authors').select('name').eq('id', author_id).single();
        authorName = a?.name ?? null;
      }
      const derived = provenanceLine({ who: authorName, from: workTitle, where: input.citation });
      // An explicit override wins; otherwise the derivation; otherwise silence,
      // which both renderers already handle by drawing no line at all.
      const attribution = input.attribution?.trim() || derived || null;
      const base = input.slug || `${attribution ?? ''} ${firstWords(input.body)}`;
      const slug = await uniqueSlug(sb, slugify(base), input.id);
      const row: Omit<FragmentInsert, 'id' | 'published_at'> = {
        type: 'quote',
        title: null,
        slug,
        body: input.body,
        attribution,
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
   * Create or edit a `song` fragment. Title/art/artist/album come from the
   * Spotify Web API when it's configured (docs/plans/04 Piece 4) and are
   * editable regardless — a five-artist track joins to a mouthful nobody wants
   * as an attribution. `body` is the ANNOTATION — Michael's words on why this
   * song (ADR-0009), which is what makes a song a fragment rather than a link.
   * It is optional, always: a song may say nothing and simply play.
   */
  saveSong: defineAction({
    accept: 'form',
    input: z.object({
      id: optText,
      spotify_url: z.string().url('Paste a Spotify or YouTube link'),
      title: z.string().min(1, 'A song title is required'),
      attribution: z.string().min(1, 'Who’s the artist?'),
      album: optText,
      body: optText,
      thumbnail_url: optText,
      /** Web API extras, carried as hidden fields so provenance can be exact. */
      release_year: optInt,
      spotify_artist_ids: optText,
      spotify_album_id: optText,
      year: z.coerce.number().int(),
      status: fragmentStatus,
      subjects: optText,
      slug: optText,
    }),
    handler: async (input, ctx) => {
      const sb = ctx.locals.supabase;
      // The URL is the single source of truth for what's being cited — the id
      // and the kind both come from it, so a stale hidden field can't disagree.
      const ref = parseSongRef(input.spotify_url);
      if (!ref) throw fail('That doesn’t look like a Spotify track, album, or YouTube link', 'BAD_REQUEST');
      const slug = await uniqueSlug(sb, slugify(input.slug || `${input.title} ${input.attribution}`), input.id);
      // `spotify_id` stays the key for Spotify refs so existing rows keep their
      // meaning; a YouTube citation records its own id under its own name.
      const details: Record<string, Json> =
        ref.provider === 'youtube' ? { youtube_id: ref.id } : { spotify_id: ref.id };
      if (input.album) details.album = input.album;
      if (input.thumbnail_url) details.thumbnail_url = input.thumbnail_url;
      // The release year is the ALBUM's claim, kept distinct from `occurred_at`,
      // which on a song means the year you added it (docs/plans/04 open qs).
      if (input.release_year) details.release_year = input.release_year;
      if (input.spotify_album_id) details.spotify_album_id = input.spotify_album_id;
      if (input.spotify_artist_ids) {
        details.spotify_artist_ids = input.spotify_artist_ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      // provenance facets follow the shown fields: artist → author, album → work
      const author_id = await resolveAuthor(sb, input.attribution);
      const work_id = await resolveWork(sb, input.album, author_id);
      const row: Omit<FragmentInsert, 'id' | 'published_at'> = {
        type: 'song',
        title: input.title,
        slug,
        body: input.body?.trim() || null,
        attribution: input.attribution,
        // Canonical, not what was pasted: Spotify's share sheet appends a `?si=`
        // tracking token, and that token has no business on a public page.
        source_url: songRefUrl(ref),
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
          'id, type, title, slug, excerpt, body, status, occurred_at, updated_at, fragment_subjects(subjects(name)), fragment_constellations(constellation_id), paired_song:paired_song_id(id, title, attribution, deleted_at)',
        )
        .eq('id', id)
        .single();
      if (error || !data) throw fail('That fragment no longer exists', 'NOT_FOUND');
      // The Music tab shows what's paired without a second round trip. A
      // soft-deleted song reads as no pairing — same rule as pairedMediaOf.
      const song = data.paired_song as {
        id: string;
        title: string | null;
        attribution: string | null;
        deleted_at: string | null;
      } | null;
      const paired =
        song && !song.deleted_at
          ? { id: song.id, title: song.title ?? '(untitled)', artist: song.attribution ?? '' }
          : null;
      return {
        paired,
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
      const { data: taxonomy, error } = await ctx.locals.supabase
        .from('subjects')
        .select('name, definition')
        .order('name');
      if (error) throw fail(error.message);
      try {
        const { suggestSubjects } = await import('../lib/suggest-subjects');
        return await suggestSubjects(text, kind, apiKey, taxonomy ?? []);
      } catch (e) {
        // This catch used to discard the reason and report EVERY failure as
        // "couldn't reach the model" — including a 400 whose body said, in
        // plain words, that the account was out of credit. That sends you
        // looking at your network for a billing problem. The action is
        // admin-gated, so the API's own message is both safe to show and the
        // only thing that says where to go.
        const err = e as { status?: number; error?: { error?: { message?: string } } } | null;
        const detail = err?.error?.error?.message;
        console.error('[suggestSubjects] model call failed', err?.status ?? '', detail ?? e);
        if (detail) throw fail(`The model refused this: ${detail}`, 'BAD_REQUEST');
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

  /**
   * Triage a brain dump INTO an existing piece (14 · Piece 1, §5).
   *
   * The other motion out of the pile — *make it a piece* — is a status flip on
   * the row you already typed: no copy, no second row, nothing to keep in step.
   * This one cannot be. You are merging two texts, so the words are genuinely
   * copied, and that is exactly why the dump is CONSUMED rather than left
   * behind: a pile that keeps showing you a thought you have already filed is a
   * pile you stop trusting, and two copies of one paragraph is the sync problem
   * ADR-0010 paid to delete.
   *
   * ⚠ COMPARE-AND-SET ON THE TARGET, not a blind append — and it is worth
   * being exact about what that does and does not buy, because the obvious
   * reading is wrong. This is a read-modify-write: the body is fetched, the
   * dump is concatenated onto it, the result is written back. The `.eq` closes
   * THAT window — two appends racing, or a save landing between the read and
   * the write, which would otherwise silently drop one of them.
   *
   * What protects against the other direction — a writing sheet open in another
   * tab, holding a copy of the body from before this append — is not here at
   * all. It is `saveWriting`'s own `base_updated_at` guard, and this write
   * arms it by moving `updated_at`: the stale tab's next autosave matches zero
   * rows and surfaces as CONFLICT rather than as a silent overwrite.
   *
   * Bodies are Markdown, so the join is a blank line and nothing more. No
   * separator, no timestamp, no "— from a note" marker: the dump becomes the
   * last paragraph of the piece and you move it where it belongs in the editor.
   * A marker would be a thing to delete every single time.
   */
  appendToPiece: defineAction({
    input: z.object({ noteId: z.string().uuid(), targetId: z.string().uuid() }),
    handler: async ({ noteId, targetId }, ctx) => {
      requireAdmin(ctx);
      const sb = ctx.locals.supabase;

      const { data: note } = await sb
        .from('fragments')
        .select('id, body')
        .eq('id', noteId)
        .eq('status', 'note') // only a dump can be filed this way
        .is('deleted_at', null)
        .maybeSingle();
      if (!note) throw fail('That note is no longer in the pile', 'NOT_FOUND');
      if (!note.body?.trim()) throw fail('There’s nothing in that note to add', 'BAD_REQUEST');

      const { data: target } = await sb
        .from('fragments')
        .select('id, title, slug, body, updated_at')
        .eq('id', targetId)
        .eq('type', 'writing')
        .neq('status', 'note') // a dump is not a destination
        .is('deleted_at', null)
        .maybeSingle();
      if (!target) throw fail('That piece no longer exists', 'NOT_FOUND');

      const joined = [target.body?.replace(/\s+$/, ''), note.body.trim()].filter(Boolean).join('\n\n');
      const { data: written, error } = await sb
        .from('fragments')
        .update({ body: joined })
        .eq('id', targetId)
        .eq('updated_at', target.updated_at)
        .select('id')
        .maybeSingle();
      if (error) throw fail(error.message);
      if (!written) throw fail('That piece changed while this was open — open the pile again', 'CONFLICT');

      // Soft, so the undo strip has something to restore. Only once the append
      // is known to have landed: the reverse order could eat a thought on a
      // failed write.
      const { error: delErr } = await sb
        .from('fragments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', noteId);
      if (delErr) throw fail(delErr.message);

      return { title: target.title ?? '', slug: target.slug };
    },
  }),

  /** Bulk actions over a comma-joined id list. */
  bulk: defineAction({
    accept: 'form',
    input: z.object({
      ids: z.string().min(1),
      // 'draft' and 'note' are plain tier moves, named for the tier they land
      // in — they run in either direction along note → draft → published.
      op: z.enum(['publish', 'draft', 'note', 'trash', 'restore', 'purge']),
    }),
    handler: async (input, ctx) => {
      const sb = ctx.locals.supabase;
      const ids = input.ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
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
        // 'draft' | 'note' — the op IS the tier. `published_at` is deliberately
        // left alone: it records when a piece first went live, not where it is.
        const { error } = await sb.from('fragments').update({ status: input.op }).in('id', ids);
        if (error) throw fail(error.message);
      }
      return { ok: true, count: ids.length };
    },
  }),
};

export const songs = {
  /**
   * Resolve a pasted track / album / video link to everything we can learn
   * about it. Answers from the Spotify Web API when credentials are configured
   * and falls back to oEmbed otherwise — `source` says which, so the sheet can
   * explain why the artist field is still empty rather than looking broken.
   */
  lookup: defineAction({
    input: z.object({ url: z.string().min(1).max(500) }),
    handler: async (input, ctx) => {
      requireAdmin(ctx);
      const found = await lookupSong(input.url);
      if (!found) throw fail('Couldn’t read that link — Spotify track/album or YouTube video, please', 'BAD_REQUEST');
      return found;
    },
  }),

  /**
   * Songs to choose from when pairing one to an essay (ADR-0009 "paired
   * media"). Newest first with no term, so the picker opens on what you added
   * most recently — which after the backfill is what you were just editing.
   */
  search: defineAction({
    input: z.object({ q: optText }),
    handler: async ({ q }, ctx) => {
      requireAdmin(ctx);
      let query = ctx.locals.supabase
        .from('fragments')
        .select('id, title, attribution, body')
        .eq('type', 'song')
        .is('deleted_at', null)
        .order('occurred_at', { ascending: false })
        .limit(20);
      // PostgREST `.or()` values can't contain its own delimiters.
      const term = (q ?? '')
        .replace(/[%,()\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (term) query = query.or(`title.ilike.%${term}%,attribution.ilike.%${term}%`);
      const { data, error } = await query;
      if (error) throw fail(error.message);
      return (data ?? []).map((s) => ({
        id: s.id,
        title: s.title ?? '(untitled)',
        artist: s.attribution ?? '',
        /** Whether it has an annotation — the picker marks the ones that speak. */
        annotated: Boolean(s.body?.trim()),
      }));
    },
  }),

  /**
   * Pair a song to an essay, or clear the pairing (`song_id` absent).
   *
   * Applies IMMEDIATELY, like constellation membership and for the same reason:
   * it is a relation, not a field of the document, so it must not ride along
   * with saveWriting's compare-and-set — pairing a song should never be able to
   * lose a rewrite, and a draft must be pairable without a publish dialog.
   *
   * This is where `type = 'song'` is enforced. The FK deliberately doesn't (see
   * the migration: a composite FK would need a generated column, which can't be
   * nulled, which would break ON DELETE SET NULL) — so the check lives here,
   * where it can be a sentence instead of a constraint name.
   */
  pair: defineAction({
    input: z.object({ fragment_id: z.string().uuid(), song_id: optUuid }),
    handler: async ({ fragment_id, song_id }, ctx) => {
      const sb = ctx.locals.supabase;
      if (song_id) {
        if (song_id === fragment_id) throw fail('A piece can’t be paired with itself.', 'BAD_REQUEST');
        const { data: song } = await sb
          .from('fragments')
          .select('id, type, deleted_at')
          .eq('id', song_id)
          .maybeSingle();
        if (!song || song.deleted_at) throw fail('That song no longer exists.', 'NOT_FOUND');
        if (song.type !== 'song') throw fail('Only a song can be paired to a piece of writing.', 'BAD_REQUEST');
      }
      // `.eq('type', 'writing')` so this can only ever touch an essay. RLS is
      // still the boundary — a non-admin's update matches zero rows regardless.
      const { data, error } = await sb
        .from('fragments')
        .update({ paired_song_id: song_id ?? null })
        .eq('id', fragment_id)
        .eq('type', 'writing')
        .select('id')
        .maybeSingle();
      if (error) throw fail(error.message);
      if (!data) throw fail('That piece no longer exists.', 'NOT_FOUND');
      return { ok: true, songId: song_id ?? null };
    },
  }),
};
