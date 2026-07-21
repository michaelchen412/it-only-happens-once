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

export interface SubjectCount extends SubjectRef {
  count: number;
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

/** Flatten the embedded `fragment_subjects(subjects(...))` shape, sorted by name. */
function subjectsOf(row: { fragment_subjects?: { subjects: SubjectRef | null }[] | null }): SubjectRef[] {
  return (row.fragment_subjects ?? [])
    .map((fs) => fs.subjects)
    .filter((s): s is SubjectRef => !!s)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a subject slug to the ids of the fragments tagged with it (any type;
 *  the caller's `.eq('type', …)` narrows it). `null` = unknown subject. */
async function fragmentIdsForSubject(supabase: DB, subjectSlug: string): Promise<string[] | null> {
  const { data: subject } = await supabase.from('subjects').select('id').eq('slug', subjectSlug).maybeSingle();
  if (!subject) return null; // unknown subject → caller renders an empty feed
  const { data } = await supabase.from('fragment_subjects').select('fragment_id').eq('subject_id', subject.id);
  return (data ?? []).map((r) => r.fragment_id);
}

/** One page of published writing, newest first, optionally filtered by subject and/or search. */
export async function listWriting(
  supabase: DB,
  opts: { page?: number; subject?: string | null; q?: string | null } = {}
): Promise<Page<WritingItem>> {
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q ? sanitizeQuery(opts.q) : '';

  let ids: string[] | null = null;
  if (opts.subject) {
    ids = await fragmentIdsForSubject(supabase, opts.subject);
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
      subjects: subjectsOf(r),
    };
  });

  const total = count ?? items.length;
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** One page of published quotes, newest first, optionally filtered by subject and/or search. */
export async function listQuotes(
  supabase: DB,
  opts: { page?: number; subject?: string | null; q?: string | null } = {}
): Promise<Page<QuoteItem>> {
  const page = Math.max(1, opts.page ?? 1);
  const searchTerm = opts.q ? sanitizeQuery(opts.q) : '';

  let ids: string[] | null = null;
  if (opts.subject) {
    ids = await fragmentIdsForSubject(supabase, opts.subject);
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
    subjects: subjectsOf(r),
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

/** The subject taxonomy that actually has published fragments of `type`, with counts, busiest first. */
export async function listSubjects(supabase: DB, type: FragmentType): Promise<SubjectCount[]> {
  const [{ data: links }, { data: subjects }] = await Promise.all([
    supabase
      .from('fragment_subjects')
      .select('subject_id, fragments!inner(type, status, deleted_at)')
      .eq('fragments.type', type)
      .eq('fragments.status', 'published')
      .is('fragments.deleted_at', null),
    supabase.from('subjects').select('id, name, slug'),
  ]);

  const counts = new Map<string, number>();
  for (const l of links ?? []) counts.set(l.subject_id, (counts.get(l.subject_id) ?? 0) + 1);

  return (subjects ?? [])
    .map((s) => ({ name: s.name, slug: s.slug, count: counts.get(s.id) ?? 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
