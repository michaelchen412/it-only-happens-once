// The music room's facet index (plan 33 §4, §7, ruling 3).
//
// ⚠ THIS IS WHERE THE ROOM'S ONE CLAIM IS EITHER TRUE OR NOT. The proposition is
// that the field describes the LIBRARY — that a word's size is how much of the
// corpus it holds, and that a word offered is a word that leads somewhere. Every
// one of those is arithmetic over the whole index, and every one of them fails
// SILENTLY if it is wrong: a mis-sized word still renders, and a dead end that
// is not dead just gives you an empty room with no explanation. Nothing in a
// browser would report any of it, which is exactly why it lives in pure
// functions with a test file rather than inside a click handler.
import { describe, expect, it } from 'vitest';
import {
  MAX_FACETS,
  buildIndex,
  maskOf,
  matching,
  musicHref,
  parseFeelings,
  toggleFeeling,
  wordStates,
  wordWeight,
} from '../lib/music-room';

const VOCAB = [
  { slug: 'grieving', name: 'grieving' },
  { slug: 'regretful', name: 'regretful' },
  { slug: 'tender', name: 'tender' },
  { slug: 'ecstatic', name: 'ecstatic' },
];

// a: grieving+regretful · b: regretful+tender · c: tender · d: grieving+regretful+tender
const SONGS = [
  { id: 'a', feelings: ['grieving', 'regretful'] },
  { id: 'b', feelings: ['regretful', 'tender'] },
  { id: 'c', feelings: ['tender'] },
  { id: 'd', feelings: ['grieving', 'regretful', 'tender'] },
];

const index = buildIndex(VOCAB, SONGS);

describe('the index', () => {
  it('gives each song one integer, whatever it wears', () => {
    // The size claim ruling 3 rests on: the index is bounded by the VOCABULARY,
    // not the corpus, and does not grow when a song gains a fifth feeling.
    expect(index.songs.map((s) => s.mask)).toEqual([0b0011, 0b0110, 0b0100, 0b0111]);
  });

  it('ignores a feeling that is not in the vocabulary', () => {
    // Reachable in one real way: a word deleted between the two reads that build
    // the room. Contributing nothing is right — the alternative is a bit that
    // belongs to whatever word later takes that position.
    const odd = buildIndex(VOCAB, [{ id: 'x', feelings: ['tender', 'nonexistent'] }]);
    expect(odd.songs[0].mask).toBe(0b0100);
  });

  it('⚠ drops past the 31-word ceiling rather than corrupting the arithmetic', () => {
    // `1 << 31` is NEGATIVE in JavaScript — bitwise coerces to a 32-bit SIGNED
    // int — so a 32nd word would not merely be wrong, it would make every mask
    // comparison involving it wrong in a way that looks like a filtering bug.
    // Unreachable at any sane vocabulary size; loud rather than silent if not.
    const huge = Array.from({ length: 40 }, (_, i) => ({ slug: `w${i}`, name: `w${i}` }));
    const built = buildIndex(huge, [{ id: 'x', feelings: ['w0', 'w35'] }]);
    expect(built.vocabulary).toHaveLength(MAX_FACETS);
    expect(built.dropped).toHaveLength(9);
    expect(built.songs[0].mask).toBe(1); // w0 only; w35 contributed nothing
  });
});

describe('stacking is AND', () => {
  it('narrows rather than widens as words are added', () => {
    const ids = (slugs: string[]) => matching(index.songs, maskOf(VOCAB, slugs)).map((s) => s.id);
    expect(ids([])).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(['regretful'])).toEqual(['a', 'b', 'd']);
    expect(ids(['regretful', 'tender'])).toEqual(['b', 'd']);
    expect(ids(['grieving', 'regretful', 'tender'])).toEqual(['d']);
  });

  it('an empty selection is the whole room, not an empty one', () => {
    // The room opens FULL (plan 33's measurements table). An empty room would
    // have to explain itself; a full one demonstrates the mechanism, because
    // every song already wears the words you would filter by.
    expect(matching(index.songs, 0)).toHaveLength(4);
  });
});

