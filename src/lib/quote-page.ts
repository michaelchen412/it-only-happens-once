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
import type { QuoteItem } from './blog';
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
  /**
   * Other published fragments carrying EVERY one of this fragment's subjects.
   *
   * ⚠ ZERO IS THE ANSWER THAT MATTERS, and it is the common case: measured
   * 2026-08-10, **57 of 131 published fragments — 44% — have a subject
   * combination nobody else carries.** The strip's "More on x · y →" link goes
   * to the feed's AND-stacked filter, so for nearly half of everything it
   * landed on a page holding exactly one thing: the piece you were just
   * reading. The caller renders nothing at 0.
   *
   * Third instance of one bug shape, and worth naming as a shape: the author
   * door (`others > 0`), "Appears in" minus the constellation you are standing
   * in, and now this. **A door back to where you already are is not a door** —
   * and each one looked like a feature until the count was checked.
   */
  sharesWholeSignature: number;
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

  /*
    ⚠ ONE QUOTE, THROUGH THE BATCH, AND THAT IS THE POINT. This used to own three
    private helpers — `constellationsOf`, `relatedTo`, `siblingCount` — that did
    set-wise what `getQuoteNeighbourhoods` does for many. They agreed on the day
    they were written and had already begun to disagree: the batch learned to
    count the whole-signature set (`sharesWholeSignature`) and this path did not,
    so the same quote answered differently depending on whether you reached it by
    its own URL or through a constellation.

    That is exactly the drift ADR-0023 argues against for the RENDERER, applied
    to the query layer, and the fix is the same one: not two implementations kept
    in step, but one. A batch of one is a few object allocations; a second
    definition of "related" is a bug with a six-month fuse.
  */
  const found = await getQuoteNeighbourhoods(supabase, [
    {
      id: r.id,
      status: r.status,
      quote: {
        id: r.id,
        slug: r.slug,
        body: r.body ?? '',
        attribution: r.attribution ?? null,
        reveal: revealOf(r),
        sourceUrl: r.source_url ?? null,
        occurredAt: r.occurred_at,
        precision: r.date_precision,
        subjects: subjectRows
          .map((x) => ({ name: x.subjects?.name ?? '', slug: x.subjects?.slug ?? '' }))
          .filter((x) => x.slug),
      },
      authorId: r.author_id,
      authorName: r.authors?.name ?? null,
      authorSlug: r.authors?.slug ?? null,
      subjectIds: subjectRows.map((x) => x.subject_id),
    },
  ]);
  return found.get(r.id) ?? null;
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

// ── The batched form, for a suite ────────────────────────────────────────────

/**
 * What a caller already holds about each fragment, from its own query.
 *
 * ⚠ `quote` AND `author*` ARE OPTIONAL BECAUSE AN ESSAY USES THIS TOO. The
 * closing strip is the same on both (plan 32 · §11, ADR-0023) — subjects,
 * constellations, kin, a date and a share mark — and only the attribution above
 * it is a quote's alone. A second near-identical loader for writing was the
 * alternative and would have been two places that decide what "related" means.
 */
export interface QuoteSeed {
  id: string;
  /** A suite only carries published fragments, so this defaults — but the
   *  permalink serves a DRAFT to its admin, and must say so. */
  status?: 'note' | 'draft' | 'published';
  /** Absent for an essay: nothing downstream of the strip needs the quote body. */
  quote?: QuoteItem;
  authorId?: string | null;
  authorName?: string | null;
  authorSlug?: string | null;
  /** Subject ids — a suite's own select carries names, not ids, so it asks. */
  subjectIds: string[];
}

/**
 * The same neighbourhood as `getQuotePage`, for MANY quotes at once.
 *
 * ⚠ **FOUR QUERIES FOR THE WHOLE SUITE, NOT FOUR PER QUOTE, AND THAT IS THE
 * WHOLE REASON THIS EXISTS.** A published constellation carries up to EIGHT
 * quotes (measured 2026-08-10). Calling `getQuotePage` per stanza would be
 * thirty-two extra round trips on `/[slug]` — the one route plan 24 · Piece 4
 * spent its effort collapsing from two queries to ONE, taking it 110ms → 65ms.
 * Undoing that to give a drawer its contents would be a bad trade made
 * invisibly, which is the kind this codebase keeps finding after the fact.
 *
 * Set-wise instead: every question is asked once with an `IN`, and the answers
 * are dealt back out in memory. The four run together, so it is one round trip
 * of latency rather than four.
 */
