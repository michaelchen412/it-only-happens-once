// Queries for the Sky — constellation-grouped views over the fragments that
// have been placed (vision.md §4, data-model.md §1). Same rules as blog.ts:
// all reads go through the anon SSR client and rely on the public RLS policies
// (published, non-deleted fragments only). "Elevation" is simply having a row
// in fragment_constellations — there is no flag.
import type { createSupabaseServerClient } from './supabase';
import { excerpt, readingMinutes } from './markdown';
import type { WritingItem, QuoteItem, SubjectRef } from './blog';
import { attachNeighbourhoods, PAIRED_SELECT, pairedMediaOf } from './blog';
import { getQuoteNeighbourhoods, type QuotePage, type QuoteSeed } from './quote-page';
import { revealOf } from './provenance';
import type { FragmentType } from './fragments-display';

type DB = ReturnType<typeof createSupabaseServerClient>;

export interface ConstellationRef {
  name: string;
  slug: string;
  /** Why this way of seeing exists — shown on the overview AND as the suite's
   *  epigraph, so the zoom carries both name and meaning. */
  description: string | null;
  sort: number;
  /** The colour SLOT for its star (app.css owns what each slot looks like). */
  color: string;
  /** Published fragments placed in it — the constellation's weight in the sky. */
  count: number;
}

/*
  One stanza of a suite, in whichever register its medium reads at.
  `SuiteStanza.astro` renders every variant, public and composer alike.

  ⚠ THERE IS NO `song` VARIANT, AND THERE USED TO BE (ADR 0031). A song is never
  a suite stanza: music accompanies a constellation as its SCORE
  (`constellations.score_url`) or through one essay's `paired_song_id`, and both
  of those are relations rather than membership. A suite is a sequence read at
  the reader's pace; a four-minute song does not queue — which ADR 0009 observed
  and then gave a stanza to anyway. Zero of 48 songs were ever placed in one, in
  the three weeks the stanza existed.
*/
export type SuiteItem =
  /** `reveal` is what the citation control opens onto, or `''` for no control
   *  at all — derived once in lib/provenance.ts so the suite and the blog feed
   *  can never disagree about where a quote came from. */
  /** ⚠ The whole `QuoteItem`, not three loose fields. A quote stanza now OPENS
   *  (into the Reader, showing `QuoteArticle`), so the stanza and the sheet have
   *  to agree about which quote it is — and `body`/`attribution`/`reveal` alone
   *  could not say. Carrying the shape the blog already uses is what keeps the
   *  two renderings from drifting. */
  { kind: 'quote'; quote: QuoteItem } | { kind: 'writing'; item: WritingItem };

export interface Constellation {
  name: string;
  slug: string;
  description: string | null;
  sort: number;
  /** Drafts are RLS-hidden from anon — reaching one here means the viewer is
   *  the admin, and the public page doubles as the draft preview. */
  status: 'draft' | 'published';
  /** The colour SLOT — this suite reads under its own lamplight. */
  color: string;
  /** Optional Spotify playlist — the constellation's score (design.md §14). */
  scoreUrl: string | null;
  items: SuiteItem[];
  /** Quote id → everything its sheet shows. Empty for a suite with no quotes. */
  neighbourhoods: Map<string, QuotePage>;
}

/** Every constellation, in authored order, weighted by published placements. */
export async function listConstellations(supabase: DB): Promise<ConstellationRef[]> {
  const [{ data: cs }, { data: links }] = await Promise.all([
    // The overview always shows the PUBLIC truth — even to the admin, whose
    // session could otherwise see drafts (draft preview lives on /{slug}).
    supabase
      .from('constellations')
      .select('name, slug, description, sort, color')
      .eq('status', 'published')
      .order('sort'),
    supabase
      .from('fragment_constellations')
      .select('constellations!inner(slug), fragments!inner(status, deleted_at)')
      .eq('fragments.status', 'published')
      .is('fragments.deleted_at', null),
  ]);

  const counts = new Map<string, number>();
  for (const l of links ?? []) {
    const slug = (l.constellations as unknown as { slug: string }).slug;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }

  return (cs ?? []).map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 })).filter((c) => c.count > 0); // an empty constellation isn't in the sky yet
}