describe('what a word says about itself', () => {
  it('⚠ counts what you WOULD be left with, not how many carry it', () => {
    // The bug this pins is the tempting one: a global "how many songs are
    // tender" never changes as you choose, so the field becomes decoration. The
    // number has to answer *what happens if I press this*.
    const at = (slugs: string[]) => Object.fromEntries(wordStates(index, slugs).map((w) => [w.slug, w.count]));
    expect(at([])).toEqual({ grieving: 2, regretful: 3, tender: 3, ecstatic: 0 });
    // Having chosen `grieving` (a, d), `tender` would leave only d — not 3.
    expect(at(['grieving'])).toEqual({ grieving: 2, regretful: 2, tender: 1, ecstatic: 0 });
  });

  it('a selected word reports the room you are standing in', () => {
    const tender = wordStates(index, ['grieving'])[0];
    expect(tender.selected).toBe(true);
    expect(tender.count).toBe(2); // a and d
  });

  it('a dead end is disabled, and a selected word never is', () => {
    // `ecstatic` is on nothing, so it can only ever empty the room.
    const states = wordStates(index, []);
    expect(states.find((w) => w.slug === 'ecstatic')?.disabled).toBe(true);
    expect(states.find((w) => w.slug === 'tender')?.disabled).toBe(false);
    // Standing inside a word's result, it is not a dead end even at count 1.
    const inside = wordStates(index, ['grieving', 'regretful', 'tender']);
    expect(inside.filter((w) => w.selected).every((w) => !w.disabled)).toBe(true);
  });

  it('offers no combination that does not exist', () => {
    // The rail's contract, held here: every pressable word leads somewhere, so
    // the empty state is nearly unreachable by clicking. (It is still reachable
    // by following a shared link, which is why the room can still say it.)
    for (const start of [[], ['grieving'], ['tender'], ['regretful', 'tender']]) {
      for (const w of wordStates(index, start)) {
        if (w.selected || w.disabled) continue;
        expect(matching(index.songs, maskOf(VOCAB, [...start, w.slug])).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('how large a word is drawn', () => {
  it('⚠ pulls the small end apart, which is where the words are', () => {
    // The whole reason for a curve. Linear would put 1-of-40 at 0.025 and
    // 6-of-40 at 0.15 — both indistinguishable from the minimum — so fifteen of
    // sixteen words would render as one size and the field would stop being a
    // shape at all.
    const linear1 = 1 / 40;
    const linear6 = 6 / 40;
    expect(wordWeight(1, 40)).toBeGreaterThan(linear1 * 3);
    expect(wordWeight(6, 40)).toBeGreaterThan(linear6 * 2);
    // Still monotonic — bigger always means more.
    expect(wordWeight(6, 40)).toBeGreaterThan(wordWeight(1, 40));
    expect(wordWeight(40, 40)).toBe(1);
  });

  it('a dead end sits at the floor rather than vanishing', () => {
    // It is a word you are being TOLD about, not a word being hidden: the shape
    // of the vocabulary stays honest even where it does not lead anywhere.
    expect(wordWeight(0, 40)).toBe(0);
  });

  it('never divides by a zero corpus', () => {
    expect(wordWeight(0, 0)).toBe(0);
    expect(wordWeight(5, 0)).toBe(0);
  });
});

describe('the URL is the state (§7)', () => {
  it('round-trips a combination', () => {
    expect(parseFeelings('regretful,tender', VOCAB)).toEqual(['regretful', 'tender']);
    expect(musicHref(['regretful', 'tender'])).toBe('/blog?view=music&feeling=regretful%2Ctender');
  });

  it('the bare room has ONE address', () => {
    // Not `?feeling=` empty: two URLs for one page is how a room ends up with
    // two entries in someone's history and two in a search index.
    expect(musicHref([])).toBe('/blog?view=music');
  });

  it('⚠ drops a word that no longer exists instead of emptying the room', () => {
    // A renamed feeling keeps its slug forever (ruling 6), so shared links stay
    // good — but a DELETED or MERGED one does not, and someone will follow that
    // link. Showing them the room minus one filter is close to what they were
    // sent; refusing the whole parameter would show nothing and read as broken.
    expect(parseFeelings('regretful,deleted-word', VOCAB)).toEqual(['regretful']);
    expect(parseFeelings('deleted-word', VOCAB)).toEqual([]);
  });

  it('tolerates the shapes a hand-edited URL takes', () => {
    expect(parseFeelings(' regretful , tender ', VOCAB)).toEqual(['regretful', 'tender']);
    expect(parseFeelings('regretful,regretful', VOCAB)).toEqual(['regretful']);
    expect(parseFeelings('', VOCAB)).toEqual([]);
    expect(parseFeelings(null, VOCAB)).toEqual([]);
  });

  it('toggling adds at the end and removes in place', () => {
    // Order is stable so the URL a reader copies is the order they pressed —
    // and so a second press of the same word is an undo, not a duplicate.
    expect(toggleFeeling([], 'tender')).toEqual(['tender']);
    expect(toggleFeeling(['grieving'], 'tender')).toEqual(['grieving', 'tender']);
    expect(toggleFeeling(['grieving', 'tender'], 'grieving')).toEqual(['tender']);
  });
});