export async function getQuoteNeighbourhoods(supabase: DB, seeds: QuoteSeed[]): Promise<Map<string, QuotePage>> {
  const out = new Map<string, QuotePage>();
  if (seeds.length === 0) return out;

  const ids = seeds.map((s) => s.id);
  const authorIds = [...new Set(seeds.map((s) => s.authorId).filter((a): a is string => Boolean(a)))];
  const allSubjectIds = [...new Set(seeds.flatMap((s) => s.subjectIds))];

  const [placements, authorRows, siblingRows] = await Promise.all([
    supabase
      .from('fragment_constellations')
      .select('fragment_id, position, constellations(name, slug, description, color, status)')
      .in('fragment_id', ids)
      .order('position'),
    // Every published quote by any of these authors. Counting client-side beats
    // a `count` per author, and the corpus is small enough that the rows are
    // cheaper than the round trips.
    authorIds.length
      ? supabase
          .from('fragments')
          .select('id, author_id')
          .eq('type', 'quote')
          .eq('status', 'published')
          .is('deleted_at', null)
          .in('author_id', authorIds)
      : Promise.resolve({ data: [] as { id: string; author_id: string | null }[] }),
    allSubjectIds.length
      ? supabase.from('fragment_subjects').select('fragment_id, subject_id').in('subject_id', allSubjectIds)
      : Promise.resolve({ data: [] as { fragment_id: string; subject_id: string }[] }),
  ]);

  const byConstellation = new Map<string, QuoteConstellation[]>();
  for (const row of placements.data ?? []) {
    const c = row.constellations;
    // A draft constellation is not a place to send anyone — the same rule
    // `constellationsOf` states, and it has to be restated here because this is
    // a second path to the same fact.
    if (!c || c.status !== 'published') continue;
    const list = byConstellation.get(row.fragment_id) ?? [];
    list.push({ name: c.name, slug: c.slug, description: c.description, color: c.color ?? 'amber' });
    byConstellation.set(row.fragment_id, list);
  }

  const perAuthor = new Map<string, number>();
  for (const r of authorRows.data ?? []) {
    if (r.author_id) perAuthor.set(r.author_id, (perAuthor.get(r.author_id) ?? 0) + 1);
  }

  // One index of subject → fragments, sliced per quote below.
  const bySubject = new Map<string, string[]>();
  for (const r of siblingRows.data ?? []) {
    const list = bySubject.get(r.subject_id) ?? [];
    list.push(r.fragment_id);
    bySubject.set(r.subject_id, list);
  }

  const rankedPerQuote = new Map<string, string[]>();
  /** Ids whose overlap is TOTAL — the AND-filter's actual result set. */
  const wholePerQuote = new Map<string, Set<string>>();
  const wanted = new Set<string>();
  for (const seed of seeds) {
    const rows = seed.subjectIds.flatMap((sid) => (bySubject.get(sid) ?? []).map((fid) => ({ fragment_id: fid })));
    const ranked = rankByOverlap(rows, seed.id, seed.subjectIds.length);
    rankedPerQuote.set(seed.id, ranked);
    // Carrying EVERY subject means an overlap equal to the count of them, which
    // is what `?subject=a,b` returns — the same arithmetic the feed does in SQL.
    const tally = new Map<string, number>();
    for (const r of rows) if (r.fragment_id !== seed.id) tally.set(r.fragment_id, (tally.get(r.fragment_id) ?? 0) + 1);
    wholePerQuote.set(
      seed.id,
      new Set([...tally.entries()].filter(([, n]) => n === seed.subjectIds.length).map(([fid]) => fid)),
    );
    for (const fid of ranked) wanted.add(fid);
  }

  // The fifth query, and it cannot join the parallel batch above: it asks about
  // the ids the overlap pass just produced. Skipped entirely when nothing
  // cleared the ≥2 bar, which is the common case for a lightly-tagged suite.
  const neighbours = new Map<string, QuoteNeighbour>();
  if (wanted.size > 0) {
    const { data } = await supabase
      .from('fragments')
      .select('id, slug, type, title, body, attribution')
      .in('id', [...wanted])
      .eq('status', 'published')
      .is('deleted_at', null);
    for (const f of data ?? []) {
      neighbours.set(f.id, {
        slug: f.slug,
        type: f.type,
        title: f.title,
        body: f.body ?? '',
        attribution: f.attribution,
      });
    }
  }

  for (const seed of seeds) {
    const ranked = (rankedPerQuote.get(seed.id) ?? []).filter((fid) => neighbours.has(fid));
    const others = seed.authorId ? Math.max(0, (perAuthor.get(seed.authorId) ?? 0) - 1) : 0;
    // ⚠ Counted against PUBLISHED rows only, like everything else here — the
    // whole-signature set comes off `fragment_subjects`, which carries drafts
    // and trashed rows, so an unfiltered count would keep the link alive
    // pointing at a feed that shows nothing.
    const whole = [...(wholePerQuote.get(seed.id) ?? [])].filter((fid) => neighbours.has(fid)).length;
    out.set(seed.id, {
      quote: seed.quote as QuoteItem,
      status: seed.status ?? 'published',
      constellations: byConstellation.get(seed.id) ?? [],
      related: ranked.slice(0, RELATED_SHOWN).map((fid) => neighbours.get(fid)!),
      relatedTotal: ranked.length,
      sharesWholeSignature: whole,
      author: seed.authorSlug && seed.authorName ? { name: seed.authorName, slug: seed.authorSlug, others } : null,
    });
  }
  return out;
}
