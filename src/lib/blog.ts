// Queries for the public blog — the Index (design.md §4). Kept out of the
// .astro pages so they stay lean, and shared by the feed, the permalink page,
// and (later) the constellation views. All reads go through the anon SSR client
// and rely on the public RLS policies (published, non-deleted fragments only).
import type { createSupabaseServerClient } from './supabase';
// ⚠ THE TYPE, NOT A PRIVATE COPY OF IT. This file used to re-declare
// `'writing' | 'quote' | 'song'` near the bottom, which made the public feed a
// fourth owner of the corpus's own vocabulary (plans/29 · §3). `TYPE_META` is
// pure presentation constants with no imports of its own, so this costs the
// public bundle nothing.
import type { FragmentType } from './fragments-display';
import { getQuoteNeighbourhoods, type QuotePage, type QuoteSeed } from './quote-page';
import { excerpt, readingMinutes } from './markdown';
import { revealOf } from './provenance';

type DB = ReturnType<typeof createSupabaseServerClient>;

/** Full essays per feed page (design.md: a generous sitting, not an endless scroll). */
export const PAGE_SIZE = 7;
/** Quotes are short, so more fit per page. */
export const QUOTES_PAGE_SIZE = 25;

export interface SubjectRef {
  name: string;
  slug: string;
}

/**
 * The song paired with one essay — *this song goes with this piece* (ADR-0009).
 *
 * NORMALISED OVER TWO SOURCES. The renderer treats them identically; only
 * `fragmentId` records which answered, and only so a caller that needs to link
 * back to the song can:
 *
 *   1. `paired_song_id` → a real `song` fragment. What the backfill promoted
 *      the 48 citable pairings to, and what the writing sheet's picker sets.
 *   2. `details.media` → the raw `{ provider, url }` Squarespace brought over.
 *      Only two rows still take this path — the imported *playlists*, which
 *      ADR-0009 forbids a song fragment from citing. It is a fallback, not a
 *      second write path: nothing in the app writes `details.media`.
 *
 * The legacy path has no title and no artist, so its caption is empty and the
 * embed speaks for itself. That is fine for a playlist, which names itself.
 */
export interface PairedMedia {
  /** The song fragment's id, or null when this came from `details.media`. */
  fragmentId: string | null;
  /** Empty on the legacy path — render no caption rather than a fake one. */
  title: string;
  artist: string | null;
  /** What to embed. Parsed by the renderer, which owns provider knowledge. */
  url: string;
}

export interface WritingItem {
  id: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  excerpt: string;
  /** Whether the body is longer than the excerpt shown (→ show "Read more"). */
  hasMore: boolean;
  occurredAt: string;
  updatedAt: string | null;
  precision: 'day' | 'year';
  readMinutes: number;
  subjects: SubjectRef[];
  /** The paired song, if this piece has one (ADR-0009). */
  paired: PairedMedia | null;
  /** The closing strip's neighbourhood, when a caller has loaded it. Absent on
   *  a card that only ever renders an excerpt (plan 32 · §11). */
  neighbourhood?: QuotePage | null;
}

export interface QuoteItem {
  id: string;
  slug: string;
  body: string;
  attribution: string | null;
  /**
   * What the citation reveal opens onto — "Meditations, Book 2:2", "The Bible",
   * "Michael Chen" — or `''` when there is genuinely nothing behind the line,
   * in which case no control renders at all.
   *
   * Derived here rather than in the component so both public surfaces (the feed
   * and a constellation suite) get the same string from one place. `attribution`
   * stays the LINE and is still read straight from the column.
   */
  reveal: string;
  sourceUrl: string | null;
  occurredAt: string;
  precision: 'day' | 'year';
  subjects: SubjectRef[];
}

export interface RailSubject extends SubjectRef {
  /** Contextual narrowing count: fragments matching the current search AND every
   *  already-selected subject AND this one. This is what disables a dead-end. */
  count: number;
  /** Global count for this type — stable ordering for the rail, and the rank the
   *  feed threads through to sort each card's own tags busiest-first. */
  total: number;
  /** In the current selection (rendered as a removable, active chip). */
  selected: boolean;
  /** Nothing combines this with the current filter → shown muted, not clickable. */
  disabled: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
}

