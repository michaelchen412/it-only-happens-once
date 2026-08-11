/**
 * The music room's facet index (plan 33 §4, ruling 3).
 *
 * ⚠ THE WHOLE POINT OF THIS FILE IS A SEAM, NOT AN ALGORITHM. The room's palette
 * has two requirements that pull opposite ways:
 *
 *   • **Correctness.** Word sizes, contextual counts and dead ends must be
 *     computed over the WHOLE qualifying corpus or they lie. A dead end that is
 *     not dead, or a word sized by the page you happen to have loaded, is a
 *     false statement about the library — and this room's entire proposition is
 *     that the library is being described truthfully.
 *   • **Responsiveness.** The palette must NEVER wait on a network. The collapse
 *     is the interaction that beat a filter rail in the bench; a round trip per
 *     word would destroy it, and no amount of spinner design gets it back.
 *
 * Both are satisfied by shipping a complete index to the client and treating
 * card delivery as a separate, swappable concern. The index is bounded by the
 * VOCABULARY, not by the corpus: one integer per song, so a thousand songs is a
 * few kilobytes and does not grow when songs gain more feelings.
 *
 * That is the senior move here rather than the elaborate one — it gets the seam
 * right, not the implementation big. Building windowed card fetching for fifty
 * songs would be over-engineering. Building a palette that counts whatever
 * happens to be in the DOM is the mistake you cannot back out of: the day the
 * corpus outgrows one page, every count silently becomes a lie and the fix
 * touches every line of the interaction.
 */

/**
 * ⚠ THIRTY-ONE, AND IT IS A REAL CEILING RATHER THAN A ROUND NUMBER.
 * JavaScript's bitwise operators coerce to 32-bit SIGNED integers, so bit 31 is
 * the sign bit and `1 << 31` is negative. Bits 0–30 are the usable range.
 *
 * This is not a limit anyone should ever meet: §1's whole argument is that the
 * vocabulary is small and shared — sixteen words, and the Library's merge tool
 * exists to keep it that way. A 32-word list of feelings is a failure of the
 * taxonomy before it is a failure of this file.
 */
export const MAX_FACETS = 31;

export interface FeelingWord {
  slug: string;
  name: string;
}

/** One song as the palette sees it: an id and a set of bits. Nothing else. */
export interface IndexedSong {
  id: string;
  mask: number;
}

export interface FacetIndex {
  /** In `feelings.sort` order — dark to light. Bit `i` is `vocabulary[i]`. */
  vocabulary: FeelingWord[];
  songs: IndexedSong[];
  /**
   * Words beyond `MAX_FACETS`, dropped rather than silently corrupting the
   * arithmetic. Empty in every realistic case; the caller logs if it is not, and
   * a song carrying ONLY dropped words would fall out of the room — which is the
   * cost of the ceiling, stated rather than hidden.
   */
  dropped: FeelingWord[];
}

/**
 * Build the index. `songs` carries feeling SLUGS; the caller has already applied
 * ruling 2 (a song with no feelings is not in the room).
 */
export function buildIndex(vocabulary: FeelingWord[], songs: { id: string; feelings: string[] }[]): FacetIndex {
  const kept = vocabulary.slice(0, MAX_FACETS);
  const dropped = vocabulary.slice(MAX_FACETS);
  const bit = new Map(kept.map((w, i) => [w.slug, 1 << i]));
  return {
    vocabulary: kept,
    dropped,
    songs: songs.map((s) => ({
      id: s.id,
      mask: s.feelings.reduce((m, slug) => m | (bit.get(slug) ?? 0), 0),
    })),
  };
}

/** The bits for a set of slugs. Unknown slugs contribute nothing. */
export function maskOf(vocabulary: FeelingWord[], slugs: string[]): number {
  const bit = new Map(vocabulary.map((w, i) => [w.slug, 1 << i]));
  return slugs.reduce((m, slug) => m | (bit.get(slug) ?? 0), 0);
}

/** Songs whose feelings include every selected word — stacking is AND (§4). */
export function matching(songs: IndexedSong[], selected: number): IndexedSong[] {
  return songs.filter((s) => (s.mask & selected) === selected);
}

