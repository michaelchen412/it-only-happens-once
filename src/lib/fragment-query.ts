// The Fragment Manager's list query, extracted from /admin/fragments so the same table
// can be served two ways: the full page and the fragments-panel partial the
// composer's browser sheet fetches. One implementation, one truth.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
// One vocabulary, one owner (plans/29 · §3) — this file used to carry its own
// `TYPES` array, and `FragmentListPanel.astro`, which renders what it returns,
// carried a second one.
import { FRAGMENT_TYPES, type FragmentType } from './fragments-display';
import { MIN_SEARCH } from './search-highlight';
import { toPlainText } from './markdown';

type DB = SupabaseClient<Database>;
export type FragmentRowT = Database['public']['Tables']['fragments']['Row'];

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
  type: FragmentType | null;
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
  /**
   * Only fragments that may be PLACED in a suite — the composer's browser
   * ([ADR 0031](../../docs/adr/0031-a-song-carries-a-feeling-not-an-idea.md)).
   *
   * ⚠ NOT A URL PARAM, and deliberately not one. This is a property of the
   * ROOM rather than a filter the reader chose — a song is not something you
   * have filtered out of the picker, it is something that cannot go in a suite
   * at all. `fragments-panel.astro` sets it in pick mode, the way it already
   * pins `view` to 'list' there.
   */
  placeable: boolean;
  /**
   * Only fragments that may be PAIRED to a song — the song sheet's own picker
   * (plan 39 · §2). Narrower than `placeable`, which still admits a quote:
   * `songs.pair` writes `paired_song_id` on a row it filters to
   * `type = 'writing'`, so a quote here would be an offer the action declines.
   *
   * ⚠ NOT A URL PARAM, for the same reason `placeable` isn't, and the reason is
   * worth keeping in both places: a quote is not something you have filtered out
   * of this picker, it is something that cannot be paired at all.
   */
  pairable: boolean;
  /**
   * pair mode: mark rows already paired to THIS song. The sibling of
   * `constellation` above, and it needs no query of its own — `paired_song_id`
   * is a column on the row, so the marking is a read of what we already have.
   */
  pairedSong: string | null;
  filtered: boolean;
}

export function parseListParams(sp: URLSearchParams): FragmentListParams {
  const viewParam = sp.get('view');
  const view = viewParam === 'trash' ? 'trash' : 'list';
  const typeParam = FRAGMENT_TYPES.find((t) => t === sp.get('type')) ?? null;
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
    placeable: false, // the picker turns it on; see the field's comment
    pairable: false, // ditto — fragments-panel.astro sets both, never the URL
    pairedSong: (sp.get('song') || '').trim() || null,

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
  /**
   * Shown wherever a constellation is offered as a target (4-line cap).
   *
   * ⚠ PLAIN WORDS — the column has held Markdown since 2026-08-11, and it is
   * flattened once here rather than at each of the menus and pickers this
   * feeds. Every one of them is a clamped line or four inside a list; not one
   * of them can render a mark, and the day a new one appears the words are
   * what it will get.
   */
  description?: string | null;
}

/**
 * Which room is rendering the panel — `manage` is /admin/fragments, `pick` is
 * the composer's browser, `pair` is the song sheet's picker (plan 39).
 *
 * ⚠ ONE DECLARATION, IMPORTED TWICE, rather than the same union hand-written in
 * `FragmentListPanel` and `FragmentRow` — which is what it was, and adding a
 * third value to two copies is exactly the drift plans/29 · §3 named.
 */
export type PanelMode = 'manage' | 'pick' | 'pair';

