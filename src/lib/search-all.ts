/**
 * The universal search fan-out — one term, twelve tables, one uniform row.
 *
 * The Observatory's ⌕ (docs/admin.md, docs/search.md §8) runs on this. It is the
 * FOURTH consumer of `search-highlight.ts`'s contract and the first that is not
 * about one table.
 *
 * ⚠ IT IS NOT A FOURTH COPY OF THE ENGINE; it is the FETCH half only. Matching,
 * excerpting and marking stay in `search-highlight.ts` and `SearchResults.astro`
 * calls them directly — §6's first checkbox is that the engine is never forked,
 * and wrapping it here would be a fork with extra steps.
 *
 * ── WHY TWELVE EXPLICIT QUERIES AND NOT A LOOP ──────────────────────────────
 *
 * Every kind searches a different column list, and §6's closing ⚠ says the
 * column list is a privacy question each consumer answers for itself. A loop
 * would need those columns as data anyway, and would then have to defeat the
 * generated types to use them. Written out, each one is four lines, typechecks,
 * and can be read against the RLS policy it depends on.
 *
 * ⚠ THE ANSWER TO §6's QUESTION IS *ALL OF THEM* HERE, AND IT IS THE FIRST TIME
 * THAT ANSWER HAS BEEN RIGHT. The public blog deliberately searches fewer
 * columns than the Fragment Manager. Every caller of this module is behind
 * `is_admin()`, so the column list stops being a privacy decision and becomes a
 * usefulness one — and the boundary is enforced by RLS rather than by anything
 * written here. There is no role check in this file, deliberately: it would be a
 * second opinion about a question the database already answers per row.
 *
 * ── THE SCOPE RULING (docs/search.md §7b left this open; this is the answer) ──
 *
 * ⚠ DRAFTS ARE IN. THE BIN IS OUT. §7b asked *"whether a term should reach the
 * trash"* and never settled it, because the Fragment Manager could go either
 * way. A universal bar cannot: the Observatory is **where drafts live**, so a
 * search that could not find a half-written essay would miss the single most
 * likely thing anybody is looking for. The bin is the opposite — a deleted row
 * is a row you have already said no to, and surfacing it beside live work makes
 * every result need a second look.
 *
 * So the rule, and it is one sentence: **everything you are working on, nothing
 * you have thrown away.** Drafts, notes, unpublished constellations and sets all
 * match; `deleted_at` and `archived_at` do not.
 *
 * ── THE SCALE, MEASURED ─────────────────────────────────────────────────────
 *
 * The whole corpus is ~440 rows and ~440KB of text (2026-09-08). §5 defers
 * Postgres FTS until "500+ posts makes `ilike` scans slow"; twelve parallel
 * `ilike`s over that is nothing, and twelve round trips in one `Promise.all`
 * measured 100–260ms end to end. If it ever stops being nothing, the escape
 * hatch is ONE `search_everything()` function marked SECURITY INVOKER — RLS
 * unchanged, twelve requests become one — and not a `tsvector`, because the
 * moment the server matches by meaning nothing can mark where the hit was.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { noted } from './read-log';
import { MIN_SEARCH, toPlain } from './search-highlight';

type DB = SupabaseClient<Database>;

export type KindKey =
  | 'essay'
  | 'note'
  | 'quote'
  | 'task'
  | 'goal'
  | 'person'
  | 'constellation'
  | 'set'
  | 'song'
  | 'subject'
  | 'work'
  | 'author';

export interface Hit {
  kind: KindKey;
  id: string;
  /** The naming line. A note and a quote have none — see `nameless`. */
  name: string;
  /** What gets excerpted. '' when the thing is only a name. */
  body: string;
  /** A small trailing fact: status, attribution, who. */
  meta: string;
  /**
   * Where the row sends you. ⚠ NEVER NULL, AND THAT COST A DECISION.
   *
   * Only four kinds have a permalink (essay, goal, person, constellation); the
   * other eight live in sheets their own room opens. Rather than render a dead
   * row — or invent eight `?open=<id>` conventions in one sitting — each of
   * those lands in the OWNING ROOM, and where that room has its own search it
   * arrives with the term already in it. A note result opens the pile filtered
   * to your word, with the jotting on screen; a subject opens the corpus
   * filtered to that subject, which is the thing you wanted anyway.
   *
   * ⚠ THE REFINEMENT IS `?open=<id>`, and it is deliberately not here. Three
   * rooms (tasks, sets, songs) land you without a filter, which is the weakest
   * of the three answers — see docs/search.md §8.
   */
  href: string;
  /** For a recency sort. Null on the six tables with no `updated_at`. */
  when: string | null;
}

export interface KindInfo {
  /** The group heading, and the tag in a flat rendering. */
  label: string;
}

