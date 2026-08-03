// The one seam with the corpus (docs/plans/12-people.md §5).
//
// Everything the Shared zone and the link picker need, in one module so the
// profile and the fragment editor can never disagree about what a link means.
//
// ⚠ THE TWO-HOP PATH IS THE POINT, and it is why this is more than a join.
// Linking a PERSON to a WORK means every fragment carrying that `work_id`
// appears on their profile — including ones added years later. `personWorks`
// therefore never stores which fragments it covers; it resolves them at read
// time, which is the difference between a shelf that stays true and one that
// was true on the day you built it.
//
// ⚠ NOTHING IN HERE MAY BE CALLED FROM A PUBLIC ROUTE. §5: "A published quote
// stays public; the fact that Noelle is why it exists is HQ data." The tables
// carry no `anon` policy, so a leak would surface as an empty result rather
// than as data — but the guarantee this module is written to keep is stronger
// than that: public queries never touch these tables at all, so there is no
// join for a policy to have to get right.
import type { Database } from '../database.types';
import { rowTitle, type FragmentType } from '../fragments-display';
import type { SupabaseClient } from '@supabase/supabase-js';

type DB = SupabaseClient<Database>;
type FragmentStatus = Database['public']['Enums']['fragment_status'];

/** One corpus row on somebody's shelf. */
export interface SharedFragment {
  id: string;
  slug: string;
  type: FragmentType;
  /** The primary line: a title for writing and songs, the words for a quote. */
  label: string;
  attribution: string | null;
  status: FragmentStatus;
  /**
   * The link's own free text, and ONLY present on a direct `person_fragments`
   * edge. A fragment reached through its work has no note of its own, because
   * the note belongs to the work link — the thing you actually said something
   * about.
   */
  note?: string | null;
}

export interface SharedWork {
  id: string;
  slug: string;
  title: string;
  kind: string | null;
  year: number | null;
  authorName: string | null;
  note: string | null;
  /** Resolved at read time — see the two-hop note at the top of this file. */
  fragments: SharedFragment[];
}

export interface Shared {
  works: SharedWork[];
  /** Direct links that are NOT already visible under one of the works above. */
  fragments: SharedFragment[];
  /** Rows the zone will render. Zero means the zone renders its quiet line. */
  count: number;
}

/** The shape the two pickers offer. Bodies are clamped — see `pickerOptions`. */
export interface WorkOption {
  id: string;
  title: string;
  authorName: string | null;
  year: number | null;
}
export interface FragmentOption {
  id: string;
  type: FragmentType;
  label: string;
  attribution: string | null;
}

/**
 * How much of a quote the PICKER carries.
 *
 * The Shared zone clamps with CSS instead, so the full text stays in the DOM
 * and stays findable. Here the text is a payload attribute on every option, and
 * a roster-sized list of unclamped quote bodies is real weight on a page that
 * has no other reason to be heavy.
 */
const PICKER_CHARS = 120;

const clamp = (s: string, n = PICKER_CHARS): string =>
  s.length <= n ? s : `${s.slice(0, n).trimEnd()}…`;

