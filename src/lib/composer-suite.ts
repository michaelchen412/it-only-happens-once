// Building the composer's suite — the admin's own view of what is placed in a
// constellation, and the three instruments that read it.
//
// ⚠ IT WAS 145 LINES OF FRONTMATTER IN `pages/admin/constellations/[id].astro`
// (plan 38 · §6.2), and the page made the argument for moving it against
// itself: the thresholds already live in lib "because the script below
// recomputes all of this and the two must not drift". The shaping ABOVE that
// line had exactly the same property and none of the protection.
//
// ⚠ THE REAL PAYOFF IS THAT IT IS NOW REACHABLE FROM A TEST. A page template is
// not: `buildSuite` decides the editor payload for every row, which stanza
// shape the Read view renders, and what counts as a draft — and until this move
// not one of those was assertable without driving a browser.
import { excerpt, readingMinutes } from './markdown';
import { revealOf } from './provenance';
import { pairedMediaOf, type SubjectRef } from './blog';
import type { SuiteItem } from './constellations';
import { publicShapeHint, suiteHints } from './suite-shape';
import type { FragmentType } from './fragments-display';

/** One placed fragment, as this admin query returns it. */
export type PlacedFragment = {
  id: string;
  type: FragmentType;
  slug: string;
  title: string | null;
  body: string | null;
  excerpt: string | null;
  attribution: string | null;
  source_url: string | null;
  status: string;
  occurred_at: string;
  updated_at: string | null;
  date_precision: 'day' | 'year';
  details: Record<string, unknown> | null;
  author_id: string | null;
  work_id: string | null;
  authors: { name: string; slug: string } | null;
  works: { title: string } | null;
  fragment_subjects: { subjects: SubjectRef | null }[] | null;
  // ⚠ DECLARED, BECAUSE THE QUERY HAS ALWAYS FETCHED THEM. `PAIRED_SELECT` is
  // spliced into the constellation read, so these arrive on every placed row —
  // this type simply never said so, and `pairedMediaOf(f)` type-checked through
  // an `unknown` overlap rather than because the shapes matched.
  paired_song_id?: string | null;
  paired_song?: {
    id: string;
    title: string | null;
    attribution: string | null;
    source_url: string | null;
    deleted_at: string | null;
  } | null;
  paired_playlist_url?: string | null;
};

/** A `fragment_constellations` row, joined to its fragment. */
export type Placement = { fragments: unknown };
/** Every link in the table, for the "also lives in n others" count. */
export type Link = { fragment_id: string; constellation_id: string };

const snip = (s: string | null | undefined, max = 110) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * How many OTHER constellations each fragment lives in — the ✦×n hint.
 */
export function elsewhereCounts(allLinks: Link[] | null, thisId: string): Map<string, number> {
  const elsewhere = new Map<string, number>();
  for (const l of allLinks ?? []) {
    if (l.constellation_id === thisId) continue;
    elsewhere.set(l.fragment_id, (elsewhere.get(l.fragment_id) ?? 0) + 1);
  }
  return elsewhere;
}

