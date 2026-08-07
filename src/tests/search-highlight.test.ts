// `src/lib/search-highlight.ts` — the Fragment Manager's search highlighting.
// Pure, and it had no unit test. Added 2026-08-07 during a quality audit.
//
// Two properties matter more than any individual assertion, and both are
// security-shaped rather than cosmetic:
//
//   1. SEGMENTS ARE DATA, NEVER HTML. The module returns `{ text, hit }` and the
//      .astro component renders them, so the text is auto-escaped and the only
//      markup ever inserted is a real <mark>. A future "optimisation" that
//      returned a string with <mark> in it would reintroduce HTML injection into
//      a field that shows arbitrary stored prose.
//   2. NO TEXT IS LOST. Concatenating the segments must reproduce the source
//      exactly — a highlighter that drops or duplicates a character is showing
//      the reader something nobody wrote.
import { describe, it, expect } from 'vitest';
import { MIN_SEARCH, excerpts, hasMatch, highlight, toPlain } from '../lib/search-highlight';

/** Every segment joined — the invariant most of these tests lean on. */
const joined = (segs: { text: string }[]) => segs.map((s) => s.text).join('');

describe('highlight', () => {
  it('splits into alternating plain and hit segments', () => {
    expect(highlight('the way that their hands moved', 'their')).toEqual([
      { text: 'the way that ', hit: false },
      { text: 'their', hit: true },
      { text: ' hands moved', hit: false },
    ]);
  });

  it('is case-insensitive but returns the ORIGINAL casing', () => {
    // The reader must see what was written, not a lowercased copy of it.
    const segs = highlight('Forgiveness is not forgetting', 'forgive');
    expect(segs.find((s) => s.hit)?.text).toBe('Forgive');
    expect(joined(segs)).toBe('Forgiveness is not forgetting');
  });

  it('finds every occurrence, including adjacent ones', () => {
    const segs = highlight('abab', 'ab');
    expect(segs.filter((s) => s.hit)).toHaveLength(2);
    expect(joined(segs)).toBe('abab');
  });

  it('matches literally — regex metacharacters are not patterns', () => {
    // indexOf, not RegExp, so a term needs no escaping. `.` must match a dot.
    expect(highlight('a.b acb', '.').filter((s) => s.hit)).toEqual([{ text: '.', hit: true }]);
    expect(highlight('cost is $5 (roughly)', '$5').some((s) => s.hit)).toBe(true);
    expect(highlight('nothing here', '(').some((s) => s.hit)).toBe(false);
  });

  it('returns the whole text as one plain segment when nothing matches', () => {
    expect(highlight('nothing here', 'zebra')).toEqual([{ text: 'nothing here', hit: false }]);
    expect(highlight('nothing here', '')).toEqual([{ text: 'nothing here', hit: false }]);
  });

  it('matches at the very start and the very end without emitting empty segments', () => {
    for (const [text, term] of [
      ['their hands', 'their'],
      ['hands their', 'their'],
      ['their', 'their'],
    ] as const) {
      const segs = highlight(text, term);
      expect(joined(segs)).toBe(text);
      expect(segs.every((s) => s.text.length > 0)).toBe(true);
    }
  });

  it('never returns markup — only data the component can escape', () => {
    const nasty = 'a <script>alert(1)</script> b';
    const segs = highlight(nasty, 'script');
    expect(joined(segs)).toBe(nasty); // preserved verbatim, not sanitised here
    for (const s of segs) expect(typeof s.hit).toBe('boolean');
  });
});

describe('hasMatch', () => {
  it('is case-insensitive', () => {
    expect(hasMatch('Forgiveness', 'forgive')).toBe(true);
    expect(hasMatch('forgiveness', 'FORGIVE')).toBe(true);
  });

  it('an empty term matches nothing, rather than everything', () => {
    // `''.includes()` is true for every string; the guard is what stops an
    // empty search box lighting up the entire manager.
    expect(hasMatch('anything', '')).toBe(false);
  });
});

describe('MIN_SEARCH', () => {
  it('is shared, so the server filter and the client debounce agree', () => {
    // A single letter matches nearly everything; the two surfaces disagreeing
    // about the floor is how one of them starts querying on every keystroke.
    expect(MIN_SEARCH).toBe(2);
  });
});

describe('excerpts', () => {
  const long = 'x'.repeat(300) + ' needle ' + 'y'.repeat(300);

  it('says nothing when there is nothing to say', () => {
    expect(excerpts('some text', 'zebra')).toEqual({ windows: [], more: 0 });
  });

  it('opens a window around the match with ellipsis flags on both sides', () => {
    const { windows } = excerpts(long, 'needle');
    expect(windows).toHaveLength(1);
    expect(windows[0].lead).toBe(true);
    expect(windows[0].trail).toBe(true);
    expect(joined(windows[0].segs)).toContain('needle');
  });

  it('does not claim an ellipsis when the window reaches the edge', () => {
    const { windows } = excerpts('needle at the very start', 'needle');
    expect(windows[0].lead).toBe(false);
    expect(windows[0].trail).toBe(false);
  });

  it('BOUNDS the highlighting so a broad term cannot choke the DOM', () => {
    // The real bound is on hits, not windows: dense matches otherwise merge
    // into one giant window full of <mark>s.
    const dense = Array.from({ length: 20 }, (_, i) => `hit ${i}`).join(' ');
    const { windows, more } = excerpts(dense, 'hit');
    const marks = windows.flatMap((w) => w.segs).filter((s) => s.hit);
    expect(marks).toHaveLength(8);
    expect(more).toBe(12);
  });

  it('merges overlapping windows instead of repeating the text between them', () => {
    const { windows } = excerpts('needle and needle', 'needle', 64);
    expect(windows).toHaveLength(1);
    expect(windows[0].segs.filter((s) => s.hit)).toHaveLength(2);
  });

  it('keeps separate windows when the matches are far apart', () => {
    const far = 'needle' + ' '.repeat(400) + 'needle';
    const { windows } = excerpts(far, 'needle', 20);
    expect(windows.length).toBeGreaterThan(1);
  });

  it('a window reproduces its slice of the source exactly', () => {
    for (const w of excerpts(long, 'needle').windows) {
      expect(long).toContain(joined(w.segs));
    }
  });
});

describe('toPlain', () => {
  it('keeps link TEXT and drops the target', () => {
    expect(toPlain('see [the essay](/blog/forgiveness) here')).toBe('see the essay here');
  });

  it('drops images entirely — alt text is not prose', () => {
    expect(toPlain('before ![a portrait](/img.png) after')).toBe('before after');
  });

  it('strips headings, quotes and emphasis marks', () => {
    expect(toPlain('## A heading')).toBe('A heading');
    expect(toPlain('> a quoted line')).toBe('a quoted line');
    expect(toPlain('**bold** and _italic_ and ~~struck~~')).toBe('bold and italic and struck');
  });

  it('removes code rather than excerpting it', () => {
    expect(toPlain('text ```js\nconst a = 1;\n``` more')).toBe('text more');
    expect(toPlain('an `inline` one')).toBe('an one');
  });

  it('collapses whitespace and trims, so an excerpt is one readable line', () => {
    expect(toPlain('  a\n\n   b  \n c ')).toBe('a b c');
  });

  it('leaves ordinary prose alone', () => {
    expect(toPlain('Forgiveness is not forgetting.')).toBe('Forgiveness is not forgetting.');
  });
});
