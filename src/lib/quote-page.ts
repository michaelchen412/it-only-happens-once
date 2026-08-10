// Everything a QUOTE'S OWN PAGE needs (plan 32 · §3, §5, §6) — the line itself
// plus its neighbourhood: the constellations it sits in, the lines it is kin to,
// and the rest of its author's words.
//
// ⚠ ITS OWN FILE RATHER THAN MORE OF `blog.ts`. That file is the FEED's
// queries — lists, pages, facets — and this is one row and its surroundings.
// The two share `QuoteItem` and nothing else, and `_shared.ts`'s history is the
// argument: a module that grows by accretion is the one people stop reading
// before adding to. Same rule as the actions split — a namespace is a file.
//
// Same trust model as blog.ts: the anon SSR client and the public RLS policies.
// Every query here re-states `status`/`deleted_at` anyway, because the
// neighbourhood is assembled from join tables that carry no status of their own.
import type { createSupabaseServerClient } from './supabase';
import type { QuoteItem, SubjectRef } from './blog';
import { revealOf } from './provenance';

type DB = ReturnType<typeof createSupabaseServerClient>;

/** ⚠ Two subjects, not one — see `relatedTo` for the measurement behind it. */
export const MIN_OVERLAP = 2;
/** More than fills the popover, which scrolls. The COUNT is never capped. */
const RELATED_SHOWN = 8;

export interface QuoteNeighbour {
  slug: string;
  /** `writing` renders its title; a quote renders its opening words. */
  type: 'writing' | 'quote' | 'song';
  title: string | null;
  body: string;
  attribution: string | null;
}

export interface QuoteConstellation {
  name: string;
  slug: string;
  description: string | null;
  /** The colour SLOT — app.css owns what each one looks like. */
  color: string;
}

export interface QuoteAuthor {
  name: string;
  slug: string;
  /** OTHER published quotes by them. 0 means the door leads back to this page. */
  others: number;
}

export interface QuotePage {
  quote: QuoteItem;
  /** Drafts are RLS-hidden from anon; reaching one means the viewer is admin. */
  status: 'note' | 'draft' | 'published';
  constellations: QuoteConstellation[];
  /** The top few, for the popover. */
  related: QuoteNeighbour[];
  /** How many there really are — what the strip's label says. */
  relatedTotal: number;
  author: QuoteAuthor | null;
}

// ⚠ ONE UNBROKEN LITERAL. Split with `+` for readability, PostgREST's generated
// types stop resolving it and every column comes back as `GenericStringError` —
// the select string has to stay a literal type for the row to be typed at all.
const QUOTE_SELECT = `id, slug, body, attribution, is_self, details, source_url, status, occurred_at, date_precision, author_id, authors(name, slug), works(title), fragment_subjects(subject_id, subjects(name, slug))`;

type SubjectRow = { subject_id: string; subjects: { name: string; slug: string } | null };

/**
 * One quote by slug, with everything its page shows. `null` if the slug is not
 * a quote — including when it is an ESSAY, which is the caller's other branch.
 *
 * `includeUnpublished` matches `getWritingBySlug`'s: it drops the app-side
 * filter so the admin can preview, and it is NOT the trust boundary — RLS is.
 */
export async function getQuotePage(
  supabase: DB,
  slug: string,
  opts: { includeUnpublished?: boolean } = {},
): Promise<QuotePage | null> {
  let query = supabase
    .from('fragments')
    .select(QUOTE_SELECT)
    .eq('type', 'quote')
    .is('deleted_at', null)
    .eq('slug', slug);
  if (!opts.includeUnpublished) query = query.eq('status', 'published');

  const { data: r } = await query.maybeSingle();
  if (!r) return null;

  const subjectRows = (r.fragment_subjects ?? []) as SubjectRow[];
  const subjects: SubjectRef[] = subjectRows
    .map((s) => ({ name: s.subjects?.name ?? '', slug: s.subjects?.slug ?? '' }))
    .filter((s) => s.slug);
  const subjectIds = subjectRows.map((s) => s.subject_id);

  // Three independent questions, so they go together rather than in a queue —
  // plan 24's finding about serial round trips applies to a reader-facing page
  // more than to any admin one.
  const [constellations, kin, others] = await Promise.all([
    constellationsOf(supabase, r.id),
    relatedTo(supabase, r.id, subjectIds),
    siblingCount(supabase, r.id, r.author_id),
  ]);

  return {
    quote: {
      id: r.id,
      slug: r.slug,
      body: r.body ?? '',
      attribution: r.attribution ?? null,
      reveal: revealOf(r),
      sourceUrl: r.source_url ?? null,
      occurredAt: r.occurred_at,
      precision: r.date_precision,
      subjects,
    },
    status: r.status,
    constellations,
    related: kin.shown,
    relatedTotal: kin.total,
    author: r.authors?.slug ? { name: r.authors.name, slug: r.authors.slug, others } : null,
  };
}

