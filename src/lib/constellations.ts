// Queries for the Sky — constellation-grouped views over the fragments that
// have been placed (vision.md §4, data-model.md §1). Same rules as blog.ts:
// all reads go through the anon SSR client and rely on the public RLS policies
// (published, non-deleted fragments only). "Elevation" is simply having a row
// in fragment_constellations — there is no flag.
import type { createSupabaseServerClient } from './supabase';
import { excerpt, readingMinutes } from './markdown';
import type { WritingItem, SubjectRef } from './blog';
import { PAIRED_SELECT, pairedMediaOf } from './blog';

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

/** One stanza of a suite, in whichever register its medium reads at.
 *  `SuiteStanza.astro` renders every variant, public and composer alike —
 *  a song plays where it was placed (design.md §14, resolved 2026-07-25). */
export type SuiteItem =
  | { kind: 'quote'; body: string; attribution: string | null }
  | { kind: 'writing'; item: WritingItem }
  /** `body` is the annotation — Michael's words on why this song (ADR-0009).
   *  Empty is normal: a song may say nothing and simply play. */
  | { kind: 'song'; title: string; body: string; attribution: string | null; sourceUrl: string | null };

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
}

/** Every constellation, in authored order, weighted by published placements. */
export async function listConstellations(supabase: DB): Promise<ConstellationRef[]> {
  const [{ data: cs }, { data: links }] = await Promise.all([
    // The overview always shows the PUBLIC truth — even to the admin, whose
    // session could otherwise see drafts (draft preview lives on /{slug}).
    supabase.from('constellations').select('name, slug, description, sort, color').eq('status', 'published').order('sort'),
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
    .select('id, name, slug, description, sort, status, score_url, color')
    .eq('slug', slug)
    .maybeSingle();
  if (!c) return null;

  const { data: rows } = await supabase
    .from('fragment_constellations')
    .select(
      `position, fragments!inner(id, type, slug, title, body, excerpt, attribution, source_url, occurred_at, updated_at, date_precision, fragment_subjects(subjects(name, slug)), ${PAIRED_SELECT})`
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
      source_url: string | null;
      occurred_at: string;
      updated_at: string | null;
      date_precision: 'day' | 'year';
      fragment_subjects: { subjects: SubjectRef | null }[] | null;
      paired_song_id?: string | null;
      paired_song?: {
        id: string;
        title: string | null;
        attribution: string | null;
        source_url: string | null;
        deleted_at: string | null;
      } | null;
      details?: unknown;
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
          // The Reader here renders through the same PostArticle the blog uses,
          // so a paired song has to travel with the essay or it would appear on
          // /blog and vanish inside a suite.
          paired: pairedMediaOf(f),
        },
      });
    } else if (f.type === 'song') {
      // A song is a stanza in the sequence (design.md §14, resolved 2026-07-25):
      // it plays where it was placed. The score above the suite and stanzas
      // inside it are independent — either, both, or neither.
      items.push({
        kind: 'song',
        title: f.title || '(untitled)',
        body: f.body ?? '',
        attribution: f.attribution,
        sourceUrl: f.source_url,
      });
    }
  }

  return {
    name: c.name,
    slug: c.slug,
    description: c.description,
    sort: c.sort,
    status: c.status as 'draft' | 'published',
    color: c.color,
    scoreUrl: c.score_url ?? null,
    items,
  };
}
