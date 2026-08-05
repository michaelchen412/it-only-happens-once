// Presentation helpers shared by the admin list + its row component.
// (Kept out of the .astro files so the list page stays lean.)

// `tone` is retained for any surface that still wants a per-type accent, but
// the admin no longer uses it: the glyph SHAPE carries type, and colour was
// reassigned to constellation membership (see TypeMark.astro, design.md §14).
export const TYPE_META = {
  writing: { glyph: '▤', label: 'writing', tone: 'text-accent' },
  quote: { glyph: '”', label: 'quote', tone: 'text-secondary' },
  song: { glyph: '♪', label: 'song', tone: 'text-primary' },
} as const;

export type FragmentType = keyof typeof TYPE_META;

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

/** The bare public date for a fragment (UTC, so it never drifts by a day). */
export function displayDate(iso: string, precision: 'day' | 'year'): string {
  const d = new Date(iso);
  if (precision === 'year') return String(d.getUTCFullYear());
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

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