/** The constellations this line was placed in, in authored order. */
async function constellationsOf(supabase: DB, id: string): Promise<QuoteConstellation[]> {
  const { data } = await supabase
    .from('fragment_constellations')
    .select('position, constellations(name, slug, description, color, status)')
    .eq('fragment_id', id)
    .order('position');
  return (
    (data ?? [])
      .map((row) => row.constellations)
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      // ⚠ A DRAFT CONSTELLATION IS NOT A PLACE TO SEND ANYONE. RLS hides it from
      // anon, but the admin previewing a quote would otherwise be offered a door
      // that only exists for them — and would have no way to tell.
      .filter((c) => c.status === 'published')
      .map((c) => ({ name: c.name, slug: c.slug, description: c.description, color: c.color ?? 'amber' }))
  );
}

/**
 * Fragments that share at least `MIN_OVERLAP` subjects with this one, most
 * shared first.
 *
 * ⚠ **TWO SUBJECTS, NOT ONE, AND THE NUMBER WAS MEASURED.** "Shares a subject"
 * sounds like kinship and is not: on the bench, one quote's ≥1 set was **45 of
 * the 179 published fragments** — a quarter of the site behind a control
 * captioned "45 related lines". Subject sizes are wildly uneven (mean 14,
 * largest 32) and that quote carried `detachment` (32) and `the practice` (20),
 * so sharing one of them said almost nothing. At ≥2 the same quote returns 5.
 *
 * 70 of 77 published quotes carry ≥2 subjects, so the rule reaches nearly
 * everything. The rest fall back to ≥1 because it is all they can have, and
 * those are the lists to distrust first.
 *
 * ⚠ The refinement, if ≥2 ever feels loose: weight each shared subject by
 * RARITY (sum of `1/size`) rather than counting them. It handles the
 * single-subject fallback in the same expression. Deliberately not built — a
 * threshold you can explain beats a score you cannot, until the corpus says
 * otherwise.
 */
export function rankByOverlap(siblingRows: { fragment_id: string }[], selfId: string, subjectCount: number): string[] {
  const overlap = new Map<string, number>();
  for (const row of siblingRows) {
    if (row.fragment_id === selfId) continue;
    overlap.set(row.fragment_id, (overlap.get(row.fragment_id) ?? 0) + 1);
  }
  // A quote with one subject can only ever reach an overlap of 1, so demanding
  // two would give it no list at all rather than a weak one. 70 of 77 published
  // quotes carry two or more, so this branch is the exception it looks like.
  const need = subjectCount >= MIN_OVERLAP ? MIN_OVERLAP : 1;
  return [...overlap.entries()]
    .filter(([, n]) => n >= need)
    .sort((a, b) => b[1] - a[1])
    .map(([fid]) => fid);
}

async function relatedTo(
  supabase: DB,
  id: string,
  subjectIds: string[],
): Promise<{ shown: QuoteNeighbour[]; total: number }> {
  if (subjectIds.length === 0) return { shown: [], total: 0 };

  const { data: siblings } = await supabase
    .from('fragment_subjects')
    .select('fragment_id')
    .in('subject_id', subjectIds);

  const ranked = rankByOverlap(siblings ?? [], id, subjectIds.length);
  if (ranked.length === 0) return { shown: [], total: 0 };

  // ⚠ THE STATUS FILTER IS WHAT MAKES THE COUNT PUBLISHABLE, and it cannot be
  // done on the tally: `fragment_subjects` carries drafts and trashed rows too,
  // so `overlap.size` would advertise lines a reader cannot open.
  const { data: rows } = await supabase
    .from('fragments')
    .select('id, slug, type, title, body, attribution')
    .in('id', ranked)
    .eq('status', 'published')
    .is('deleted_at', null);

  const rank = new Map(ranked.map((fid, i) => [fid, i]));
  const ordered = (rows ?? []).sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  return {
    total: ordered.length,
    shown: ordered.slice(0, RELATED_SHOWN).map((f) => ({
      slug: f.slug,
      type: f.type,
      title: f.title,
      body: f.body ?? '',
      attribution: f.attribution,
    })),
  };
}

/**
 * How many OTHER published quotes this author has.
 *
 * ⚠ Zero is the answer that matters. 29 of 35 authors in the corpus have
 * exactly one quote, so "more from this author" would, for 40% of quotes, open
 * onto a page containing only the quote you are already reading. The caller
 * renders nothing at 0 rather than a door to here.
 */
async function siblingCount(supabase: DB, id: string, authorId: string | null): Promise<number> {
  if (!authorId) return 0;
  const { count } = await supabase
    .from('fragments')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'quote')
    .eq('status', 'published')
    .is('deleted_at', null)
    .eq('author_id', authorId)
    .neq('id', id);
  return count ?? 0;
}