/** Every placed row, shaped for the composer's three views. */
export function buildSuite(placements: Placement[] | null, allLinks: Link[] | null, thisId: string) {
  const elsewhere = elsewhereCounts(allLinks, thisId);
  return (placements ?? []).map((p) => {
    const f = p.fragments as unknown as PlacedFragment;
    const subjects = (f.fragment_subjects ?? [])
      .map((fs) => fs.subjects?.name)
      .filter(Boolean)
      .join(', ');
    // the FragmentSheet edit payload (same shape FragmentRow emits)
    const editorData =
      f.type === 'writing'
        ? null
        : JSON.stringify({
            id: f.id,
            type: f.type,
            title: f.title,
            body: f.body,
            attribution: f.attribution,
            source_url: f.source_url,
            status: f.status,
            year: (f.details as { year?: number } | null)?.year ?? null,
            occurredIso: f.occurred_at,
            datePrecision: f.date_precision,
            authorId: f.author_id,
            authorName: f.authors?.name ?? '',
            workId: f.work_id,
            workName: f.works?.title ?? '',
            subjects,
            details: f.details ?? {},
            constellationIds: (allLinks ?? []).filter((l) => l.fragment_id === f.id).map((l) => l.constellation_id),
          });
    // The Read view's stanza — the SAME SuiteItem shape the public sky renders,
    // built from this admin query so DRAFT fragments are included (the public
    // `getConstellation` stays published-only, deliberately).
    const authored = (f.excerpt ?? '').trim();
    const lede = authored || excerpt(f.body, 400);
    const read: SuiteItem =
      f.type === 'quote'
        ? {
            kind: 'quote',
            quote: {
              id: f.id,
              slug: f.slug,
              body: f.body ?? '',
              attribution: f.attribution,
              reveal: revealOf(f),
              sourceUrl: f.source_url,
              occurredAt: f.occurred_at,
              precision: f.date_precision,
              author: f.authors?.slug ? { name: f.authors.name, slug: f.authors.slug } : null,
              authorSiblings: 0,
              // ⚠ NOT the `subjects` const above — that one is comma-joined for
              // the sheet's TagInput, and this wants the {name, slug} pairs the
              // public renderer links with.
              subjects: (f.fragment_subjects ?? [])
                .map((fs) => fs.subjects)
                .filter((x): x is { name: string; slug: string } => !!x)
                .sort((a, b) => a.name.localeCompare(b.name)),
            },
          }
        : /* ⚠ NO `song` ARM, AND ANYTHING NOT A QUOTE FALLS TO `writing` (ADR
             0031). A song is never a suite stanza, and `constellations.place`
             refuses one — so a song reaching this line means a row that predates
             the rule, and rendering it as an untitled writing stanza is a visible
             oddity in the composer rather than a crash on the page you would use
             to remove it. */
          {
            kind: 'writing',
            item: {
              id: f.id,
              slug: f.slug,
              title: f.title || '(untitled)',
              bodyMarkdown: f.body ?? '',
              excerpt: lede,
              hasMore: (f.body ?? '').trim().length > lede.length,
              occurredAt: f.occurred_at,
              updatedAt: f.updated_at,
              precision: f.date_precision,
              readMinutes: readingMinutes(f.body),
              subjects: (f.fragment_subjects ?? [])
                .map((fs) => fs.subjects)
                .filter((s): s is SubjectRef => !!s)
                .sort((a, b) => a.name.localeCompare(b.name)),
              // Same PostArticle as the public Reader, so the pairing has to
              // travel here too — this is the construction site plan 04's
              // Piece 1 missed, and it is still the easy one to forget.
              paired: pairedMediaOf(f),
            },
          };

    return {
      id: f.id,
      type: f.type,
      status: f.status,
      editorData,
      read,
      summary:
        f.type === 'quote'
          ? snip(f.body)
          : f.type === 'song'
            ? `${f.title ?? ''} — ${f.attribution ?? ''}`
            : (f.title ?? '(untitled)'),
      attribution: f.type === 'quote' ? (f.attribution ?? '') : '',
      subjects: (f.fragment_subjects ?? []).map((fs) => fs.subjects?.name).filter(Boolean) as string[],
      others: elsewhere.get(f.id) ?? 0,
    };
  });
}

/** The three instruments, and the reader payload. Never police — see the page. */
export function suiteStats(suite: ReturnType<typeof buildSuite>) {
  // the writings placed here — their full text rides along for the Reader
  const readerWritings = suite
    .map((s) => s.read)
    .filter((r): r is Extract<SuiteItem, { kind: 'writing' }> => r.kind === 'writing')
    .map((r) => r.item);

  // The three tests, as instruments — never police. Hints appear only off-band.
  // The thresholds themselves live in `suite-shape.ts`, because the composer's
  // client script recomputes all of this after an unplace and the two must not
  // drift. That argument is why this function is here too.
  const placedCount = suite.length;
  const subjectSpread = new Set(suite.flatMap((s) => s.subjects)).size;
  const mix = { writing: 0, quote: 0, song: 0 } as Record<FragmentType, number>;
  for (const s of suite) mix[s.type]++;
  const { size: sizeHint, spread: spreadHint } = suiteHints(placedCount, subjectSpread);
  // A NOTE COUNTS AS A DRAFT HERE, because the only question this asks is "would
  // a stranger get this one" — and `getConstellation` filters to published, so
  // anything else is invisible out there whatever it is called in the workshop.
  const draftCount = suite.filter((s) => s.status !== 'published').length;
  const publicShape = publicShapeHint(placedCount, draftCount);

  return { readerWritings, placedCount, subjectSpread, mix, sizeHint, spreadHint, draftCount, publicShape };
}