export interface WordState {
  slug: string;
  name: string;
  selected: boolean;
  /**
   * For an unselected word: how many songs you would be left with if you added
   * it. For a selected word: how many you have now.
   *
   * ⚠ THE FIRST HALF IS THE ONE THAT MATTERS AND THE ONE THAT IS EASY TO GET
   * WRONG. A count of "how many songs carry this word at all" would be a global
   * number that never changes as you choose, which makes the whole field a
   * decoration — the number has to answer *what happens if I press this*, which
   * is the same contract `listSubjects` established for the rail.
   */
  count: number;
  /** Nothing combines it with the current selection. Not pressable. */
  disabled: boolean;
}

/**
 * The state of every word, given a selection. Pure, total, and computed over the
 * whole index — see the file header for why that is the requirement rather than
 * a nicety.
 */
export function wordStates(index: FacetIndex, selectedSlugs: string[]): WordState[] {
  const selected = new Set(selectedSlugs);
  const selectedMask = maskOf(index.vocabulary, selectedSlugs);
  const inSet = matching(index.songs, selectedMask);
  return index.vocabulary.map((w, i) => {
    const isSelected = selected.has(w.slug);
    const bit = 1 << i;
    const count = isSelected ? inSet.length : inSet.filter((s) => (s.mask & bit) !== 0).length;
    return {
      slug: w.slug,
      name: w.name,
      selected: isSelected,
      count,
      // A selected word is never a dead end: you are standing in its result.
      disabled: !isSelected && count === 0,
    };
  });
}

/**
 * How large a word is drawn, as a 0–1 position between the smallest and largest
 * type in the field.
 *
 * ⚠ THE CURVE IS NOT DECORATION. Linear leaves the whole middle of the
 * vocabulary looking identical — with counts of 1, 6 and 40, a linear map puts 1
 * and 6 within a few per cent of each other at the bottom, so fifteen of sixteen
 * words render as one size and the field stops being a shape. The exponent pulls
 * the small end apart, which is where the words are.
 *
 * ⚠ AND ZERO IS NOT THE FLOOR OF THE SCALE. A dead end still has to be readable
 * — it is a word you are being told about, not a word being hidden — so `0`
 * returns the minimum rather than something vanishing.
 */
export const SIZE_EXPONENT = 0.6;

export function wordWeight(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  return Math.pow(Math.min(count, max) / max, SIZE_EXPONENT);
}

/**
 * `?feeling=regretful,hopeful` → the slugs that exist, in the order given,
 * without duplicates.
 *
 * ⚠ UNKNOWN SLUGS ARE DROPPED RATHER THAN EMPTYING THE ROOM. A renamed feeling
 * keeps its slug forever (ruling 6), so a shared link stays good — but a DELETED
 * or MERGED one does not, and someone will follow that link. Dropping the word
 * shows them the room minus one filter, which is close to what they were sent;
 * treating the whole parameter as invalid would show them nothing and read as a
 * broken page.
 */
export function parseFeelings(raw: string | null, vocabulary: FeelingWord[]): string[] {
  const known = new Set(vocabulary.map((w) => w.slug));
  const out: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const slug = part.trim();
    if (slug && known.has(slug) && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** The selection after pressing one word — the same toggle the rail uses. */
export function toggleFeeling(selected: string[], slug: string): string[] {
  return selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug];
}

/**
 * The room's URL for a selection. The bare room keeps `base` untouched, so it
 * has ONE address rather than two — `?feeling=` with nothing after it would be a
 * second URL for the same page, which is two history entries and two rows in a
 * search index.
 *
 * `base` is a parameter because the room is a component rather than a page: the
 * bench mounts it at its own path, and a word whose link pointed at `/blog`
 * would navigate out of the room you were testing.
 */
export function musicHref(selected: string[], base = '/blog?view=music'): string {
  if (!selected.length) return base;
  return `${base}${base.includes('?') ? '&' : '?'}feeling=${encodeURIComponent(selected.join(','))}`;
}
