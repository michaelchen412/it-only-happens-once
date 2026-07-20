// Presentation helpers shared by the admin list + its row component.
// (Kept out of the .astro files so the list page stays lean.)

export const TYPE_META = {
  writing: { glyph: '▤', label: 'writing', tone: 'text-accent' },
  quote: { glyph: '”', label: 'quote', tone: 'text-secondary' },
  song: { glyph: '♪', label: 'song', tone: 'text-primary' },
} as const;

export type FragmentType = keyof typeof TYPE_META;

/** The bare public date for a fragment (UTC, so it never drifts by a day). */
export function displayDate(iso: string, precision: 'day' | 'year'): string {
  const d = new Date(iso);
  if (precision === 'year') return String(d.getUTCFullYear());
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Compact absolute date ("Apr 19, 2023") or an em-dash for null. UTC-stable. */
export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** The primary line for a list row: title for writing/song, the text for a quote. */
export function rowTitle(r: { type: string; title: string | null; body: string | null }): string {
  if (r.type === 'quote') return r.body || '(empty quote)';
  return r.title || '(untitled)';
}
