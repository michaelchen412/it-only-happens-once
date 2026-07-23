// The Fragment Manager's list query, extracted from /admin so the same table
// can be served two ways: the full page and the fragments-panel partial the
// composer's browser sheet fetches. One implementation, one truth.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { MIN_SEARCH } from './search-highlight';

type DB = SupabaseClient<Database>;
export type FragmentRowT = Database['public']['Tables']['fragments']['Row'];

const TYPES = ['writing', 'quote', 'song'] as const;
const SORT_COL: Record<string, string> = { title: 'title', posted: 'occurred_at', edited: 'updated_at' };

export interface FragmentListParams {
  view: 'list' | 'trash';
  type: (typeof TYPES)[number] | null;
  subjectSlugs: string[];
  q: string;
  searching: boolean;
  sortField: string;
  sortDir: string;
  authorSlug: string;
  workSlug: string;
  /** pick mode: mark rows already placed in this constellation */
  constellation: string | null;
  filtered: boolean;
}

export function parseListParams(sp: URLSearchParams): FragmentListParams {
  const view = sp.get('view') === 'trash' ? 'trash' : 'list';
  const typeParam = TYPES.find((t) => t === sp.get('type')) ?? null;
  const subjectSlugs = (sp.get('subject') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const q = (sp.get('q') ?? '').trim();
  // sort = "<field>_<dir>". Drafts are always pinned to the top (secondary sort).
  const sortMatch = (sp.get('sort') ?? 'edited_desc').match(/^(title|posted|edited)_(asc|desc)$/);
  const authorSlug = (sp.get('author') || '').trim();
  const workSlug = (sp.get('work') || '').trim();
  return {
    view,
    type: typeParam,
    subjectSlugs,
    q,
    searching: q.length >= MIN_SEARCH, // ignore 1-char terms (match nearly everything)
    sortField: sortMatch ? sortMatch[1] : 'edited',
    sortDir: sortMatch ? sortMatch[2] : 'desc',
    authorSlug,
    workSlug,
    constellation: (sp.get('constellation') || '').trim() || null,
    filtered: !!typeParam || subjectSlugs.length > 0 || q.length >= MIN_SEARCH || !!authorSlug || !!workSlug,
  };
}

export interface FragmentListData {
  rows: FragmentRowT[];
  subjectsByFragment: Record<string, string[]>;
  authorNameById: Record<string, string>;
  workTitleById: Record<string, string>;
  allAuthors: { id: string; name: string; slug: string }[];
  allWorks: { id: string; title: string; slug: string; author_id: string | null }[];
  allSubjects: { name: string; slug: string }[];
  typeCounts: Record<string, number>;
  totalCount: number;
  trashCount: number;
  /** fragment ids already placed in params.constellation (empty set otherwise) */
  placedIds: Set<string>;
}

export async function queryFragmentList(supabase: DB, p: FragmentListParams): Promise<FragmentListData> {
  // subject filter → fragment ids matching ALL selected subjects (AND semantics)
  let subjectFilterIds: string[] | null = null;
  if (p.subjectSlugs.length) {
    const { data: subs } = await supabase.from('subjects').select('id, slug').in('slug', p.subjectSlugs);
    const subIds = (subs ?? []).map((s) => s.id);
    if (!subIds.length) {
      subjectFilterIds = [];
    } else {
      const { data: links } = await supabase.from('fragment_subjects').select('fragment_id, subject_id').in('subject_id', subIds);
      const bySet: Record<string, Set<string>> = {};
      for (const l of links ?? []) (bySet[l.fragment_id] ??= new Set()).add(l.subject_id);
      subjectFilterIds = Object.entries(bySet)
        .filter(([, s]) => s.size === subIds.length)
        .map(([fid]) => fid);
    }
  }

  // provenance facets: authors & works (for the datalists, filters, and editor prefill)
  const { data: allAuthors } = await supabase.from('authors').select('id, name, slug').order('name');
  const { data: allWorks } = await supabase.from('works').select('id, title, slug, author_id').order('title');
  const authorNameById = Object.fromEntries((allAuthors ?? []).map((a) => [a.id, a.name]));
  const workTitleById = Object.fromEntries((allWorks ?? []).map((w) => [w.id, w.title]));
  const authorFilterId = p.authorSlug ? (allAuthors ?? []).find((a) => a.slug === p.authorSlug)?.id ?? '—' : null;
  const workFilterId = p.workSlug ? (allWorks ?? []).find((w) => w.slug === p.workSlug)?.id ?? '—' : null;

  // deleted-state scope shared by the list query and the per-type counts
  const scoped = <T extends { not: any; is: any }>(qb: T) =>
    (p.view === 'trash' ? qb.not('deleted_at', 'is', null) : qb.is('deleted_at', null)) as T;

  // main query — drafts first (status asc: draft < published), then the chosen sort
  let query = scoped(supabase.from('fragments').select('*'));
  if (p.type) query = query.eq('type', p.type);
  if (authorFilterId) query = query.eq('author_id', authorFilterId);
  if (workFilterId) query = query.eq('work_id', workFilterId);
  if (subjectFilterIds) query = query.in('id', subjectFilterIds.length ? subjectFilterIds : ['00000000-0000-0000-0000-000000000000']);
  if (p.searching) {
    const safe = p.q.replace(/[(),]/g, ' ');
    query = query.or(`title.ilike.%${safe}%,body.ilike.%${safe}%,attribution.ilike.%${safe}%,excerpt.ilike.%${safe}%`);
  }
  query = query
    .order('status', { ascending: true }) // drafts pinned to top
    .order(SORT_COL[p.sortField], { ascending: p.sortDir === 'asc', nullsFirst: false });

  const { data: fragments } = await query;
  const rows = fragments ?? [];

  // per-type counts (the badge numbers) for the current view, independent of filters
  const { data: typeRows } = await scoped(supabase.from('fragments').select('type'));
  const typeCounts = { writing: 0, quote: 0, song: 0 } as Record<string, number>;
  for (const r of typeRows ?? []) typeCounts[r.type]++;

  // subjects per fragment (editor prefill) + all subjects + trash count
  const ids = rows.map((r) => r.id);
  const subjectsByFragment: Record<string, string[]> = {};
  if (ids.length) {
    const { data: fs } = await supabase.from('fragment_subjects').select('fragment_id, subjects(name)').in('fragment_id', ids);
    for (const link of fs ?? []) {
      const name = (link.subjects as { name: string } | null)?.name;
      if (name) (subjectsByFragment[link.fragment_id] ??= []).push(name);
    }
  }
  const { data: allSubjects } = await supabase.from('subjects').select('name, slug').order('name');
  const { count: trashCount } = await supabase.from('fragments').select('id', { count: 'exact', head: true }).not('deleted_at', 'is', null);

  // pick mode: which of these fragments already live in the target constellation
  const placedIds = new Set<string>();
  if (p.constellation) {
    const { data: links } = await supabase
      .from('fragment_constellations')
      .select('fragment_id')
      .eq('constellation_id', p.constellation);
    for (const l of links ?? []) placedIds.add(l.fragment_id);
  }

  return {
    rows,
    subjectsByFragment,
    authorNameById,
    workTitleById,
    allAuthors: allAuthors ?? [],
    allWorks: allWorks ?? [],
    allSubjects: allSubjects ?? [],
    typeCounts,
    totalCount: (typeRows ?? []).length,
    trashCount: trashCount ?? 0,
    placedIds,
  };
}