/** One constellation with its composed suite, in authored position order. */
export async function getConstellation(supabase: DB, slug: string): Promise<Constellation | null> {
  /*
    ONE ROUND TRIP, NOT TWO (24 · Piece 4).

    This was a lookup by slug followed by a second query keyed on the `id` the
    first one returned — a textbook serial waterfall, and it sat on the route
    that carries the site's whole idea. The stanzas are now an embedded select
    on the constellation itself, so the slug does both jobs. Measured across all
    eleven published constellations, 2026-08-07: **~110ms → ~65ms**, which is
    one PostgREST round trip exactly as predicted.

    ⚠ THE FILTERS APPLY TO THE NESTED EMBED, VIA THE DOTTED PATH, and that is
    the part worth checking rather than trusting. `fragment_constellations.
    fragments.status` reaches through two levels of embedding; `!inner` on
    `fragments` is what makes it a filtering join rather than a nulling one.

    ⚠ AND IT WAS VERIFIED AGAINST THE **SERVICE ROLE**, WHICH IS THE ONLY TEST
    THAT PROVES ANYTHING HERE. Under the anon key these filters are belt to
    RLS's braces — the public policies already hide unpublished and deleted
    fragments — so an embedded filter that silently did NOTHING would still
    produce correct-looking output for every anonymous reader, and would then
    show Michael his own drafts inside a published suite. Run with RLS bypassed,
    every one of the twelve constellations carries 1–4 draft or deleted
    fragments and not one of them survived this query. Re-run that check if the
    select shape is ever edited; identical anon output is not evidence.
  */
  const { data: c } = await supabase
    .from('constellations')
    .select(
      // `is_self`, `details`, `authors` and `works` are here only to build the
      // quote reveal (2026-08-05, plan 17a). They cost one join on a query that
      // already embeds three, and they are what stops the suite and the blog
      // feed from being two places that decide what a quote came from.
      `id, name, slug, description, sort, status, score_url, color, fragment_constellations(position, fragments!inner(id, type, slug, title, body, excerpt, attribution, is_self, details, source_url, author_id, occurred_at, updated_at, date_precision, authors(name, slug), works(title), fragment_subjects(subject_id, subjects(name, slug)), ${PAIRED_SELECT}))`,
    )
    .eq('slug', slug)
    .eq('fragment_constellations.fragments.status', 'published')
    .is('fragment_constellations.fragments.deleted_at', null)
    .order('position', { referencedTable: 'fragment_constellations' })
    .maybeSingle();
  if (!c) return null;

  const rows = c.fragment_constellations;

  const items: SuiteItem[] = [];
  /** What the batched neighbourhood loader needs, gathered as we walk. */
  const seeds: QuoteSeed[] = [];
  for (const r of rows ?? []) {
    const f = r.fragments as unknown as {
      id: string;
      // `FragmentType`, not the kinds written out again — the literal union
      // here still listed `song` two days after ADR 0035 deleted it.
      type: FragmentType;
      slug: string;
      title: string | null;
      body: string | null;
      excerpt: string | null;
      attribution: string | null;
      source_url: string | null;
      occurred_at: string;
      updated_at: string | null;
      date_precision: 'day' | 'year';
      author_id?: string | null;
      fragment_subjects: { subject_id: string; subjects: SubjectRef | null }[] | null;
      paired_song_id?: string | null;
      paired_song?: {
        id: string;
        title: string;
        artist: string | null;
        source_url: string;
      } | null;
      paired_playlist_url?: string | null;
      details?: unknown;
      is_self?: boolean | null;
      authors?: { name: string; slug: string } | null;
      works?: { title: string } | null;
    };
    if (f.type === 'quote') {
      const subjects = (f.fragment_subjects ?? [])
        .map((fs) => fs.subjects)
        .filter((x): x is SubjectRef => !!x)
        .sort((a, b) => a.name.localeCompare(b.name));
      const quote: QuoteItem = {
        id: f.id,
        slug: f.slug,
        body: f.body ?? '',
        attribution: f.attribution,
        reveal: revealOf(f),
        sourceUrl: f.source_url,
        occurredAt: f.occurred_at,
        precision: f.date_precision,
        subjects,
        author: f.authors?.slug ? { name: f.authors.name, slug: f.authors.slug } : null,
        // The suite fills this from its batch below; a stanza is not where the
        // door renders, so 0 here is the honest placeholder rather than a lie.
        authorSiblings: 0,
      };
      seeds.push({
        id: f.id,
        quote,
        authorId: f.author_id ?? null,
        authorName: f.authors?.name ?? null,
        authorSlug: f.authors?.slug ?? null,
        subjectIds: (f.fragment_subjects ?? []).map((fs) => fs.subject_id),
      });
      items.push({ kind: 'quote', quote });
    } else if (f.type === 'writing') {
      const authored = (f.excerpt ?? '').trim();
      const lede = authored || excerpt(f.body, 400);
      items.push({
        kind: 'writing',
        item: {
          id: f.id,
          slug: f.slug,
          title: f.title || '(untitled)',
          bodyMarkdown: f.body ?? '',
          excerpt: lede,
          hasMore: (f.body ?? '').trim().length > lede.length,
          occurredAt: f.occurred_at,
          updatedAt: f.updated_at ?? null,
          precision: f.date_precision,
          readMinutes: readingMinutes(f.body),
          subjects: (f.fragment_subjects ?? [])
            .map((fs) => fs.subjects)
            .filter((s): s is SubjectRef => !!s)
            .sort((a, b) => a.name.localeCompare(b.name)),
          // The Reader here renders through the same PostArticle the blog uses,
          // so a paired song has to travel with the essay or it would appear on
          // /blog and vanish inside a suite.
          paired: pairedMediaOf(f),
        },
      });
    }
    /*
      ⚠ A `song` ROW FALLS THROUGH AND RENDERS NOTHING, ON PURPOSE (ADR 0031).
      There is deliberately no branch and no `else` that throws: `place` and
      `setMembership` both refuse a song now, and the corpus has none placed,
      so this is unreachable — but if a row ever arrives from a hand-written
      insert or an old backup, a suite that quietly omits it is a far better
      failure than one that 500s. The absence is the statement; see `SuiteItem`.
    */
  }

  /*
    ⚠ ONE EXTRA BATCH FOR EVERY QUOTE IN THE SUITE, not one per quote — see
    `getQuoteNeighbourhoods`. A published constellation carries up to eight, and
    asking per stanza would put thirty-two round trips on the route plan 24 ·
    Piece 4 collapsed to one. Skipped outright when a suite holds no quotes,
    which two of the eleven published constellations do.
  */
  const neighbourhoods = await getQuoteNeighbourhoods(supabase, seeds);

  // The essays in the suite want the same closing strip, and the same batch
  // logic — one page's worth of questions asked once (plan 32 · §11).
  await attachNeighbourhoods(
    supabase,
    items.filter((i): i is Extract<SuiteItem, { kind: 'writing' }> => i.kind === 'writing').map((i) => i.item),
  );

  return {
    name: c.name,
    slug: c.slug,
    description: c.description,
    sort: c.sort,
    status: c.status as 'draft' | 'published',
    color: c.color,
    scoreUrl: c.score_url ?? null,
    items,
    neighbourhoods,
  };
}
