// Queries for the Sky — constellation-grouped views over the fragments that
// have been placed (vision.md §4, data-model.md §1). Same rules as blog.ts:
// all reads go through the anon SSR client and rely on the public RLS policies
// (published, non-deleted fragments only). "Elevation" is simply having a row
// in fragment_constellations — there is no flag.
import type { createSupabaseServerClient } from './supabase';
import { excerpt, readingMinutes } from './markdown';
import type { WritingItem, SubjectRef } from './blog';

type DB = ReturnType<typeof createSupabaseServerClient>;

export interface ConstellationRef {
  name: string;
  slug: string;
  /** Why this way of seeing exists — shown on the overview AND as the suite's
   *  epigraph, so the zoom carries both name and meaning. */
  description: string | null;
  sort: number;
  /** Published fragments placed in it — the constellation's weight in the sky. */
  count: number;
}

/** One stanza of a suite. Songs join when the corpus has them (no rows yet). */
export type SuiteItem =
  | { kind: 'quote'; body: string; attribution: string | null }
  | { kind: 'writing'; item: WritingItem };

export interface Constellation {
  name: string;
  slug: string;
  description: string | null;
  sort: number;
  /** Drafts are RLS-hidden from anon — reaching one here means the viewer is
   *  the admin, and the public page doubles as the draft preview. */
  status: 'draft' | 'published';
  /** Optional Spotify playlist — the constellation's score (design.md §14). */
  scoreUrl: string | null;
  items: SuiteItem[];
}

/** Every constellation, in authored order, weighted by published placements. */
export async function listConstellations(supabase: DB): Promise<ConstellationRef[]> {
  const [{ data: cs }, { data: links }] = await Promise.all([
    // The overview always shows the PUBLIC truth — even to the admin, whose
    // session could otherwise see drafts (draft preview lives on /{slug}).
    supabase.from('constellations').select('name, slug, description, sort').eq('status', 'published').order('sort'),
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

  return (cs ?? [])
    .map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 }))
    .filter((c) => c.count > 0); // an empty constellation isn't in the sky yet
}

/** One constellation with its composed suite, in authored position order. */
export async function getConstellation(supabase: DB, slug: string): Promise<Constellation | null> {
  const { data: c } = await supabase
    .from('constellations')
    .select('id, name, slug, description, sort, status, score_url')
    .eq('slug', slug)
    .maybeSingle();
  if (!c) return null;

  const { data: rows } = await supabase
    .from('fragment_constellations')
    .select(
      'position, fragments!inner(id, type, slug, title, body, excerpt, attribution, occurred_at, updated_at, date_precision, fragment_subjects(subjects(name, slug)))'
    )
    .eq('constellation_id', c.id)
    .eq('fragments.status', 'published')
    .is('fragments.deleted_at', null)
    .order('position');

  const items: SuiteItem[] = [];
  for (const r of rows ?? []) {
    const f = r.fragments as unknown as {
      id: string;
      type: 'writing' | 'quote' | 'song';
      slug: string;
      title: string | null;
      body: string | null;
      excerpt: string | null;
      attribution: string | null;
      occurred_at: string;
      updated_at: string | null;
      date_precision: 'day' | 'year';
      fragment_subjects: { subjects: SubjectRef | null }[] | null;
    };
    if (f.type === 'quote') {
      items.push({ kind: 'quote', body: f.body ?? '', attribution: f.attribution });
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
        },
      });
    }
    // songs: none in the corpus yet; the suite renders them when they arrive
  }

  return {
    name: c.name,
    slug: c.slug,
    description: c.description,
    sort: c.sort,
    status: c.status as 'draft' | 'published',
    scoreUrl: c.score_url ?? null,
    items,
  };
}
