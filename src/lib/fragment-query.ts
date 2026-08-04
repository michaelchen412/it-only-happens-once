// The Fragment Manager's list query, extracted from /admin/fragments so the same table
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
  /**
   * Which slice of the corpus.
   *
   * ⚠ THERE IS NO `notes` VIEW ANY MORE (removed 2026-08-03 by 14 · Piece 1).
   * The manager holds drafts and published; brain dumps have their own room at
   * `/admin/notes`, where a dump renders as its own text rather than as a row
   * with an empty title column. The manager is for pieces, and a jotting was
   * never a piece — see the header of src/pages/admin/notes.astro.
   *
   * What did NOT change is the exclusion: the working list still filters notes
   * out by construction rather than by a default anyone can clear, and `trash`
   * now does the same, so scratch cannot reappear beside finished work at
   * either end.
   */
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
  /**
   * Membership filter (`?in=`): a constellation SLUG, or the literal 'none' for
   * "belongs to no constellation" — the curatorial question the manager could
   * not answer before. Distinct from `constellation`, which only marks rows.
   */
  membership: string | null;
  filtered: boolean;
}

export function parseListParams(sp: URLSearchParams): FragmentListParams {
  const viewParam = sp.get('view');
  const view = viewParam === 'trash' ? 'trash' : 'list';
  const typeParam = TYPES.find((t) => t === sp.get('type')) ?? null;
  const subjectSlugs = (sp.get('subject') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const q = (sp.get('q') ?? '').trim();
  // sort = "<field>_<dir>". Drafts are always pinned to the top (secondary sort).
  const sortMatch = (sp.get('sort') ?? 'edited_desc').match(/^(title|posted|edited)_(asc|desc)$/);
  const authorSlug = (sp.get('author') || '').trim();
  const workSlug = (sp.get('work') || '').trim();
  const membership = (sp.get('in') || '').trim() || null;
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
    membership,
    filtered:
      !!typeParam || subjectSlugs.length > 0 || q.length >= MIN_SEARCH || !!authorSlug || !!workSlug || !!membership,
  };
}

export interface ConstellationRefLite {
  id: string;
  name: string;
  slug: string;
  /** The colour SLOT name (app.css owns what it means). */
  color?: string | null;
  /** Shown wherever a constellation is offered as a target (4-line cap). */
  description?: string | null;
}