export const KINDS: Record<KindKey, KindInfo> = {
  essay: { label: 'Essays' },
  note: { label: 'Notes' },
  quote: { label: 'Quotes' },
  task: { label: 'Tasks' },
  goal: { label: 'Goals' },
  person: { label: 'People' },
  constellation: { label: 'Constellations' },
  set: { label: 'Sets' },
  song: { label: 'Songs' },
  subject: { label: 'Subjects' },
  work: { label: 'Works' },
  author: { label: 'Authors' },
};

/**
 * Where "+N more in essays" goes.
 *
 * ⚠ A CAPPED GROUP MUST NOT BE A DEAD END. The cap (3 per kind) is what makes
 * the sheet legible — see `SearchResults.astro` — but a line reading *"+20 more
 * in essays"* with nowhere to press is the same defect as a result with no
 * address, one level up: it names something you then cannot reach. Every tail
 * lands in the room that owns the kind, carrying the term wherever that room
 * has a field to receive it.
 */
export function moreHref(kind: KindKey, q: string): string {
  const term = encodeURIComponent(q);
  switch (kind) {
    case 'essay':
      return `/admin/fragments?type=writing&q=${term}`;
    case 'quote':
      return `/admin/fragments?type=quote&q=${term}`;
    case 'note':
      return `/admin/notes?q=${term}`;
    case 'task':
      return '/admin/agenda/tasks';
    case 'goal':
      return '/admin/agenda/goals';
    case 'person':
      return '/admin/people';
    case 'constellation':
      return '/admin/constellations';
    case 'set':
    case 'song':
      return '/admin/sets';
    default:
      // The library vocabulary — subjects, works, authors.
      return '/admin/library';
  }
}

/** Kind order for a grouped rendering: the corpus first, then HQ, then vocabulary. */
export const ORDER = Object.keys(KINDS) as KindKey[];

/**
 * A quote and a jotting have no title BY CONSTRUCTION — *"I see untitled,
 * untitled, untitled"* is the sentence the notes room exists because of. They
 * are named by their own first words instead.
 *
 * ⚠ A RENDERING, NOT A COLUMN, which is why it happens here and never in the
 * query: `ilike` runs against the raw body, so filtering on this would quietly
 * disagree with the database about what matched.
 */
function nameless(body: string, max = 72): string {
  const flat = toPlain(body).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat || '(empty)';
}

/**
 * ⚠ COMMA AND PAREN ARE PostgREST's `or` SYNTAX, NOT TEXT. `fragment-query.ts`
 * and `notes.astro` both do exactly this; a term containing one would otherwise
 * be read as a filter separator — and the failure is not always an error, which
 * is the dangerous half.
 */
const escape = (q: string) => q.replace(/[(),]/g, ' ');

/** Per-kind ceiling. A backstop, not paging — the whole corpus is ~440 rows. */
const CEILING = 200;

export interface SearchOptions {
  /**
   * `false` — each room's own default: published, unarchived, out of the bin.
   * `true` — drafts, archived tasks and the trash too.
   *
   * ⚠ THIS IS §7b's OPEN QUESTION AND IT IS DELIBERATELY A PARAMETER RATHER
   * THAN A DECISION. *"Whether a term should reach the trash is an open
   * question, not a settled one."* A universal bar forces the ruling because it
   * escapes every room's default at once, not one room's.
   */
  wide?: boolean;
}

/**
 * The bench vocabulary, parsed once.
 *
 * ⚠ THREE SURFACES READ THESE PARAMS and each had its own copy of the ternaries
 * until 2026-09-15: the chrome bench's component, the partial it fetches, and
 * the lab page. Three copies of "what does `r=line` mean" is three chances for
 * the fetched list to disagree with the panel that asked for it — and the
 * disagreement would render as a working page, which is the kind of bug this
 * codebase writes tests about rather than notices.
 *
 * Modelled on `fragment-query.ts`'s `parseListParams`, which owns the Fragment
 * Manager's vocabulary for exactly the same reason. Plan 29: one owner per fact,
 * and a query-string vocabulary is a fact.
 *
 * ⚠ WHAT IS NOT HERE IS AS DELIBERATE AS WHAT IS. `frame` and `gate` belong to
 * the lab page, `sb` and `trigger` to the chrome bench; a param only one surface
 * can act on is not shared vocabulary, and hoisting it would invite the other
 * surface to start reading it.
 */
export interface SearchViewParams {
  /** The trimmed term. */
  q: string;
  /** `q` is at or above `MIN_SEARCH` — the gate, read from the one constant. */
  searching: boolean;
  /** Q1 — by kind, or one list by recency. */
  grouping: 'grouped' | 'flat';
  /** Q2 — how much of a body a row shows. */
  row: 'line' | 'one' | 'all';
  /** Q3 — reach drafts, archives and the bin. */
  wide: boolean;
  /** Q4 — rows per kind; 0 is uncapped. */
  cap: number;
  /** Pad the thin agenda. Grouping question only — see `search-bench-seed.ts`. */
  seeded: boolean;
}

