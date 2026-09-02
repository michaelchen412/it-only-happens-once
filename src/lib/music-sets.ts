/**
 * The sets — curated listens, each one a Spotify playlist with a title, a
 * quote and a description (plan 40 §3, decided 2026-08-14).
 *
 * ⚠ A SET IS NOT A FILTER RESULT, which is the whole reason this file is not
 * `music-room.ts`. The room was retrieval — press a feeling, the corpus
 * narrows, and what you get is every song carrying the word. A set is the
 * opposite act: Michael chose these, in this order, and the reason they belong
 * together is not a property any one of them has. So there is no index, no
 * vocabulary and no arithmetic here. Selection is one slug, not a set of bits.
 *
 * ⚠ AND IT EXISTS TO BE TAKEN AWAY. The room was a place you visit; a set is a
 * thing you save into your own library and play six months from now without
 * coming back. Michael, 2026-08-14: *"this is really a stepping ground into
 * encapsulation, isolating different emotions through jazz… the constellations
 * should really serve as the place where we flesh out those ideas."*
 *
 * That sentence is the division of labour for the whole site, and it is why
 * this file is small: **a constellation is where an idea is worked out; a set
 * is where a feeling is isolated.** Anything here that starts to look like
 * argument belongs on the other side of that line.
 */

/**
 * One quote, from the Library — a real fragment in production, so it carries an
 * author and a work and may be the same row a constellation places.
 *
 * ⚠ A QUOTE IS ADDITION, NOT ANNOTATION, which is why it passes the test a
 * feeling word failed. Printing "redemptive · defiant" under a set explains the
 * joke; another voice saying the thing differently does not.
 */
export interface SetQuote {
  text: string;
  author: string;
  /** Null for an unsourced line — plenty of the Library's quotes have no work. */
  work?: string | null;
}

export interface MusicSet {
  /** URL identity. `?set=<slug>`. */
  slug: string;
  /**
   * An utterance, not a label — a question put to the listener, or a sentence
   * one person says to another. Michael's own: *"What would you still do, if
   * you knew you would fail?"*, *"If nothing else, I love you"*.
   *
   * ⚠ SENTENCE CASE, WHERE A CONSTELLATION IS LOWERCASE, and that is read off
   * the real playlists rather than prescribed — including the one title that is
   * both (*"the blizzard covers us all the same"* / *"The blizzard covers us
   * all the same"*). It is the cheapest signal on the page that a listen is not
   * a read.
   *
   * ⚠ AND THE EMBED PRINTS IT TOO — the Spotify playlist carries the same
   * sentence. That is why the open pane renders NO heading and the index
   * carries the title instead: Michael's words appear once, in his type, and
   * Spotify's copy stays over in its own box.
   */
  title: string;
  /**
   * ⚠ EXACTLY ONE, OR NONE — decided 2026-08-14 after the bench showed three.
   * Michael: *"I think it starts to get cluttered both from the perspective of
   * ideas and visually."* Singular in the type rather than a capped array,
   * because a cap is a rule someone has to remember and a scalar is a rule the
   * compiler keeps.
   */
  quote?: SetQuote | null;
  /** Markdown. Michael's words, under the quote. Often empty. */
  description: string;
  /** One Spotify playlist. Canonical, no `?si=` (data-model.md §`source_url`). */
  url: string;
}

/**
 * ⚠ A SET PAGE OPENS WITH ONE ALREADY OPEN, never on an empty pane, and the
 * precedent is the room's: *"THE ROOM OPENS FULL, NOT EMPTY"* — an empty state
 * has to EXPLAIN itself, whereas a full one demonstrates the mechanism. A
 * column of sentences beside a blank rectangle asks the reader to guess that
 * pressing one does something.
 *
 * An unknown or missing slug therefore falls back to the first set rather than
 * to nothing, which also keeps a stale shared link useful.
 */
export function resolveSet(raw: string | null, sets: MusicSet[]): string {
  if (!sets.length) return '';
  const match = sets.find((s) => s.slug === raw);
  return match ? match.slug : sets[0].slug;
}

/**
 * The URL for a set. `base` is a parameter because the bench mounts this at its
 * own path with its own query string, and a link that dropped those params
 * would reset what is being tested on every press.
 */
export function setHref(slug: string, base: string): string {
  return `${base}${base.includes('?') ? '&' : '?'}set=${encodeURIComponent(slug)}`;
}

/*
  ⚠ THE INDEX NO LONGER LEANS, AND `INDEX_INDENTS`/`indentFor` ARE GONE WITH IT
  (2026-09-02, `/lab/afford-sets`). The lean was borrowed from
  `ConstellationSuite`'s stanza indents on the argument that *"seven
  left-aligned sentences read as a list of options; seven that drift read as a
  page someone wrote"* — true of a column of bare sentences, and false the
  moment each one grows a mark. A gutter star's whole job is a straight edge to
  read down, and an indent per item put the eight marks at six different x
  positions. Measured before it was cut.

  It was also already failing on its own terms below `md`, where most titles
  wrap and only the first line is indented, so the column read ragged rather
  than composed. `git log` has the amplitudes.
*/