/** PostgREST `.or()` values can't contain its delimiters; strip them from search. */
function sanitizeQuery(q: string): string {
  return q
    .replace(/[%,()\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The embed that fetches an essay's paired song, plus the legacy column.
 *
 * `paired_song:paired_song_id(...)` — the COLUMN-name hint, not the constraint
 * name. `fragments!fragments_paired_song_id_fkey(...)` looks more explicit and
 * is what you'd write from habit, but PostgREST answers it with PGRST200 for a
 * self-referencing FK (verified against live 2026-07-31). Don't "fix" this.
 *
 * RLS does the security here, not the query: the embed applies the fragments
 * policies a second time, so an anon reader whose paired song is a draft gets
 * `paired_song: null` and the essay simply renders without one. There is no
 * status filter below because there must not be one — the admin preview is
 * supposed to see its own drafts (plan 01), and the boundary is the policy.
 *
 * THE RAW `paired_song_id` IS SELECTED TOO, and it is load-bearing. Without it,
 * a hidden song and a never-promoted essay look identical — both arrive as
 * `paired_song: null` — and `pairedMediaOf` would fall back to `details.media`,
 * which every one of the 48 promoted essays still carries. Unpublishing a song
 * would then keep playing it from the legacy URL. Found by probe, not by
 * reading: the embed correctly returned null and the page still showed a
 * player.
 */
export const PAIRED_SELECT =
  'paired_song_id, paired_song:paired_song_id(id, title, attribution, source_url, deleted_at), details';

/**
 * Shape of what PAIRED_SELECT adds to a row. `details` is `unknown` on purpose:
 * its four callers each have a different idea of that column's type (the
 * generated `Json`, `Record<string, unknown>`, and PostgREST's inference), and
 * the read below is a runtime shape check anyway. Narrowing it here would only
 * force a cast at every call site.
 */
interface PairedRow {
  paired_song_id?: string | null;
  paired_song?: {
    id: string;
    title: string | null;
    attribution: string | null;
    source_url: string | null;
    deleted_at: string | null;
  } | null;
  details?: unknown;
}

/**
 * Normalise a row's pairing to one shape, from either source.
 *
 * THE ORDER OF THESE BRANCHES IS THE SECURITY PROPERTY, not a preference:
 *
 *   1. `paired_song_id` set → the song row is the ONLY truth. If the embed came
 *      back null (RLS hid an unpublished song) or the row is soft-deleted, the
 *      answer is NO PAIRING. It must not fall through.
 *   2. `paired_song_id` null → this essay was never promoted, so the legacy
 *      `details.media` is all there is. Two imported playlists live here.
 *
 * Falling through from 1 to 2 is the bug this shape exists to prevent: all 48
 * promoted essays still carry `details.media` pointing at the same track, so
 * unpublishing a song would have gone on playing it from the legacy URL.
 */
export function pairedMediaOf(row: PairedRow): PairedMedia | null {
  if (row.paired_song_id) {
    const song = row.paired_song;
    // A soft-deleted song is not a pairing. The FK can't see `deleted_at`, so
    // it still resolves — trash would otherwise keep playing on a live essay.
    if (!song || song.deleted_at || !song.source_url) return null;
    return {
      fragmentId: song.id,
      title: song.title ?? '',
      artist: song.attribution,
      url: song.source_url,
    };
  }
  const media = (row.details as { media?: { url?: string } } | null)?.media;
  if (media?.url) {
    return { fragmentId: null, title: '', artist: null, url: media.url };
  }
  return null;
}

/** Flatten the embedded `fragment_subjects(subjects(...))` shape. With a `rank`
 *  map (slug → global count) subjects come out busiest-first — so a capped card
 *  keeps the most-used tags — with name as the tiebreak; without it, by name. */
function subjectsOf(
  row: { fragment_subjects?: { subjects: SubjectRef | null }[] | null },
  rank?: Map<string, number>,
): SubjectRef[] {
  const subs = (row.fragment_subjects ?? []).map((fs) => fs.subjects).filter((s): s is SubjectRef => !!s);
  return rank
    ? subs.sort((a, b) => (rank.get(b.slug) ?? 0) - (rank.get(a.slug) ?? 0) || a.name.localeCompare(b.name))
    : subs.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve subject slugs to the ids of the fragments tagged with EVERY one of
 *  them (AND / intersection; the caller's `.eq('type', …)` narrows by type).
 *  `null` = no subject filter (empty input). `[]` = an unsatisfiable combination
 *  — an unknown slug, or simply no fragment carries them all — so the caller
 *  renders an empty feed. */
async function fragmentIdsForSubjects(supabase: DB, slugs: string[]): Promise<string[] | null> {
  const wanted = Array.from(new Set(slugs.filter(Boolean)));
  if (wanted.length === 0) return null;

  const { data: subs } = await supabase.from('subjects').select('id, slug').in('slug', wanted);
  if (!subs || subs.length !== wanted.length) return []; // a slug didn't resolve → AND impossible
  const ids = subs.map((s) => s.id);

  const { data: links } = await supabase
    .from('fragment_subjects')
    .select('fragment_id, subject_id')
    .in('subject_id', ids);
  // A fragment satisfies the AND iff it links to all selected subjects. Track a
  // Set per fragment so a duplicate link can never fake a match.
  const perFragment = new Map<string, Set<string>>();
  for (const l of links ?? []) {
    let set = perFragment.get(l.fragment_id);
    if (!set) perFragment.set(l.fragment_id, (set = new Set()));
    set.add(l.subject_id);
  }
  const result: string[] = [];
  for (const [fid, set] of perFragment) if (set.size === ids.length) result.push(fid);
  return result;
}

/** One page of published writing, newest first, optionally narrowed by an AND of
 *  subjects and/or a search term. */
export async function listWriting(
  supabase: DB,
  opts: { page?: number; subjects?: string[] | null; q?: string | null; subjectRank?: Map<string, number> } = {},
): Promise<Page<WritingItem>> {
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q ? sanitizeQuery(opts.q) : '';

  let ids: string[] | null = null;
  if (opts.subjects && opts.subjects.length > 0) {
    ids = await fragmentIdsForSubjects(supabase, opts.subjects);
    if (!ids || ids.length === 0) {
      return { items: [], total: 0, page, pageCount: 0 };
    }
  }

  const from = (page - 1) * PAGE_SIZE;
  let query = supabase
    .from('fragments')
    .select(
      `id, slug, title, body, excerpt, occurred_at, updated_at, date_precision, fragment_subjects(subjects(name, slug)), ${PAIRED_SELECT}`,
      { count: 'exact' },
    )
    .eq('type', 'writing')
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (ids) query = query.in('id', ids);
  if (q) query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`);

  const { data, count } = await query;
  const items: WritingItem[] = (data ?? []).map((r) => {
    const authored = (r.excerpt ?? '').trim();
    const lede = authored || excerpt(r.body, 400);
    const full = (r.body ?? '').trim();
    return {
      id: r.id,
      slug: r.slug,
      title: r.title || '(untitled)',
      bodyMarkdown: r.body ?? '',
      excerpt: lede,
      hasMore: full.length > lede.length,
      occurredAt: r.occurred_at,
      updatedAt: r.updated_at ?? null,
      precision: r.date_precision,
      readMinutes: readingMinutes(r.body),
      subjects: subjectsOf(r, opts.subjectRank),
      paired: pairedMediaOf(r),
    };
  });

  const total = count ?? items.length;
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** One page of published quotes, newest first, optionally narrowed by an AND of
 *  subjects and/or a search term. */
export async function listQuotes(
  supabase: DB,
  opts: {
    page?: number;
    subjects?: string[] | null;
    q?: string | null;
    /**
     * An `authors.slug` — everything by one person (plan 32 · §5). The quote
     * page's attribution opens onto this: *"a way to view all the quotes by
     * that attribution"*.
     *
     * ⚠ IT RESOLVES TO `author_id` AND FILTERS ON THAT, never on the
     * `attribution` string. That column is a DERIVED LINE (lib/provenance.ts) —
     * three published quotes carry one with no author row behind it, and a
     * `.ilike` on it would be a text search wearing a facet's clothes: it would
     * match a quote whose body mentions the name, and miss one filed correctly
     * under an override. The facet is the fact; the line is the rendering.
     */
    author?: string | null;
    subjectRank?: Map<string, number>;
  } = {},
): Promise<Page<QuoteItem>> {
  const page = Math.max(1, opts.page ?? 1);
  const searchTerm = opts.q ? sanitizeQuery(opts.q) : '';

  let authorId: string | null = null;
  if (opts.author) {
    const { data: a } = await supabase.from('authors').select('id').eq('slug', opts.author).maybeSingle();
    // ⚠ An unknown slug matches NOTHING rather than being silently ignored —
    // the same rule `fragment-query.ts` uses for an unknown constellation. A
    // dropped filter would show the whole corpus under a heading naming one
    // person, which reads as an answer rather than as a typo.
    if (!a) return { items: [], total: 0, page, pageCount: 0 };
    authorId = a.id;
  }

  let ids: string[] | null = null;
  if (opts.subjects && opts.subjects.length > 0) {
    ids = await fragmentIdsForSubjects(supabase, opts.subjects);
    if (!ids || ids.length === 0) {
      return { items: [], total: 0, page, pageCount: 0 };
    }
  }

  const from = (page - 1) * QUOTES_PAGE_SIZE;
  let query = supabase
    .from('fragments')
    // authors/works reach the public site for the first time here (2026-08-05,
    // plan 17a) — only to build the reveal. Both are `select` -> true for anon
    // in RLS, verified before this shipped; a policy change that closed them
    // would empty the reveal rather than break the page.
    .select(
      'id, slug, body, attribution, is_self, details, source_url, occurred_at, date_precision, authors(name), works(title), fragment_subjects(subjects(name, slug))',
      {
        count: 'exact',
      },
    )
    .eq('type', 'quote')
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
    .range(from, from + QUOTES_PAGE_SIZE - 1);

  if (ids) query = query.in('id', ids);
  if (authorId) query = query.eq('author_id', authorId);
  if (searchTerm) query = query.or(`body.ilike.%${searchTerm}%,attribution.ilike.%${searchTerm}%`);

  const { data, count } = await query;
  const items: QuoteItem[] = (data ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    body: r.body ?? '',
    attribution: r.attribution ?? null,
    reveal: revealOf(r),
    sourceUrl: r.source_url ?? null,
    occurredAt: r.occurred_at,
    precision: r.date_precision,
    subjects: subjectsOf(r, opts.subjectRank),
  }));

  const total = count ?? items.length;
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / QUOTES_PAGE_SIZE)) };
}

/** The tier a piece is in. Only the single-post fetch below reports it — every
 *  other query in this file is published-only by construction. */
export type WritingStatus = 'note' | 'draft' | 'published';

/** A single essay plus the one thing the permalink page needs that a feed card
 *  never does: whether what you're looking at is actually public. */
export interface WritingPost extends WritingItem {
  status: WritingStatus;
  /**
   * The closing strip's neighbourhood — the constellations this piece sits in
   * and the lines it is kin to (plan 32 · §11).
   *
   * ⚠ NULL WHEN THE CALLER DID NOT ASK. A feed page renders seven of these into
   * reader templates, and loading each one's neighbourhood separately would be
   * twenty-eight round trips on the site's busiest route. The feed asks ONCE for
   * all seven (`attachNeighbourhoods`); the permalink asks for its own.
   */
  neighbourhood: QuotePage | null;
}

/**
 * A single essay by slug, with its subjects. `null` if not found.
 *
 * `includeUnpublished` drops the app-side status filter so the admin can preview
 * a draft (or a note) on its real public page — the constellation precedent
 * (`getConstellation`), finally extended to essays (docs/plans/01).
 *
 * It is NOT the trust boundary; RLS is. `fragments_select_published` still
 * limits anon and any non-admin session to published rows, so passing `true`
 * for the wrong viewer widens nothing — it just stops narrowing something the
 * database was already narrowing. Trashed pieces stay out either way, and the
 * feed/related/adjacent queries above are deliberately untouched: a draft is
 * reachable by direct URL only, never listed.
 */
export async function getWritingBySlug(
  supabase: DB,
  slug: string,
  opts: { includeUnpublished?: boolean } = {},
): Promise<WritingPost | null> {
  let query = supabase
    .from('fragments')
    .select(
      `id, slug, title, body, excerpt, status, occurred_at, updated_at, date_precision, fragment_subjects(subject_id, subjects(name, slug)), ${PAIRED_SELECT}`,
    )
    .eq('type', 'writing')
    .is('deleted_at', null)
    .eq('slug', slug);
  // `fragments.slug` is UNIQUE across every type, so this stays a single row.
  if (!opts.includeUnpublished) query = query.eq('status', 'published');

  const { data: r } = await query.maybeSingle();
  if (!r) return null;

  const lede = (r.excerpt ?? '').trim() || excerpt(r.body, 400);
  // One essay, so the batch is a batch of one — but it is the SAME function the
  // feed and the suite call, which is what stops "related" from meaning three
  // things on three surfaces.
  const [neighbourhood] = [
    ...(
      await getQuoteNeighbourhoods(supabase, [
        {
          id: r.id,
          subjectIds: ((r.fragment_subjects ?? []) as { subject_id: string }[]).map((fs) => fs.subject_id),
        },
      ])
    ).values(),
  ];
  return {
    status: r.status,
    neighbourhood: neighbourhood ?? null,
    id: r.id,
    slug: r.slug,
    title: r.title || '(untitled)',
    bodyMarkdown: r.body ?? '',
    excerpt: lede,
    hasMore: (r.body ?? '').trim().length > lede.length,
    occurredAt: r.occurred_at,
    updatedAt: r.updated_at ?? null,
    precision: r.date_precision,
    readMinutes: readingMinutes(r.body),
    subjects: subjectsOf(r),
    paired: pairedMediaOf(r),
  };
}

/**
 * The subject taxonomy that actually has published fragments of `type`, each
 * annotated for a STACKABLE rail: its global count, its contextual narrowing
 * count against the current filter, and whether it's selected / a dead-end.
 *
 * Faceted-search convention: `count` is how many results REMAIN if you add this
 * subject to what's already chosen (an AND across selected subjects, intersected
 * with the search term). count === 0 (and not already selected) ⇒ disabled, so
 * the rail can only ever offer combinations that exist. Ordering stays by global
 * `total` so tags don't reshuffle as you filter — only their numbers change.
 */
export async function listSubjects(
  supabase: DB,
  type: FragmentType,
  opts: { selected?: string[]; q?: string | null } = {},
): Promise<RailSubject[]> {
  const selected = Array.from(new Set((opts.selected ?? []).filter(Boolean)));
  const q = opts.q ? sanitizeQuery(opts.q) : '';

  // Every (fragment, subject) link for published, non-deleted fragments of this
  // type — enough to build the taxonomy AND the per-fragment subject sets below.
  const { data: links } = await supabase
    .from('fragment_subjects')
    .select('fragment_id, subjects(name, slug), fragments!inner(type, status, deleted_at)')
    .eq('fragments.type', type)
    .eq('fragments.status', 'published')
    .is('fragments.deleted_at', null);

  const fragSubs = new Map<string, Set<string>>(); // fragment id → its subject slugs
  const meta = new Map<string, { name: string; total: number }>(); // slug → name + global count
  for (const l of links ?? []) {
    const s = (l as { subjects: SubjectRef | null }).subjects;
    if (!s) continue;
    let set = fragSubs.get(l.fragment_id);
    if (!set) fragSubs.set(l.fragment_id, (set = new Set()));
    if (set.has(s.slug)) continue; // ignore any duplicate link
    set.add(s.slug);
    const m = meta.get(s.slug);
    if (m) m.total++;
    else meta.set(s.slug, { name: s.name, total: 1 });
  }

  // Which fragments match the search term (null → no term, so everything does).
  let matchIds: Set<string> | null = null;
  if (q) {
    const or = type === 'quote' ? `body.ilike.%${q}%,attribution.ilike.%${q}%` : `title.ilike.%${q}%,body.ilike.%${q}%`;
    const { data } = await supabase
      .from('fragments')
      .select('id')
      .eq('type', type)
      .eq('status', 'published')
      .is('deleted_at', null)
      .or(or);
    matchIds = new Set((data ?? []).map((r) => r.id));
  }

  // Base set B = fragments matching the term AND carrying every selected subject.
  // For each subject, count how many B-fragments also carry it → its rail count.
  const ctx = new Map<string, number>();
  for (const [fid, set] of fragSubs) {
    if (matchIds && !matchIds.has(fid)) continue;
    if (!selected.every((sl) => set.has(sl))) continue;
    for (const sl of set) ctx.set(sl, (ctx.get(sl) ?? 0) + 1);
  }

  const selectedSet = new Set(selected);
  return Array.from(meta.entries())
    .map(([slug, m]) => {
      const isSelected = selectedSet.has(slug);
      const count = ctx.get(slug) ?? 0;
      return { slug, name: m.name, total: m.total, count, selected: isSelected, disabled: count === 0 && !isSelected };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * Fill in `neighbourhood` for a page of essays, in one batch.
 *
 * ⚠ THE FEED IS THE REASON THIS IS NOT A LOOP. `/blog` renders seven full
 * essays into reader templates, and each closing strip wants the same three
 * questions answered. Asked per essay that is twenty-eight round trips on the
 * site's busiest route; asked set-wise it is four, whatever the page size.
 *
 * Mutates in place and returns the same array, because every caller wants the
 * items it already has rather than a second list to keep in step.
 */
export async function attachNeighbourhoods(supabase: DB, items: WritingItem[]): Promise<WritingItem[]> {
  if (items.length === 0) return items;
  const { data } = await supabase
    .from('fragment_subjects')
    .select('fragment_id, subject_id')
    .in(
      'fragment_id',
      items.map((i) => i.id),
    );
  const byFragment = new Map<string, string[]>();
  for (const row of data ?? []) {
    const list = byFragment.get(row.fragment_id) ?? [];
    list.push(row.subject_id);
    byFragment.set(row.fragment_id, list);
  }
  const seeds: QuoteSeed[] = items.map((i) => ({ id: i.id, subjectIds: byFragment.get(i.id) ?? [] }));
  const found = await getQuoteNeighbourhoods(supabase, seeds);
  for (const item of items) (item as WritingPost).neighbourhood = found.get(item.id) ?? null;
  return items;
}