export interface FragmentListData {
  rows: FragmentRowT[];
  /**
   * The list hit its ceiling and there are rows you are not being shown.
   *
   * Always false today (the corpus is in the hundreds). It exists so that the
   * day it stops being false, the room says so instead of quietly serving a
   * thousand of an unknown number.
   */
  truncated: boolean;
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
  /** fragment ids already paired to params.pairedSong (empty set otherwise) */
  pairedIds: Set<string>;
  /**
   * Titles of the songs OTHER listed rows are paired to, for the sentence a
   * collision has to say out loud (plan 39 · ruling 2). Only populated in pair
   * mode — nothing else has a use for it, and it costs a query.
   */
  songTitleById: Record<string, string>;
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
  const { data: allConstellationRows } = await supabase
    .from('constellations')
    .select('id, name, slug, description, color')
    .order('sort');
  // Markdown → words, once, for every consumer of `ConstellationRefLite`.
  const allConstellations = (allConstellationRows ?? []).map((c) => ({
    ...c,
    description: toPlainText(c.description) || null,
  }));
  let membershipFilterIds: string[] | null = null; // whitelist: fragments in the chosen constellation
  let membershipExcludeIds: string[] | null = null; // blacklist: everything placed anywhere ('none')
  if (p.membership === 'none') {
    const { data: links } = await supabase.from('fragment_constellations').select('fragment_id');
    membershipExcludeIds = [...new Set((links ?? []).map((l) => l.fragment_id))];
  } else if (p.membership) {
    const target = allConstellations.find((c) => c.slug === p.membership);
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
  //
  // ⚠ THE CEILING HERE IS CHOSEN, NOT DEFAULTED (docs/plans/16 · Piece 2).
  // These look unbounded and are not: PostgREST stops at 1000 rows unless you
  // say otherwise, so the read that "gets every author" would have started
  // lying at 1001 with nothing on screen to say so — the same silent-truncation
  // fault the combo's 50-row cap had, one layer down. Stating it makes the
  // number somebody's decision. Harmless at 70 authors / 49 works; the thing
  // that actually retires the question is the plan's step 2, where the combo
  // asks the server per keystroke instead of being handed the whole vocabulary.
  const VOCAB_CEILING = 1000;
  const { data: allAuthors } = await supabase
    .from('authors')
    .select('id, name, slug')
    .order('name')
    .limit(VOCAB_CEILING);
  const { data: allWorks } = await supabase
    .from('works')
    .select('id, title, slug, author_id')
    .order('title')
    .limit(VOCAB_CEILING);
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
  //
  // ⚠ AND SONGS ARE OUT OF THE PICKER FOR THE SAME REASON, not a different one
  // (ADR 0031). A song is never a suite stanza: music accompanies a
  // constellation through `score_url` or through an essay's `paired_song_id`,
  // both of which are RELATIONS rather than membership. Excluding it HERE
  // rather than in the list query is what keeps the badge above each column
  // honest — filter the rows in one place and the counts in another, and the
  // picker ends up offering a segment that leads to nothing.
  //
  // ⚠ AND PAIRING NARROWS IT FURTHER, in the same place and for the same reason
  // (plan 39 · §2). `songs.pair` writes `paired_song_id` on a row it filters to
  // `type = 'writing'`, so a quote in that picker is an offer the action
  // declines — one step worse than the song case above, because a quote looks
  // like a perfectly reasonable thing to pair music to until you press it.
  const scoped = <T extends { not: any; is: any; eq: any; neq: any }>(qb: T) => {
    const live = p.view === 'trash' ? qb.not('deleted_at', 'is', null) : qb.is('deleted_at', null);
    const working = live.neq('status', 'note') as T;
    if (p.pairable) return working.eq('type', 'writing') as T;
    return (p.placeable ? working.neq('type', 'song') : working) as T;
  };

  // main query — drafts first (status asc: draft < published), then the chosen sort
  //
  // ⚠ THE CEILING IS STATED HERE FOR THE SAME REASON IT IS STATED FOR THE
  // VOCABULARY ABOVE, one screen up — and this is the read that warning was
  // actually about. PostgREST stops at 1000 rows whether or not you ask, so the
  // manager has always had a limit; what it did not have was anybody's decision
  // or any way to notice. At 1001 fragments the table would simply have stopped
  // at a thousand, with correct-looking badge counts beside it (those come from
  // `typeRows`, which is a separate query) and nothing on screen saying a word.
  // Naming the number makes the truncation observable — `truncated` below is
  // what the page renders — and turns "it silently lied" into "it says so".
  const LIST_CEILING = 1000;
  let query = scoped(supabase.from('fragments').select('*')).limit(LIST_CEILING);
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
    const byId = new Map(allConstellations.map((c) => [c.id, c]));
    const order = new Map(allConstellations.map((c, i) => [c.id, i]));
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

  // pair mode: which of these are already paired to the target song, and what
  // the REST are paired to.
  //
  // ⚠ NO QUERY FOR THE FIRST HALF, unlike `placedIds` one line up, and the
  // asymmetry is the data model rather than an optimisation: membership is a
  // link table you have to go and read, whereas `paired_song_id` is a column on
  // the row we already selected with `*`.
  const pairedIds = new Set<string>();
  const songTitleById: Record<string, string> = {};
  if (p.pairedSong) for (const r of rows) if (r.paired_song_id === p.pairedSong) pairedIds.add(r.id);
  if (p.pairable) {
    // The second half DOES cost a query, and only this mode pays it. These are
    // the essays a pick would STEAL from, and ruling 2 says the steal has to
    // name what it is taking.
    const others = [
      ...new Set(rows.map((r) => r.paired_song_id).filter((id): id is string => !!id && id !== p.pairedSong)),
    ];
    if (others.length) {
      /*
        ⚠ `songs`, NOT `fragments`, AND IT READ `fragments` UNTIL 2026-08-15.
        These ids come from `paired_song_id`, which ADR 0035 repointed at a table
        of its own — so this went on looking for songs among the writing and the
        quotes, found none, and left `songTitleById` empty.

        ⚠ AND IT FAILED SILENTLY, which is what makes it worse than the crash in
        `fragments.get` next door. No error, no empty state: the picker just
        stopped naming what a pick would take, so `pairedToOther` fell back to
        `''` and every row rendered a plain ＋ instead of "Replace «song»". Plan
        39 ruling 2 exists precisely to stop that — *"the steal is legible before
        the press"* — and a green build said nothing.
      */
      const { data: songs } = await supabase.from('songs').select('id, title').in('id', others);
      for (const s of songs ?? []) songTitleById[s.id] = s.title || '(untitled)';
    }
  }

  return {
    rows,
    truncated: rows.length >= LIST_CEILING,
    subjectsByFragment,
    constellationsByFragment,
    allConstellations,
    authorNameById,
    workTitleById,
    allAuthors: allAuthors ?? [],
    allWorks: allWorks ?? [],
    allSubjects: allSubjects ?? [],
    typeCounts,
    totalCount: (typeRows ?? []).length,
    trashCount: trashCount ?? 0,
    placedIds,
    pairedIds,
    songTitleById,
  };
}