export interface FragmentListData {
  rows: FragmentRowT[];
  subjectsByFragment: Record<string, string[]>;
  /** The other end of the composer: where each fragment already lives. */
  constellationsByFragment: Record<string, ConstellationRefLite[]>;
  /** Every constellation (draft included) — the filter + the pickers. */
  allConstellations: ConstellationRefLite[];
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
      const { data: links } = await supabase
        .from('fragment_subjects')
        .select('fragment_id, subject_id')
        .in('subject_id', subIds);
      const bySet: Record<string, Set<string>> = {};
      for (const l of links ?? []) (bySet[l.fragment_id] ??= new Set()).add(l.subject_id);
      subjectFilterIds = Object.entries(bySet)
        .filter(([, s]) => s.size === subIds.length)
        .map(([fid]) => fid);
    }
  }

  // membership filter (`?in=`): a constellation slug, or 'none' for the orphans.
  // Resolved to an id list here, exactly like the subject filter above.
  const { data: allConstellations } = await supabase
    .from('constellations')
    .select('id, name, slug, description, color')
    .order('sort');
  let membershipFilterIds: string[] | null = null; // whitelist: fragments in the chosen constellation
  let membershipExcludeIds: string[] | null = null; // blacklist: everything placed anywhere ('none')
  if (p.membership === 'none') {
    const { data: links } = await supabase.from('fragment_constellations').select('fragment_id');
    membershipExcludeIds = [...new Set((links ?? []).map((l) => l.fragment_id))];
  } else if (p.membership) {
    const target = (allConstellations ?? []).find((c) => c.slug === p.membership);
    if (!target) {
      membershipFilterIds = []; // unknown slug → match nothing, don't silently ignore
    } else {
      const { data: links } = await supabase
        .from('fragment_constellations')
        .select('fragment_id')
        .eq('constellation_id', target.id);
      membershipFilterIds = (links ?? []).map((l) => l.fragment_id);
    }
  }

  // provenance facets: authors & works (for the datalists, filters, and editor prefill)
  const { data: allAuthors } = await supabase.from('authors').select('id, name, slug').order('name');
  const { data: allWorks } = await supabase.from('works').select('id, title, slug, author_id').order('title');
  const authorNameById = Object.fromEntries((allAuthors ?? []).map((a) => [a.id, a.name]));
  const workTitleById = Object.fromEntries((allWorks ?? []).map((w) => [w.id, w.title]));
  const authorFilterId = p.authorSlug ? ((allAuthors ?? []).find((a) => a.slug === p.authorSlug)?.id ?? '—') : null;
  const workFilterId = p.workSlug ? ((allWorks ?? []).find((w) => w.slug === p.workSlug)?.id ?? '—') : null;

  // The view's scope, shared by the list query AND the per-type counts — so the
  // badge numbers can never disagree with the rows underneath them.
  //
  // ⚠ NOTES ARE OUT OF BOTH VIEWS, including trash. Trash used to be "any
  // status", so a discarded jotting went and sat among deleted essays — the
  // same middle ground the notes room was, arriving from the other end. A
  // deleted dump is reversible from the pile's own undo strip and after that it
  // is simply gone from the interface; the row survives in the database and in
  // the nightly backup, which is the right amount of ceremony for scratch.
  const scoped = <T extends { not: any; is: any; eq: any; neq: any }>(qb: T) => {
    const live = p.view === 'trash' ? qb.not('deleted_at', 'is', null) : qb.is('deleted_at', null);
    return live.neq('status', 'note') as T;
  };

  // main query — drafts first (status asc: draft < published), then the chosen sort
  let query = scoped(supabase.from('fragments').select('*'));
  if (p.type) query = query.eq('type', p.type);
  if (authorFilterId) query = query.eq('author_id', authorFilterId);
  if (workFilterId) query = query.eq('work_id', workFilterId);
  if (subjectFilterIds)
    query = query.in('id', subjectFilterIds.length ? subjectFilterIds : ['00000000-0000-0000-0000-000000000000']);
  if (membershipFilterIds)
    query = query.in('id', membershipFilterIds.length ? membershipFilterIds : ['00000000-0000-0000-0000-000000000000']);
  // 'none': everything NOT placed anywhere. An empty exclusion list is a no-op
  // (nothing is placed yet), so guard it — `not.in.()` is invalid syntax.
  if (membershipExcludeIds?.length) query = query.not('id', 'in', `(${membershipExcludeIds.join(',')})`);
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
    const { data: fs } = await supabase
      .from('fragment_subjects')
      .select('fragment_id, subjects(name)')
      .in('fragment_id', ids);
    for (const link of fs ?? []) {
      const name = (link.subjects as { name: string } | null)?.name;
      if (name) (subjectsByFragment[link.fragment_id] ??= []).push(name);
    }
  }
  // where each listed fragment lives (the membership column). Ordered by the
  // sky's authored order so a row's chips always read in the same sequence.
  const constellationsByFragment: Record<string, ConstellationRefLite[]> = {};
  if (ids.length) {
    const byId = new Map((allConstellations ?? []).map((c) => [c.id, c]));
    const order = new Map((allConstellations ?? []).map((c, i) => [c.id, i]));
    const { data: links } = await supabase
      .from('fragment_constellations')
      .select('fragment_id, constellation_id')
      .in('fragment_id', ids);
    for (const l of links ?? []) {
      const ref = byId.get(l.constellation_id);
      if (ref) (constellationsByFragment[l.fragment_id] ??= []).push(ref);
    }
    for (const refs of Object.values(constellationsByFragment)) {
      refs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
  }

  const { data: allSubjects } = await supabase.from('subjects').select('name, slug').order('name');
  // Notes excluded here too, so the pill agrees with the room it opens.
  const { count: trashCount } = await supabase
    .from('fragments')
    .select('id', { count: 'exact', head: true })
    .not('deleted_at', 'is', null)
    .neq('status', 'note');

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
    constellationsByFragment,
    allConstellations: allConstellations ?? [],
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
