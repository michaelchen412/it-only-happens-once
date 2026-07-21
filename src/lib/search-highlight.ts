// Search-term highlighting for the Fragment Manager (admin only, when a search
// term is active). Matching is literal + case-insensitive (via indexOf, so the
// term needs no regex escaping) — the same substring match the DB `ilike` uses.
// Segments are returned as data; the .astro component renders them so the text
// is auto-escaped (only a real <mark> is inserted — no HTML injection).

// Below this length, a search term is ignored (a single letter matches nearly
// everything). Shared by the server filter and the client debounce.
export const MIN_SEARCH = 2;

export interface Seg {
  text: string;
  hit: boolean;
}
export interface Excerpt {
  segs: Seg[];
  lead: boolean; // leading ellipsis (window starts mid-text)
  trail: boolean; // trailing ellipsis
}

/** All [start,end) ranges where `term` occurs in `text`, case-insensitive. */
function ranges(text: string, term: string): [number, number][] {
  const out: [number, number][] = [];
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push([i, i + needle.length]);
    i = hay.indexOf(needle, i + needle.length);
  }
  return out;
}

/** Turn matched ranges within [from,to) into alternating plain/hit segments. */
function segmentize(text: string, hits: [number, number][], from: number, to: number): Seg[] {
  const segs: Seg[] = [];
  let pos = from;
  for (const [s, e] of hits) {
    if (s > pos) segs.push({ text: text.slice(pos, s), hit: false });
    segs.push({ text: text.slice(s, e), hit: true });
    pos = e;
  }
  if (pos < to) segs.push({ text: text.slice(pos, to), hit: false });
  return segs;
}

/** Highlight every match inline within a short field (title, attribution). */
export function highlight(text: string, term: string): Seg[] {
  const r = ranges(text, term);
  return r.length ? segmentize(text, r, 0, text.length) : [{ text, hit: false }];
}

/** Has at least one match. */
export function hasMatch(text: string, term: string): boolean {
  return !!term && text.toLowerCase().includes(term.toLowerCase());
}

/**
 * Windowed excerpts around matches (option #2), BOUNDED so a broad term can't
 * choke the DOM. We highlight at most `maxHits` matches (the real bound — dense
 * matches otherwise merge into one giant window full of <mark>s), grouped into
 * windows (~`ctx` chars each side; overlapping windows merge; edges snap to word
 * boundaries). `more` is the count of further matches not shown.
 */
export function excerpts(text: string, term: string, ctx = 64, maxHits = 8): { windows: Excerpt[]; more: number } {
  const all = ranges(text, term);
  if (!all.length) return { windows: [], more: 0 };
  const shown = all.slice(0, maxHits);

  const snapStart = (i: number) => {
    let s = Math.max(0, i - ctx);
    for (let k = 0; k < 12 && s > 0 && !/\s/.test(text[s - 1]); k++) s--;
    return s;
  };
  const snapEnd = (i: number) => {
    let e = Math.min(text.length, i + ctx);
    for (let k = 0; k < 12 && e < text.length && !/\s/.test(text[e]); k++) e++;
    return e;
  };

  const raw = shown.map(([s, e]) => ({ start: snapStart(s), end: snapEnd(e), hits: [[s, e]] as [number, number][] }));
  const merged: typeof raw = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
      last.hits.push(...w.hits);
    } else {
      merged.push({ start: w.start, end: w.end, hits: [...w.hits] });
    }
  }

  const windows = merged.map((w) => ({
    segs: segmentize(text, w.hits, w.start, w.end),
    lead: w.start > 0,
    trail: w.end < text.length,
  }));
  return { windows, more: all.length - shown.length };
}

/** Strip Markdown to readable plain text for excerpting. */
export function toPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