export function parseSearchParams(sp: URLSearchParams): SearchViewParams {
  const q = (sp.get('q') ?? '').trim();
  const rowParam = sp.get('r');
  return {
    q,
    searching: q.length >= MIN_SEARCH,
    grouping: sp.get('g') === 'flat' ? 'flat' : 'grouped',
    row: rowParam === 'line' || rowParam === 'all' ? rowParam : 'one',
    wide: sp.get('s') === 'all',
    cap: sp.get('cap') === '3' ? 3 : 0,
    seeded: sp.get('seed') === 'on',
  };
}

export async function searchEverything(
  supabase: DB,
  q: string,
  { wide = false }: SearchOptions = {},
): Promise<{ hits: Hit[]; ms: number }> {
  const safe = escape(q);
  // The term, for the two destinations that carry it into a room's own field.
  const term = encodeURIComponent(q);
  const like = (cols: string[]) => cols.map((c) => `${c}.ilike.%${safe}%`).join(',');

  async function essays(): Promise<Hit[]> {
    let qy = supabase
      .from('fragments')
      .select('id, title, body, status, updated_at')
      .eq('type', 'writing')
      .neq('status', 'note')
      .or(like(['title', 'body']));
    if (!wide) qy = qy.eq('status', 'published').is('deleted_at', null);
    const { data } = await qy.limit(CEILING).then(noted('search-all: essays'));
    return (data ?? []).map((r) => ({
      kind: 'essay' as const,
      id: r.id,
      name: r.title || '(untitled)',
      body: r.body ?? '',
      meta: r.status === 'published' ? '' : r.status,
      href: `/admin/writing/${r.id}`,
      when: r.updated_at,
    }));
  }

  async function notes(): Promise<Hit[]> {
    // ⚠ `body` ONLY — the whole column list a jotting has, and notes.astro says
    // why. The Fragment Manager cannot see these at all (`neq('status','note')`
    // in `scoped`), which is most of the reason a universal bar was asked for:
    // *"did I already write this down?"* has no answer anywhere in the building.
    let qy = supabase
      .from('fragments')
      .select('id, body, updated_at')
      .eq('status', 'note')
      .or(like(['body']));
    if (!wide) qy = qy.is('deleted_at', null);
    const { data } = await qy.limit(CEILING).then(noted('search-all: notes'));
    return (data ?? []).map((r) => ({
      kind: 'note' as const,
      id: r.id,
      name: nameless(r.body ?? ''),
      body: r.body ?? '',
      meta: '',
      href: `/admin/notes?q=${term}`,
      when: r.updated_at,
    }));
  }

  async function quotes(): Promise<Hit[]> {
    let qy = supabase
      .from('fragments')
      .select('id, body, attribution, status, updated_at')
      .eq('type', 'quote')
      .or(like(['body', 'attribution']));
    if (!wide) qy = qy.eq('status', 'published').is('deleted_at', null);
    const { data } = await qy.limit(CEILING).then(noted('search-all: quotes'));
    return (data ?? []).map((r) => ({
      kind: 'quote' as const,
      id: r.id,
      name: nameless(r.body ?? ''),
      body: r.body ?? '',
      meta: r.attribution ?? '',
      href: `/admin/fragments?type=quote&q=${term}`,
      when: r.updated_at,
    }));
  }

  async function tasks(): Promise<Hit[]> {
    let qy = supabase
      .from('tasks')
      .select('id, title, notes, due_on, updated_at')
      .or(like(['title', 'notes']));
    if (!wide) qy = qy.is('archived_at', null);
    const { data } = await qy.limit(CEILING).then(noted('search-all: tasks'));
    return (data ?? []).map((r) => ({
      kind: 'task' as const,
      id: r.id,
      name: r.title,
      body: r.notes ?? '',
      meta: r.due_on ? `due ${r.due_on}` : '',
      href: '/admin/agenda/tasks',
      when: r.updated_at,
    }));
  }

  async function goals(): Promise<Hit[]> {
    let qy = supabase
      .from('goals')
      .select('id, name, slug, why, notes, status, updated_at')
      .or(like(['name', 'why', 'notes']));
    if (!wide) qy = qy.eq('status', 'active');
    const { data } = await qy.limit(CEILING).then(noted('search-all: goals'));
    return (data ?? []).map((r) => ({
      kind: 'goal' as const,
      id: r.id,
      name: r.name,
      body: [r.why, r.notes].filter(Boolean).join('\n\n'),
      meta: r.status === 'active' ? '' : r.status,
      href: `/admin/agenda/goals/${r.slug}`,
      when: r.updated_at,
    }));
  }

  async function people(): Promise<Hit[]> {
    let qy = supabase
      .from('people')
      .select('id, slug, display_name, full_name, epithet, bio, updated_at')
      .or(like(['display_name', 'full_name', 'epithet', 'bio']));
    if (!wide) qy = qy.is('archived_at', null);
    const { data } = await qy.limit(CEILING).then(noted('search-all: people'));
    return (data ?? []).map((r) => ({
      kind: 'person' as const,
      id: r.id,
      name: r.display_name,
      body: r.bio ?? '',
      meta: r.epithet ?? '',
      href: `/admin/people/${r.slug}`,
      when: r.updated_at,
    }));
  }

  async function constellations(): Promise<Hit[]> {
    let qy = supabase
      .from('constellations')
      .select('id, name, description, status')
      .or(like(['name', 'description']));
    if (!wide) qy = qy.eq('status', 'published');
    const { data } = await qy.limit(CEILING).then(noted('search-all: constellations'));
    return (data ?? []).map((r) => ({
      kind: 'constellation' as const,
      id: r.id,
      name: r.name,
      body: r.description ?? '',
      meta: r.status === 'published' ? '' : r.status,
      href: `/admin/constellations/${r.id}`,
      when: null, // ⚠ no `updated_at` on this table — the recency-sort argument
    }));
  }

  async function sets(): Promise<Hit[]> {
    let qy = supabase
      .from('sets')
      .select('id, title, description, status')
      .or(like(['title', 'description']));
    if (!wide) qy = qy.eq('status', 'published');
    const { data } = await qy.limit(CEILING).then(noted('search-all: sets'));
    return (data ?? []).map((r) => ({
      kind: 'set' as const,
      id: r.id,
      name: r.title,
      body: r.description ?? '',
      meta: r.status === 'published' ? '' : r.status,
      href: '/admin/sets',
      when: null,
    }));
  }

  async function songs(): Promise<Hit[]> {
    const { data } = await supabase
      .from('songs')
      .select('id, title, artist')
      .or(like(['title', 'artist']))
      .limit(CEILING)
      .then(noted('search-all: songs'));
    return (data ?? []).map((r) => ({
      kind: 'song' as const,
      id: r.id,
      name: r.title,
      body: '',
      meta: r.artist ?? '',
      href: '/admin/sets',
      when: null,
    }));
  }

  async function subjects(): Promise<Hit[]> {
    const { data } = await supabase
      .from('subjects')
      .select('id, name, slug, definition')
      .or(like(['name', 'definition']))
      .limit(CEILING)
      .then(noted('search-all: subjects'));
    return (data ?? []).map((r) => ({
      kind: 'subject' as const,
      id: r.id,
      name: r.name,
      body: r.definition ?? '',
      meta: '',
      href: `/admin/fragments?subject=${r.slug}`,
      when: null,
    }));
  }

  async function works(): Promise<Hit[]> {
    const { data } = await supabase
      .from('works')
      .select('id, title, slug, kind')
      .or(like(['title']))
      .limit(CEILING)
      .then(noted('search-all: works'));
    return (data ?? []).map((r) => ({
      kind: 'work' as const,
      id: r.id,
      name: r.title,
      body: '',
      meta: r.kind ?? '',
      href: `/admin/fragments?work=${r.slug}`,
      when: null,
    }));
  }

  async function authors(): Promise<Hit[]> {
    const { data } = await supabase
      .from('authors')
      .select('id, name, slug, note')
      .or(like(['name', 'note']))
      .limit(CEILING)
      .then(noted('search-all: authors'));
    return (data ?? []).map((r) => ({
      kind: 'author' as const,
      id: r.id,
      name: r.name,
      body: r.note ?? '',
      meta: '',
      href: `/admin/fragments?author=${r.slug}`,
      when: null,
    }));
  }

  /*
    ⚠ ONE `Promise.all`, WHICH IS THE SHAPE THAT WOULD SHIP AND IS THE POINT OF
    TIMING IT. Twelve serial awaits over a 440-row corpus would still be fast and
    would still be wrong — plan 24's finding was that SERIAL ROUND TRIPS, not
    query cost, are what an admin page actually pays for.

    If the round trips ever matter, the escape hatch is one `search_everything()`
    RPC marked SECURITY INVOKER: RLS unchanged, twelve requests become one. At
    this corpus size that would be premature.
  */
  const started = Date.now();
  const results = await Promise.all([
    essays(),
    notes(),
    quotes(),
    tasks(),
    goals(),
    people(),
    constellations(),
    sets(),
    songs(),
    subjects(),
    works(),
    authors(),
  ]);
  return { hits: results.flat(), ms: Date.now() - started };
}