/** Strip the Markdown that would otherwise render as literal punctuation in a one-line label. */
function plainish(s: string): string {
  return s
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type FragmentBits = {
  id: string;
  slug: string;
  type: FragmentType;
  title: string | null;
  body: string | null;
  attribution: string | null;
  status: FragmentStatus;
};

const toShared = (f: FragmentBits, note?: string | null): SharedFragment => ({
  id: f.id,
  slug: f.slug,
  type: f.type,
  label: plainish(rowTitle(f)),
  attribution: f.attribution,
  status: f.status,
  ...(note === undefined ? {} : { note }),
});

/** The columns both reads want. Kept in one place so they cannot drift apart. */
const FRAGMENT_COLS = 'id, slug, type, title, body, attribution, status, work_id, deleted_at';

/**
 * Everything on one person's shelf.
 *
 * ⚠ TRASHED FRAGMENTS ARE EXCLUDED, but their LINK ROWS SURVIVE. A fragment in
 * the trash is not on your shelf, and rendering it there would make the profile
 * disagree with the fragment manager. Keeping the link means restoring the
 * fragment restores the attribution too — losing it silently on a trash-then-
 * restore is exactly the kind of quiet data loss this database cannot survive.
 * Purging really does remove it, by cascade.
 */
export async function sharedFor(sb: DB, personId: string): Promise<Shared> {
  const [{ data: workLinks }, { data: fragmentLinks }] = await Promise.all([
    sb
      .from('person_works')
      .select('note, created_at, works(id, slug, title, kind, year, authors(name))')
      .eq('person_id', personId)
      // Newest link first. A shelf you add to should show what you just added,
      // rather than filing it alphabetically somewhere you have to hunt for.
      .order('created_at', { ascending: false }),
    sb
      .from('person_fragments')
      .select(`note, created_at, fragments(${FRAGMENT_COLS})`)
      .eq('person_id', personId)
      .order('created_at', { ascending: false }),
  ]);

  const works = (workLinks ?? [])
    .map((row) => {
      const w = row.works as unknown as {
        id: string; slug: string; title: string; kind: string | null; year: number | null;
        authors: { name: string } | null;
      } | null;
      return w ? { link: row, work: w } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  // The second hop. One query for every linked work, rather than one per work.
  const workIds = works.map((w) => w.work.id);
  let byWork = new Map<string, FragmentBits[]>();
  if (workIds.length) {
    const { data } = await sb
      .from('fragments')
      .select(FRAGMENT_COLS)
      .in('work_id', workIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    byWork = (data ?? []).reduce((m, row) => {
      const f = row as unknown as FragmentBits & { work_id: string };
      const list = m.get(f.work_id) ?? [];
      list.push(f);
      m.set(f.work_id, list);
      return m;
    }, new Map<string, FragmentBits[]>());
  }

  // Direct edges, minus the trash.
  const direct = (fragmentLinks ?? [])
    .map((row) => ({ note: row.note, f: row.fragments as unknown as (FragmentBits & { deleted_at: string | null }) | null }))
    .filter((x): x is { note: string | null; f: FragmentBits & { deleted_at: string | null } } => !!x.f && !x.f.deleted_at);

  // A fragment reached through its work is ALREADY on the shelf. Showing it
  // again under a loose heading reads as a rendering bug, so the direct link's
  // note is carried onto the row inside the work group and the duplicate goes.
  const noteByFragment = new Map(direct.map((d) => [d.f.id, d.note]));
  const shownUnderAWork = new Set<string>();

  const sharedWorks: SharedWork[] = works.map(({ link, work }) => ({
    id: work.id,
    slug: work.slug,
    title: work.title,
    kind: work.kind,
    year: work.year,
    authorName: work.authors?.name ?? null,
    note: link.note,
    fragments: (byWork.get(work.id) ?? []).map((f) => {
      shownUnderAWork.add(f.id);
      const own = noteByFragment.get(f.id);
      return toShared(f, own ?? null);
    }),
  }));

  const loose = direct.filter((d) => !shownUnderAWork.has(d.f.id)).map((d) => toShared(d.f, d.note));

  return { works: sharedWorks, fragments: loose, count: sharedWorks.length + loose.length };
}

/**
 * What the two pickers may choose from.
 *
 * Everything at once rather than a search endpoint, for the same reason the
 * roster filters client-side: the corpus is in the low hundreds, it is one
 * round trip, and a keystroke that has to ask the server is slower and no more
 * correct. Revisit if `fragments` ever passes a few thousand rows.
 */
export async function pickerOptions(sb: DB): Promise<{ works: WorkOption[]; fragments: FragmentOption[] }> {
  const [{ data: works }, { data: fragments }] = await Promise.all([
    sb.from('works').select('id, title, year, authors(name)').order('title'),
    sb
      .from('fragments')
      .select('id, type, title, body, attribution, status')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);

  return {
    works: (works ?? []).map((w) => ({
      id: w.id,
      title: w.title,
      authorName: (w.authors as unknown as { name: string } | null)?.name ?? null,
      year: w.year,
    })),
    fragments: (fragments ?? []).map((f) => ({
      id: f.id,
      type: f.type as FragmentType,
      label: clamp(plainish(rowTitle(f))),
      attribution: f.attribution,
    })),
  };
}

/**
 * Who shared this fragment — the reverse direction, for the editor's field.
 *
 * Archived people are INCLUDED here, unlike everywhere else a roster is
 * offered. Archiving removes somebody from the roster and from search (§3); it
 * does not un-give you the book. Dropping them would silently rewrite where a
 * quote came from, which is the one thing a provenance field must never do.
 */
export async function peopleForFragment(sb: DB, fragmentId: string): Promise<string[]> {
  const { data } = await sb.from('person_fragments').select('person_id').eq('fragment_id', fragmentId);
  return (data ?? []).map((r) => r.person_id);
}

/**
 * The whole edge set as `fragment_id → person_id[]`, for the editor sheet.
 *
 * THE WHOLE TABLE, ON PURPOSE, rather than a lookup when a fragment is opened.
 * The bound is structural: at most 50 people times a corpus in the low
 * hundreds, and in practice a handful of rows. Fetching per-open would cost a
 * round trip on every sheet open AND introduce a race — you can tick somebody
 * before the answer lands, and the answer would then quietly undo the tick.
 * Rendering it once removes the race rather than guarding it.
 */
export async function allFragmentPeople(sb: DB): Promise<Record<string, string[]>> {
  const { data } = await sb.from('person_fragments').select('fragment_id, person_id');
  const map: Record<string, string[]> = {};
  for (const row of data ?? []) (map[row.fragment_id] ??= []).push(row.person_id);
  return map;
}
