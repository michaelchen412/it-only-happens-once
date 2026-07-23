// Queries for the public blog — the Index (design.md §4). Kept out of the
// .astro pages so they stay lean, and shared by the feed, the permalink page,
// and (later) the constellation views. All reads go through the anon SSR client
// and rely on the public RLS policies (published, non-deleted fragments only).
import type { createSupabaseServerClient } from './supabase';
import { excerpt, readingMinutes } from './markdown';

type DB = ReturnType<typeof createSupabaseServerClient>;

/** Full essays per feed page (design.md: a generous sitting, not an endless scroll). */
export const PAGE_SIZE = 7;
/** Quotes are short, so more fit per page. */
export const QUOTES_PAGE_SIZE = 25;

export interface SubjectRef {
  name: string;
  slug: string;
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
}

export interface QuoteItem {
  id: string;
  slug: string;
  body: string;
  attribution: string | null;
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
  return q.replace(/[%,()\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Flatten the embedded `fragment_subjects(subjects(...))` shape. With a `rank`
 *  map (slug → global count) subjects come out busiest-first — so a capped card
 *  keeps the most-used tags — with name as the tiebreak; without it, by name. */
function subjectsOf(
  row: { fragment_subjects?: { subjects: SubjectRef | null }[] | null },
  rank?: Map<string, number>
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

  const { data: links } = await supabase.from('fragment_subjects').select('fragment_id, subject_id').in('subject_id', ids);
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
  opts: { page?: number; subjects?: string[] | null; q?: string | null; subjectRank?: Map<string, number> } = {}
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
      'id, slug, title, body, excerpt, occurred_at, updated_at, date_precision, fragment_subjects(subjects(name, slug))',
      { count: 'exact' }
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
    };
  });

  const total = count ?? items.length;
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** One page of published quotes, newest first, optionally narrowed by an AND of
 *  subjects and/or a search term. */
export async function listQuotes(
  supabase: DB,
  opts: { page?: number; subjects?: string[] | null; q?: string | null; subjectRank?: Map<string, number> } = {}
): Promise<Page<QuoteItem>> {
  const page = Math.max(1, opts.page ?? 1);
  const searchTerm = opts.q ? sanitizeQuery(opts.q) : '';

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
    .select('id, slug, body, attribution, source_url, occurred_at, date_precision, fragment_subjects(subjects(name, slug))', {
      count: 'exact',
    })
    .eq('type', 'quote')
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
    .range(from, from + QUOTES_PAGE_SIZE - 1);

  if (ids) query = query.in('id', ids);
  if (searchTerm) query = query.or(`body.ilike.%${searchTerm}%,attribution.ilike.%${searchTerm}%`);

  const { data, count } = await query;
  const items: QuoteItem[] = (data ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    body: r.body ?? '',
    attribution: r.attribution ?? null,
    sourceUrl: r.source_url ?? null,
    occurredAt: r.occurred_at,
    precision: r.date_precision,
    subjects: subjectsOf(r, opts.subjectRank),
  }));

  const total = count ?? items.length;
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / QUOTES_PAGE_SIZE)) };
}

/** A single published essay by slug, with its subjects. `null` if not found. */
export async function getWritingBySlug(supabase: DB, slug: string): Promise<WritingItem | null> {
  const { data: r } = await supabase
    .from('fragments')
    .select('id, slug, title, body, excerpt, occurred_at, updated_at, date_precision, fragment_subjects(subjects(name, slug))')
    .eq('type', 'writing')
    .eq('status', 'published')
    .is('deleted_at', null)
    .eq('slug', slug)
    .maybeSingle();
  if (!r) return null;

  const lede = (r.excerpt ?? '').trim() || excerpt(r.body, 400);
  return {
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
  };
}

type FragmentType = 'writing' | 'quote' | 'song';

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
  opts: { selected?: string[]; q?: string | null } = {}
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
