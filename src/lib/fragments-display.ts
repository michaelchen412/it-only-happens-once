// Presentation helpers shared by the admin list + its row component.
// (Kept out of the .astro files so the list page stays lean.)

// `tone` is retained for any surface that still wants a per-type accent, but
// the admin no longer uses it: the glyph SHAPE carries type, and colour was
// reassigned to constellation membership (see TypeMark.astro, design.md §14).

// ⚠ WRITING HAS NO GLYPH, AND THE EMPTY STRING IS THE DECISION (2026-08-17).
// `▤` was a mark that only ever confirmed the default. The argument for a
// shape-per-type held while there were THREE kinds and no one of them was the
// norm; a song left for a table of its own (ADR 0035, above) and that collapsed
// the vocabulary to two, at which point one mark distinguishes both. `”` says
// quote; nothing says writing — and "nothing" is the honest rendering of a
// distinction the eye makes anyway from the italic body and the missing title.
//
// The alternative that lost: keep both and shrink `▤`. Rejected because size is
// not the complaint — a mark that never varies is not carrying information at
// any size, and on a phone it was spending gutter the text column needed.
//
// The public suite reached the same verdict first, for the same reason and in
// its own words (ConstellationSuite.astro, 2026-08-07): the glyphs "answered a
// question nobody asked". This makes the rest of the corpus agree with it.
//
// ⚠ EMPTY, NOT REMOVED. Consumers with a reserved gutter (FragmentRow's `w-6`
// cell, the composer's suite column) render TypeMark's span either way and stay
// aligned; the three INLINE sites — the count badge, the public card header,
// the Add ▾ menus — skip the mark themselves rather than inherit a stray gap.
export const TYPE_META = {
  writing: { glyph: '', label: 'writing', tone: 'text-accent' },
  quote: { glyph: '”', label: 'quote', tone: 'text-secondary' },
} as const;

export type FragmentType = keyof typeof TYPE_META;

/**
 * The two kinds, in the order every surface offers them.
 *
 * ⚠ THERE WERE THREE UNTIL 2026-08-15. A `song` was the third, and it left for
 * a table of its own (ADR 0035) because it was never a fragment in the sense
 * this union means: text, with subjects, placeable in a constellation, readable
 * at a URL. Removing it here is what made the compiler find every surface that
 * assumed otherwise.
 *
 * ⚠ DERIVED FROM `TYPE_META`, NOT WRITTEN OUT AGAIN — which is the whole point,
 * because until 2026-08-09 it WAS written out again three times: privately in
 * `blog.ts`, as `TYPES` in `fragment-query.ts`, and as a second `TYPES` inside
 * `FragmentListPanel.astro` (plans/29 · §3). Four declarations of one
 * vocabulary, in a corpus whose types are the one thing that would be genuinely
 * expensive to add to. Deriving means a fourth kind is added HERE, with its
 * glyph and its label, and every list picks it up rather than three of them
 * quietly disagreeing about what exists.
 *
 * `Object.keys` preserves insertion order for string keys, so `TYPE_META` is
 * also where the order is chosen.
 */
export const FRAGMENT_TYPES = Object.keys(TYPE_META) as FragmentType[];

/** The noun beside a type count. "writing" is a MASS noun — five pieces of
 *  writing is still "writing", and "5 writings" reads like a database. The
 *  other two count normally.
 *
 *  Exported (rather than living inside TypeCount.astro) because the composer's
 *  ✕ now recomputes its badges in the browser, and a singularisation rule the
 *  server knows and the client doesn't would show "1 quotes" the moment you
 *  removed the second one. */
export const typeCountLabel = (type: FragmentType, n: number): string =>
  type === 'writing' ? 'writing' : n === 1 ? TYPE_META[type].label : `${TYPE_META[type].label}s`;

/** Compact absolute date ("Apr 19, 2023") or an em-dash for null. UTC-stable. */
export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The primary line for a list row: title for writing/song, the text for a quote. */
export function rowTitle(r: { type: string; title: string | null; body: string | null }): string {
  if (r.type === 'quote') return r.body || '(empty quote)';
  return r.title || '(untitled)';
}

/**
 * Strip the Markdown that would otherwise render as literal punctuation in a
 * one-line label, and flatten the whitespace with it.
 *
 * ⚠ BESIDE `rowTitle` RATHER THAN IN EITHER CALLER (plans/29 · §3). It existed
 * twice — named in `hq/links.ts`, re-inlined verbatim in `hq/brief.ts` — and
 * both copies were applied to nothing but a `rowTitle`. Exporting it from
 * `links.ts`, which is what the plan suggested, would have made the brief
 * depend on the picker module for a string rule neither one owns; here it sits
 * next to its only ever argument, in the file both already import.
 *
 * It is deliberately not a Markdown parser. A label is a glance, so the answer
 * to `**bold**` is `bold` and the answer to a link is not worth the dependency.
 */
export function plainish(s: string): string {
  return s
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
